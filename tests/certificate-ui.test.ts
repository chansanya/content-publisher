import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useCertificateStore } from '../src/renderer/stores/certificate'
import { defaultCertificateTargets, certificateConfirmation, certificateInstanceAction, deployedCertificateDomains, visibleCertificateInstances } from '../src/renderer/utils/certificateDeployment'
import type { ApiResult, CertificateAutomationState, CertificateMonitorStatus, CertificateProgressEvent } from '../src/shared/types'
import { isNewerStableVersion } from '../src/shared/updateVersion'

test('update version comparison handles numeric versions and rejects non-stable tags', () => {
  assert.equal(isNewerStableVersion('1.9.0', 'v1.10.0'), true)
  assert.equal(isNewerStableVersion('1.10.0', '1.9.0'), false)
  assert.equal(isNewerStableVersion('1.0.2', 'v1.0.2'), false)
  assert.throws(() => isNewerStableVersion('1.0.2', 'v1.0.3-beta'))
})

function status(state: CertificateAutomationState = 'idle', busy = false): CertificateMonitorStatus {
  return { settings: { enabled: true, domain: 'example.com', checkHour: 7, warningDays: 7 }, credentialsConfigured: true, accessKeyIdMasked: 'TEST****ID', certificates: [], automation: { state }, busy }
}
function fixture() {
  setActivePinia(createPinia())
  let listener: (event: CertificateProgressEvent) => void = () => {}
  let resolve!: (value: ApiResult<CertificateMonitorStatus>) => void
  let calls = 0
  const completion = new Promise<ApiResult<CertificateMonitorStatus>>(done => { resolve = done })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ftpApi: {
    onCertificateProgress: (callback: typeof listener) => { listener = callback; return () => {} },
    getCertificateStatus: async () => ({ ok: true, data: status() }),
    refreshCertificateList: async () => ({ ok: true, data: status() }),
    resumeCertificateDeployment: () => { calls++; return completion },
    executeSelectedCertificate: () => { calls++; return completion }
  } } })
  const store = useCertificateStore()
  store.status = status()
  store.bind()
  return { store, resolve, calls: () => calls, emit: (state: CertificateAutomationState, busy: boolean, message: string, operation: 'monitor' | 'deploy' = 'deploy') => listener({ state, message, updatedAt: new Date().toISOString(), status: { ...status(state, busy), operation } }) }
}
const selected = { instanceId: 'cas-issued', certificateId: 456, resourceIds: [7] }
const resources = [
  { id: 7, domain: 'example.com', instanceId: 'HOST-1', regionId: 'cn-hangzhou' },
  { id: 8, domain: 'www.example.com', instanceId: 'HOST-1', regionId: 'cn-hangzhou' },
  { id: 9, domain: 'other.example', instanceId: 'HOST-1', regionId: 'cn-hangzhou' }
]

test('deployment progress appears before IPC completes and survives page consumers', async () => {
  const f = fixture()
  const running = f.store.executeSelected(selected)
  assert.equal(f.store.workflow?.kind, 'deploy')
  assert.equal(f.store.workflow?.running, true)
  f.emit('deploying', true, '成功 1/2')
  assert.equal(useCertificateStore().workflow?.message, '成功 1/2')
  f.emit('verifying', true, '正在核验线上证书')
  f.emit('succeeded', true, '所有目标已生效')
  f.emit('succeeded', false, '检查与任务状态已更新')
  f.resolve({ ok: true, data: status('succeeded') })
  await running
  assert.equal(f.store.workflow?.message, '所有目标已生效')
  assert.equal(f.store.workflow?.running, false)
})
test('deployment failure stops animation and keeps the last real phase', async () => {
  const f = fixture()
  const running = f.store.executeSelected(selected)
  f.emit('verifying', true, '等待生效')
  f.resolve({ ok: false, error: { code: 'VERIFY_FAILED', message: '尚未生效' } })
  await running
  assert.equal(f.store.workflow?.state, 'failed')
  assert.equal(f.store.workflow?.phase, 'verifying')
  assert.equal(f.store.loading, false)
})
test('monitoring is marked as monitor, never as automatic deployment', () => {
  const f = fixture()
  f.emit('checking', true, '读取线上证书', 'monitor')
  assert.equal(f.store.workflow?.kind, 'monitor')
  f.emit('idle', false, '检查完成', 'monitor')
  assert.equal(f.store.workflow?.running, false)
})
test('default selection includes the domain and www only on the same host', () => {
  assert.deepEqual(defaultCertificateTargets(resources, 'example.com', []), [7, 8])
  assert.deepEqual(defaultCertificateTargets(resources, 'example.com', [7]), [7, 8])
  assert.deepEqual(defaultCertificateTargets(resources, 'www.example.com', []), [8, 7])
  assert.deepEqual(defaultCertificateTargets(resources, 'missing.example', []), [])
  assert.deepEqual(defaultCertificateTargets(resources.map(item => item.id === 8 ? { ...item, instanceId: 'HOST-2' } : item), 'example.com', []), [7])
  assert.deepEqual(defaultCertificateTargets(resources, 'example.com', [999]), [999])
})
test('each instance exposes exactly one action based on cloud status and submission history', () => {
  const pending = { instanceId: 'cas-free', name: '', domain: '', status: 'inactive', available: true }
  const attempt = (phase: 'configured' | 'submitted' | 'uncertain' | 'cleared') => [{ instanceId: 'cas-free', domain: 'example.com', phase, updatedAt: '' }]
  assert.equal(certificateInstanceAction(pending, []), 'apply')
  assert.equal(certificateInstanceAction(pending, attempt('configured')), 'apply')
  assert.equal(certificateInstanceAction(pending, attempt('cleared')), 'apply')
  assert.equal(certificateInstanceAction(pending, attempt('submitted')), 'inspect')
  assert.equal(certificateInstanceAction(pending, attempt('uncertain')), 'inspect')
  assert.equal(certificateInstanceAction({ ...pending, available: false }, []), 'inspect')
  assert.equal(certificateInstanceAction({ ...pending, certificateId: 456, certificateStatus: 'issued' }, attempt('submitted')), 'deploy')
})
test('confirmation retains only the selected certificate, domains and deployment charge warning', () => {
  assert.equal(certificateConfirmation(456, ['example.com', 'www.example.com']), '将证书 456 部署到 example.com、www.example.com？\n可能消耗云产品部署次数。')
})
test('duplicate clicks cannot initiate a second deployment or reset its timer', async () => {
  const f = fixture()
  const running = f.store.executeSelected(selected)
  const started = f.store.workflow?.startedAt
  await f.store.executeSelected(selected)
  assert.equal(f.calls(), 1)
  assert.equal(f.store.workflow?.startedAt, started)
  f.resolve({ ok: true, data: status('succeeded') })
  await running
})
test('stop bypasses loading lock and preserves the saved deployment identity', async () => {
  const f = fixture()
  window.ftpApi.stopCertificateTask = async () => {
    const data = { ...status('stopped'), automation: { state: 'stopped' as const, paused: true, instanceId: 'cas-issued' } }
    f.resolve({ ok: true, data })
    return { ok: true, data }
  }
  const running = f.store.executeSelected(selected)
  await f.store.stopTask()
  await running
  assert.equal(f.store.workflow?.running, false)
  assert.equal(f.store.workflow?.state, 'stopped')
  assert.equal(f.store.status?.automation.instanceId, 'cas-issued')
  assert.equal(f.store.stopping, false)
})
test('ending a task clears old UI state and releases the selection lock', async () => {
  const f = fixture()
  f.store.status = { ...status('stopped'), automation: { state: 'stopped', instanceId: 'old-app', mode: 'renewal' } }
  window.ftpApi.endCertificateTask = async () => ({ ok: true, data: status('stopped') })
  await f.store.endTask()
  assert.equal(f.store.status?.automation.instanceId, undefined)
  assert.equal(f.store.workflow, null)
})
test('error can be dismissed without deleting saved cloud task identity', () => {
  const f = fixture()
  f.store.status = { ...status('failed'), automation: { state: 'failed', instanceId: 'cas-issued', lastError: { code: 'FAILED', message: '部署失败' } } }
  f.store.dismissError()
  assert.equal(f.store.errorNotice, null)
  assert.equal(f.store.status.automation.instanceId, 'cas-issued')
})
test('page has distinct manual application, validation and deployment controls', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/renderer/pages/CertificatePage.vue'), 'utf8')
  for (const removed of ['申请并部署', 'settings.autoApply', 'settings.autoDeploy', 'deployAction', 'quota-steps']) assert.equal(page.includes(removed), false, removed)
  for (const required of ['label="监控配置"', 'label="证书与部署"', 'aria-label="中止证书任务"', 'aria-label="结束本地任务"', 'aria-label="申请证书"', 'aria-label="查看验证信息"', 'aria-label="部署已签发证书"', '刷新证书']) assert.equal(page.includes(required), true, required)
})

test('application UI returns immediately with a submitted journal state', async () => {
  const f = fixture()
  window.ftpApi.applyCertificate = async input => ({ ok: true, data: { status: { ...status('succeeded'), applications: [{ instanceId: input.instanceId, domain: input.domain, phase: 'submitted', updatedAt: '' }] } } })
  assert.equal(await f.store.applyCertificate('cas-free', 'example.com'), true)
  assert.equal(f.store.workflow?.running, false)
  assert.equal(f.store.status?.applications?.[0].phase, 'submitted')
})

test('validation details can be requested separately without starting deployment', async () => {
  const f = fixture()
  window.ftpApi.inspectCertificateApplication = async instanceId => ({ ok: true, data: { status: status('idle'), details: { instanceId, domain: 'example.com', status: 'pending', certificateStatus: '', validationMethod: 'DNS', available: false, hasValidation: true, records: [{ domain: 'example.com', rootDomain: 'example.com', type: 'TXT', name: '_dnsauth', value: 'token' }] } } })
  const details = await f.store.inspectApplication('cas-free')
  assert.equal(details?.records[0].name, '_dnsauth')
  assert.equal(f.calls(), 0)
  assert.equal(f.store.workflow?.running, false)
})

test('local uncertainty requires an explicit clearing action', async () => {
  const f = fixture()
  let clears = 0
  window.ftpApi.clearCertificateApplicationUncertainty = async instanceId => { clears++; return { ok: true, data: { ...status('succeeded'), applications: [{ instanceId, domain: 'example.com', phase: 'cleared', updatedAt: '' }] } } }
  assert.equal(await f.store.clearApplicationUncertainty('cas-free'), true)
  assert.equal(clears, 1)
  assert.equal(f.store.status?.applications?.[0].phase, 'cleared')
})

test('refresh succeeds normally even if the previous persisted task was stopped', async () => {
  const f = fixture()
  f.store.status = { ...status('stopped'), automation: { state: 'stopped', paused: true } }
  window.ftpApi.refreshCertificateList = async () => ({ ok: true, data: { ...status('stopped'), automation: { state: 'stopped', paused: true } } })
  await f.store.refreshCertificates()
  assert.equal(f.store.workflow?.kind, 'refresh')
  assert.equal(f.store.workflow?.state, 'succeeded')
  assert.equal(f.store.workflow?.running, false)
})

test('resource selection receives the explicit refreshed list', async () => {
  const f = fixture()
  window.ftpApi.listCertificateResources = async () => ({ ok: true, data: { status: status('idle'), resources: [{ id: 7, domain: 'example.com', regionId: '' }] } })
  assert.equal(await f.store.loadResources(), true)
  assert.equal(f.store.resources[0].id, 7)
  assert.equal(f.store.resourcesKnown, true)
  assert.equal(f.store.workflow?.kind, 'resources')
  assert.equal(f.store.workflow?.state, 'succeeded')
})

test('deployment markers match certificate IDs and list only matching domains', () => {
  const rows = [
    { id: 1, domain: 'example.com', regionId: '', certificateId: 123 },
    { id: 2, domain: 'www.example.com', regionId: '', certificateId: '123' as unknown as number },
    { id: 3, domain: 'other.example', regionId: '', certificateId: 456 }
  ]
  assert.deepEqual(deployedCertificateDomains(123, rows), ['example.com', 'www.example.com'])
  assert.deepEqual(deployedCertificateDomains(789, rows), [])
})

test('only earlier certificates for the same domains are hidden when deployment is known', () => {
  const base = { name: '', status: '', available: false, certificateStatus: 'issued' }
  const rows = [
    { ...base, instanceId: 'deployed', certificateId: 1, domain: 'example.com,www.example.com', certificateExpiresAt: '2027-02-15T00:00:00Z' },
    { ...base, instanceId: 'old', certificateId: 2, domain: 'www.example.com, example.com', certificateExpiresAt: '2027-02-14T00:00:00Z' },
    { ...base, instanceId: 'equal', certificateId: 3, domain: 'example.com,www.example.com', certificateExpiresAt: '2027-02-15T00:00:00Z' },
    { ...base, instanceId: 'other', certificateId: 4, domain: 'other.example', certificateExpiresAt: '2027-02-14T00:00:00Z' },
    { ...base, instanceId: 'unknown', certificateId: 5, domain: 'example.com,www.example.com' },
    { ...base, instanceId: 'pending', domain: 'example.com,www.example.com' }
  ]
  const hosts = [{ id: 1, domain: 'example.com', regionId: '', certificateId: 1 }]
  assert.deepEqual(visibleCertificateInstances(rows, hosts, true).map(item => item.instanceId), ['deployed', 'equal', 'other', 'unknown', 'pending'])
  assert.equal(visibleCertificateInstances(rows, hosts, false).length, rows.length)
})
