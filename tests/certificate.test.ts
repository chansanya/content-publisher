import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { CertificateService, type AliyunCertificateApi, type CertificateServiceDeps } from '../src/main/services/certificateService'
import { certificateCoversDomain, mergeApplicationAttempts, nextCertificateCheck, normalizeCertificateDomain, validateDeploymentResourceIds } from '../src/main/services/certificatePolicy'
import type { CertificateApplicationAttempt, CertificateApplicationDetail, CertificateAutomationRecord, CertificateInstanceSummary, CertificateMonitorSettings, CertificateProgressEvent, CertificateSnapshot } from '../src/shared/types'

const oldExpiry = new Date(Date.now() + 5 * 86400000).toISOString()
const newExpiry = new Date(Date.now() + 90 * 86400000).toISOString()
const selected = { instanceId: 'cas-issued', certificateId: 456, resourceIds: [7] }
const issued = () => ({ certificateId: '456', domains: ['example.com'], serialNumber: 'NEW', validTo: newExpiry })
function snapshot(domain = 'example.com', renewed = false): CertificateSnapshot {
  return { domain, subject: domain, issuer: 'test CA', serialNumber: renewed ? 'NEW' : 'OLD', fingerprint256: renewed ? 'NEW_FP' : 'OLD_FP', validFrom: new Date().toISOString(), validTo: renewed ? newExpiry : oldExpiry, remainingDays: renewed ? 90 : 5, checkedAt: new Date().toISOString() }
}
class MemoryStore {
  settings: CertificateMonitorSettings = { enabled: true, domain: 'example.com', checkHour: 7, warningDays: 7 }
  automation: CertificateAutomationRecord = { state: 'idle' }
  history: CertificateAutomationRecord[] = []
  certificate?: CertificateSnapshot
  certificates: CertificateInstanceSummary[] = []
  attempts: CertificateApplicationAttempt[] = []
  getSettings() { return { ...this.settings } }
  saveSettings(value: CertificateMonitorSettings) { this.settings = value; return value }
  credentialsConfigured() { return true }
  accessKeyIdMasked() { return 'TEST****ID' }
  saveCredentials() {}
  getCredentials() { return { accessKeyId: 'TEST_ID', accessKeySecret: 'TEST_SECRET' } }
  clearCredentials() {}
  getCertificate() { return this.certificate }
  setCertificate(value: CertificateSnapshot) { this.certificate = value }
  getCertificates() { return this.certificates }
  setCertificates(value: CertificateInstanceSummary[]) { this.certificates = value }
  getApplicationAttempts() { return this.attempts.map(item => ({ ...item })) }
  setApplicationAttempt(value: CertificateApplicationAttempt) { this.attempts = [...this.attempts.filter(item => item.instanceId !== value.instanceId), value] }
  getAutomation() { return { ...this.automation } }
  setAutomation(patch: Partial<CertificateAutomationRecord>) { return this.automation = { ...this.automation, ...patch } }
  endAutomation() { this.history.push({ ...this.automation }); this.automation = { state: 'stopped', paused: true, domain: this.settings.domain } }
}
function fixture() {
  const store = new MemoryStore()
  const events: CertificateProgressEvent[] = []
  const calls = { create: 0, start: 0, metadata: 0, list: 0, inspect: 0, configure: 0, submit: 0 }
  const api: AliyunCertificateApi = {
    listCertificates: async () => { calls.list++; return [{ instanceId: 'cas-issued', name: 'site', status: 'normal', domain: 'example.com', certificateId: 456, certificateStatus: 'issued', certificateExpiresAt: newExpiry }] },
    getApplicationDetails: async (instanceId) => { calls.inspect++; return { instanceId, domain: '', status: 'inactive', certificateStatus: '', validationMethod: '', available: true, hasValidation: false, records: [] } },
    configureApplication: async () => { calls.configure++ },
    submitApplication: async () => { calls.submit++ },
    getIssuedCertificate: async () => { calls.metadata++; return issued() },
    listWebHostingResources: async () => [{ id: 7, domain: 'example.com', instanceId: 'HOST-1', regionId: 'cn-hangzhou' }],
    getContactId: async () => 9,
    createDeployment: async (_cert, ids) => { calls.create++; assert.deepEqual(ids, [7]); return 789 },
    startDeployment: async () => { calls.start++; assert.equal(store.automation.deploymentJobId, 789) },
    getDeploymentStatus: async () => ({ workerCount: 1, successCount: 1, failedCount: 0, finished: true, success: true, errors: [] })
  }
  const deps: CertificateServiceDeps = { store, baseDir: () => '.', dataDir: () => '.', createAliyun: () => api, checkWebsite: async domain => snapshot(domain, calls.start > 0), sendLog: () => {}, sendProgress: event => events.push(event), wait: async () => {} }
  return { store, api, deps, calls, events, service: new CertificateService(deps) }
}
function sdk() {
  const { AliyunCertificateService } = require(process.env.CERTIFICATE_RUNTIME_BUNDLE!)
  const service = new AliyunCertificateService({ accessKeyId: 'TEST_ID', accessKeySecret: 'TEST_SECRET' })
  for (const name of ['listInstances', 'getInstanceDetail', 'getCertificateDetail', 'listCloudResources', 'listContact', 'createDeploymentJob', 'describeDeploymentJob', 'updateDeploymentJobStatus', 'describeDeploymentJobStatus', 'listWorkerResource', 'applyCertificate', 'updateInstance']) service.client[name] = async () => { throw new Error(`Unexpected cloud call: ${name}`) }
  return service
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
async function immediate<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_done, fail) => { timer = setTimeout(() => fail(new Error('Stop waited for the cloud')), 500) })]) }
  finally { if (timer) clearTimeout(timer) }
}

test('domain, schedule, SAN and resource validation remain strict', () => {
  assert.equal(normalizeCertificateDomain('https://EXAMPLE.com/'), 'example.com')
  for (const domain of ['localhost', '*.example.com', '127.0.0.1', 'example.com/a', 'https://u:p@example.com', 'example.com:444']) assert.throws(() => normalizeCertificateDomain(domain))
  assert.equal(nextCertificateCheck(7, new Date(2026, 10, 17, 7)).getDate(), 18)
  assert.equal(certificateCoversDomain(['example.com'], 'www.example.com'), false)
  assert.equal(certificateCoversDomain(['*.example.com'], 'www.example.com'), true)
  assert.equal(certificateCoversDomain(['*.example.com'], 'a.b.example.com'), false)
  for (const ids of [[], [0], [-1], [1.5], ['7'], [7, 7]]) assert.throws(() => validateDeploymentResourceIds(ids, true))
})
test('monitor and certificate list refresh cannot initiate or resume cloud deployment', async () => {
  const f = fixture()
  f.store.automation = { state: 'stopped', paused: true, mode: 'deploy-existing', instanceId: 'cas-issued', certificateId: '456', deploymentJobId: 789 }
  await f.service.checkNow()
  assert.equal((await f.service.refreshCertificates()).certificates?.length, 1)
  assert.deepEqual(f.calls, { create: 0, start: 0, metadata: 0, list: 1, inspect: 0, configure: 0, submit: 0 })
})
test('selected issued certificate deploys and is verified online', async () => {
  const f = fixture()
  const result = await f.service.executeSelected(selected)
  assert.equal(result.automation.state, 'succeeded')
  assert.equal(result.busy, false)
  assert.equal(f.calls.create, 1)
  assert.equal(f.calls.start, 1)
  assert.equal(f.events.at(-1)?.status.busy, false)
})
test('multi-resource deployment verifies every selected domain', async () => {
  const f = fixture()
  f.api.getIssuedCertificate = async () => ({ ...issued(), domains: ['example.com', 'www.example.com'] })
  f.api.listWebHostingResources = async () => [{ id: 7, domain: 'example.com', regionId: '' }, { id: 8, domain: 'www.example.com', regionId: '' }]
  f.api.createDeployment = async (_cert, ids) => { f.calls.create++; assert.deepEqual(ids, [7, 8]); return 789 }
  const seen = new Set<string>()
  f.deps.checkWebsite = async domain => { if (f.calls.start) seen.add(domain); return snapshot(domain, f.calls.start > 0) }
  assert.equal((await f.service.executeSelected({ ...selected, resourceIds: [7, 8] })).automation.state, 'succeeded')
  assert.deepEqual([...seen], ['example.com', 'www.example.com'])
})

test('invalid certificate identity and uncovered or rebound resources stop before deployment', async () => {
  const f = fixture()
  await assert.rejects(f.service.executeSelected({ ...selected, certificateId: 0 }), /证书 ID/)
  await assert.rejects(f.service.executeSelected({ ...selected, certificateId: 999 }), /证书已发生变化/)
  await assert.rejects(f.service.executeSelected({ ...selected, resourceDomains: ['www.example.com'] }), /域名已发生变化/)
  f.api.listWebHostingResources = async () => [{ id: 8, domain: 'other.example', regionId: '' }]
  await assert.rejects(f.service.executeSelected({ ...selected, resourceIds: [8] }), /不覆盖/)
  assert.equal(f.calls.create, 0)
})
test('already live certificate is a no-op and validity downgrade is refused', async () => {
  const f = fixture()
  f.deps.checkWebsite = async domain => snapshot(domain, true)
  assert.equal((await f.service.executeSelected(selected)).automation.state, 'succeeded')
  assert.equal(f.calls.create, 0)
  const older = fixture()
  older.api.getIssuedCertificate = async () => ({ ...issued(), validTo: oldExpiry })
  older.deps.checkWebsite = async domain => snapshot(domain, true)
  await assert.rejects(older.service.executeSelected(selected), /降级/)
})
test('any renewed certificate is not enough: the selected serial must be live', async () => {
  const f = fixture()
  f.deps.checkWebsite = async domain => ({ ...snapshot(domain, f.calls.start > 0), serialNumber: 'OTHER' })
  await assert.rejects(f.service.executeSelected(selected), /尚未呈现所选证书/)
  assert.equal(f.store.automation.deploymentJobId, 789)
})
test('unknown creation response cannot create a duplicate deployment', async () => {
  const f = fixture()
  f.api.createDeployment = async () => { f.calls.create++; throw new Error('timeout') }
  await assert.rejects(f.service.executeSelected(selected), /timeout/)
  await assert.rejects(f.service.resumeDeployment(), /未确认/)
  assert.equal(f.calls.create, 1)
})
test('a failed job start resumes the saved JobId', async () => {
  const f = fixture()
  f.api.startDeployment = async () => { throw new Error('start timeout') }
  await assert.rejects(f.service.executeSelected(selected), /start timeout/)
  f.api.startDeployment = async () => { f.calls.start++ }
  assert.equal((await new CertificateService(f.deps).resumeDeployment()).automation.state, 'succeeded')
  assert.equal(f.calls.create, 1)
  assert.equal(f.calls.start, 1)
})
test('old application tasks cannot resume and ending them releases the lock', async () => {
  const f = fixture()
  f.store.automation = { state: 'stopped', mode: 'renewal', instanceId: 'old-app', applicationPending: true }
  await assert.rejects(f.service.resumeDeployment(), /旧申请任务请先结束/)
  f.service.endTask()
  assert.equal(f.store.history[0].instanceId, 'old-app')
  assert.equal(f.store.automation.instanceId, undefined)
  assert.equal((await f.service.executeSelected(selected)).automation.state, 'succeeded')
})
test('local stop returns immediately even when metadata request never returns', async () => {
  const f = fixture()
  const gate = deferred<ReturnType<typeof issued>>()
  f.api.getIssuedCertificate = () => gate.promise
  const running = f.service.executeSelected(selected)
  await nextTurn()
  f.service.requestStop()
  assert.equal((await immediate(running)).automation.state, 'stopped')
  assert.equal(f.service.getStatus().busy, false)
  assert.throws(() => f.service.endTask(), /在途请求/)
  gate.resolve(issued())
  await nextTurn()
  assert.equal(f.service.getStatus().settling, false)
  assert.equal(f.calls.create, 0)
})
test('stop interrupts a deployment poll timer without losing the JobId', async () => {
  const f = fixture()
  const entered = deferred<void>()
  f.api.getDeploymentStatus = async () => ({ workerCount: 1, successCount: 0, failedCount: 0, finished: false, success: false, errors: [] })
  f.deps.wait = () => { entered.resolve(); return new Promise<void>(() => {}) }
  const running = f.service.executeSelected(selected)
  await entered.promise
  f.service.requestStop()
  assert.equal((await immediate(running)).automation.state, 'stopped')
  await nextTurn()
  assert.equal(f.store.automation.deploymentJobId, 789)
  assert.equal(f.service.getStatus().settling, false)
})
test('late JobId is saved but is not started until manual resume', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const gate = deferred<number>()
  f.api.createDeployment = async () => { f.calls.create++; entered.resolve(); return gate.promise }
  const running = f.service.executeSelected(selected)
  await entered.promise
  f.service.requestStop()
  await immediate(running)
  gate.resolve(789)
  await nextTurn()
  assert.equal(f.store.automation.deploymentJobId, 789)
  assert.equal(f.calls.start, 0)
  assert.equal((await f.service.resumeDeployment()).automation.state, 'succeeded')
  assert.equal(f.calls.create, 1)
})
test('SDK lists signed certificates and available V2 test instances', async () => {
  const service = sdk()
  service.client.listInstances = async (request: { instanceType?: string; versionType?: string }) => {
    assert.equal(request.constructor.name, 'ListInstancesRequest')
    assert.equal(request.instanceType, undefined)
    assert.equal(request.versionType, undefined)
    return { body: { totalCount: 3, instanceList: [
      { instanceId: 'paid', certificateId: 456, certificateStatus: 'issued', certificateNotAfter: Date.parse(newExpiry), domain: 'example.com', instanceType: 'DV' },
      { instanceId: 'free', certificateId: 457, certificateStatus: 'willExpire', domain: 'example.com', instanceType: 'TEST' },
      { instanceId: 'pending', status: 'inactive', domain: '' }
    ] } }
  }
  const result = await service.listCertificates()
  assert.deepEqual(result.map((item: CertificateInstanceSummary) => item.instanceId), ['paid', 'free', 'pending'])
  assert.equal(result[0].certificateExpiresAt, newExpiry)
  assert.equal(result[2].available, true)
  for (const name of ['applyExistingInstance', 'getApplicationState', 'getInstanceApplicationState', 'getFreeQuota', 'checkDnsValidation', 'ensureDnsValidation']) assert.equal(typeof service[name], 'undefined')
})
test('certificate list pagination and permission errors are explicit', async () => {
  const service = sdk()
  await assert.rejects(service.listCertificates(), /查询证书实例失败/)
  service.client.listInstances = async () => ({ body: { totalCount: 1, instanceList: [] } })
  await assert.rejects(service.listCertificates(), /分页不完整/)
})

test('SDK validates expiry, private key availability and SAN coverage using metadata only', async () => {
  for (const failure of ['', 'expired', 'key', 'domain', 'changed']) {
    const service = sdk()
    service.client.getInstanceDetail = async () => ({ body: { instanceId: 'cas-issued', certificateId: 456, certificateStatus: 'issued' } })
    service.client.getCertificateDetail = async (request: { certificateId: number }) => {
      assert.equal(request.constructor.name, 'GetCertificateDetailRequest')
      return { body: { certificateId: failure === 'changed' ? 999 : 456, instanceId: 'cas-issued', certificateStatus: 'issued', existPrivateKey: failure !== 'key', serial: 'ABC123', notBefore: Date.now() - 1000, notAfter: Date.now() + (failure === 'expired' ? -1000 : 86400000), subjectAlternativeNames: failure === 'domain' ? ['other.example'] : ['example.com'] } }
    }
    if (failure) await assert.rejects(service.getIssuedCertificate('cas-issued', 'example.com'))
    else assert.equal('key' in await service.getIssuedCertificate('cas-issued', 'example.com'), false)
  }
})
test('SDK does not schedule a job when stopped during its status query', async () => {
  const service = sdk()
  const controller = new AbortController()
  let schedules = 0
  service.client.describeDeploymentJob = async () => { controller.abort(); return { body: { status: 'editing' } } }
  service.client.updateDeploymentJobStatus = async () => { schedules++; return {} }
  await assert.rejects(service.startDeployment(789, controller.signal), /本地证书任务已中止/)
  assert.equal(schedules, 0)
})
test('SDK submits every selected resource and refuses partial success as completed', async () => {
  const service = sdk()
  service.client.createDeploymentJob = async (request: { resourceIds: string; certIds: string }) => { assert.equal(request.resourceIds, '7,8'); assert.equal(request.certIds, '456'); return { body: { jobId: 789 } } }
  assert.equal(await service.createDeployment('456', [7, 8], 9, 'example.com'), 789)
  service.client.describeDeploymentJobStatus = async () => ({ body: { workerCount: 2, successCount: 1, failedCount: 0 } })
  service.client.listWorkerResource = async () => ({ body: { total: 2, data: [{ status: 'success' }, { status: 'processing' }] } })
  assert.equal((await service.getDeploymentStatus(789)).finished, false)
})
test('resource listing paginates safely and excludes unrelated products', async () => {
  const service = sdk()
  service.client.listCloudResources = async (request: { currentPage: number }) => ({ body: { total: 2, data: request.currentPage === 1 ? [{ id: 7, domain: 'example.com', cloudProduct: 'webHosting', instanceId: 'HOST-1' }] : [{ id: 8, domain: 'cdn.example.com', cloudProduct: 'cdn' }] } })
  assert.equal((await service.listWebHostingResources()).length, 1)
  service.client.listCloudResources = async () => ({ body: { total: 1, data: [] } })
  await assert.rejects(service.listWebHostingResources(), /分页不完整/)
})
test('scheduler never applies automatically and provider never writes DNS records', () => {
  const root = process.cwd()
  const provider = readFileSync(path.join(root, 'src/main/services/aliyunCertificateService.ts'), 'utf8')
  const scheduler = readFileSync(path.join(root, 'src/main/services/certificateScheduler.ts'), 'utf8')
  for (const removed of ['DescribeCertificateStateRequest', 'AliyunDnsService', 'alidns']) assert.equal(provider.includes(removed), false)
  assert.match(scheduler, /await this\.service\.checkNow\(\)/)
  assert.equal(scheduler.includes('resumeDeployment'), false)
  assert.equal(scheduler.includes('applyCertificate'), false)
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['@alicloud/alidns20150109'], undefined)
})

test('manual application submits once and returns without waiting for DNS or issuance', async () => {
  const f = fixture()
  f.deps.wait = async () => { throw new Error('Application must not poll') }
  const result = await f.service.applyCertificate('cas-free', 'example.com')
  assert.equal(result.status.automation.state, 'succeeded')
  assert.equal(result.status.applications?.find(item => item.instanceId === 'cas-free')?.phase, 'submitted')
  assert.equal(f.calls.inspect, 1)
  assert.equal(f.calls.configure, 1)
  assert.equal(f.calls.submit, 1)
  assert.equal(f.calls.create, 0)
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /禁止重复申请/)
  assert.equal(f.calls.submit, 1)
})

test('application rejects a domain changed after confirmation before any cloud call', async () => {
  const f = fixture()
  await assert.rejects(f.service.applyCertificate('cas-free', 'different.example'), /域名已变化/)
  assert.equal(f.calls.inspect, 0)
  assert.equal(f.calls.submit, 0)
})

test('unknown application response is kept uncertain and never resubmitted', async () => {
  const f = fixture()
  f.api.submitApplication = async () => { f.calls.submit++; throw new Error('timeout') }
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /timeout/)
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'uncertain')
  await assert.rejects(new CertificateService(f.deps).applyCertificate('cas-free', 'example.com'), /禁止重复申请/)
  assert.equal(f.calls.submit, 1)
})

test('already submitted validation and foreign domains do not trigger application writes', async () => {
  const foreign = fixture()
  foreign.api.getApplicationDetails = async instanceId => ({ instanceId, domain: 'other.example', status: 'inactive', certificateStatus: '', validationMethod: 'DNS', available: true, hasValidation: false, records: [] })
  await assert.rejects(foreign.service.applyCertificate('cas-free', 'example.com'), /其他域名/)
  assert.equal(foreign.calls.configure, 0)
  const existing = fixture()
  existing.api.getApplicationDetails = async instanceId => ({ instanceId, domain: 'example.com', status: 'inactive', certificateStatus: '', validationMethod: 'DNS', available: true, hasValidation: true, records: [{ domain: 'example.com', rootDomain: 'example.com', type: 'TXT', name: '_dnsauth', value: 'token' }] })
  await assert.rejects(existing.service.applyCertificate('cas-free', 'example.com'), /已有验证信息/)
  assert.equal(existing.store.getApplicationAttempts()[0].phase, 'submitted')
  assert.equal(existing.calls.submit, 0)
})

test('viewing validation details is read-only and can resolve an uncertain submission', async () => {
  const f = fixture()
  f.store.setApplicationAttempt({ instanceId: 'cas-free', domain: 'example.com', phase: 'uncertain', updatedAt: '' })
  f.api.getApplicationDetails = async instanceId => ({ instanceId, domain: 'example.com', status: 'pending', certificateStatus: '', validationMethod: 'DNS', available: false, hasValidation: true, records: [{ domain: 'example.com', rootDomain: 'example.com', type: 'TXT', name: '_dnsauth', value: 'token' }] })
  const result = await f.service.inspectApplication('cas-free')
  assert.equal(result.details?.records[0].name, '_dnsauth')
  assert.equal(result.status.applications?.[0].phase, 'submitted')
  assert.equal(f.calls.configure, 0)
  assert.equal(f.calls.submit, 0)
  assert.equal(f.calls.create, 0)
})

test('stop during configuration does not submit; a confirmed configuration can be resumed manually', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const gate = deferred<void>()
  f.api.configureApplication = async () => { f.calls.configure++; entered.resolve(); await gate.promise }
  const running = f.service.applyCertificate('cas-free', 'example.com')
  await entered.promise
  f.service.requestStop()
  assert.equal((await immediate(running)).status.automation.state, 'stopped')
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'configuring')
  gate.resolve()
  await nextTurn()
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'configured')
  assert.equal(f.calls.submit, 0)
  assert.equal((await f.service.applyCertificate('cas-free', 'example.com')).status.automation.state, 'succeeded')
  assert.equal(f.calls.submit, 1)
})

test('stop during submission returns immediately and a late success prevents another submission', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const gate = deferred<void>()
  f.api.submitApplication = async () => { f.calls.submit++; entered.resolve(); await gate.promise }
  const running = f.service.applyCertificate('cas-free', 'example.com')
  await entered.promise
  f.service.requestStop()
  await immediate(running)
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'submitting')
  gate.resolve()
  await nextTurn()
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'submitted')
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /禁止重复申请/)
  assert.equal(f.calls.submit, 1)
})

test('SDK selects DNS validation and does not submit while configuring', async () => {
  const service = sdk()
  let updates = 0
  let submissions = 0
  service.client.getInstanceDetail = async () => ({ body: { instanceId: 'cas-free', status: 'inactive', instanceType: 'TEST', versionType: 'basic', contactIdList: [9] } })
  service.client.updateInstance = async (request: { instanceId: string; domain: string; validationMethod: string }) => { updates++; assert.equal(request.instanceId, 'cas-free'); assert.equal(request.domain, 'example.com'); assert.equal(request.validationMethod, 'DNS'); return {} }
  service.client.applyCertificate = async () => { submissions++; return {} }
  await service.configureApplication('cas-free', 'example.com')
  assert.equal(updates, 1)
  assert.equal(submissions, 0)
  await service.submitApplication('cas-free')
  assert.equal(submissions, 1)
})

test('SDK exposes only DNS challenge records and never writes DNS', async () => {
  const service = sdk()
  service.client.getInstanceDetail = async () => ({ body: { instanceId: 'cas-free', status: 'pending', domain: 'example.com', validationMethod: 'DNS', domainValidationList: [
    { domain: 'example.com', rootDomain: 'example.com', validationType: 'TXT', validationKey: '_dnsauth', validationValue: 'token' },
    { domain: 'example.com', validationType: 'HTTP', validationKey: '/file.txt', validationValue: 'not-dns' }
  ] } })
  const result = await service.getApplicationDetails('cas-free')
  assert.deepEqual(result.records, [{ domain: 'example.com', rootDomain: 'example.com', type: 'TXT', name: '_dnsauth', value: 'token' }])
  assert.equal(typeof service.dns, 'undefined')
})

test('SDK detects existing HTTP validation even when there is no copyable DNS record', async () => {
  const service = sdk()
  service.client.getInstanceDetail = async () => ({ body: { instanceId: 'cas-free', status: 'inactive', domain: 'example.com', validationMethod: 'HTTP', domainValidationList: [{ validationType: 'HTTP', validationKey: '/file.txt', validationValue: 'token' }] } })
  const details = await service.getApplicationDetails('cas-free')
  assert.equal(details.hasValidation, true)
  assert.equal(details.records.length, 0)
  await assert.rejects(service.configureApplication('cas-free', 'example.com'), /已有验证信息/)
})

test('DNS configuration failure does not submit and leaves a guarded instance', async () => {
  const f = fixture()
  f.api.configureApplication = async () => { f.calls.configure++; throw new Error('connection timeout') }
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /timeout/)
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'uncertain')
  assert.equal(f.calls.submit, 0)
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /禁止重复申请/)
  assert.equal(f.calls.configure, 1)
})

test('historical unfinished application is treated as uncertain, and an explicit cleared record takes precedence', () => {
  const history = [{ endedAt: '2026-11-17', automation: { state: 'failed' as const, mode: 'renewal' as const, instanceId: 'cas-old', domain: 'example.com' } }]
  assert.equal(mergeApplicationAttempts({}, history)[0].phase, 'uncertain')
  const cleared: CertificateApplicationAttempt = { instanceId: 'cas-old', domain: 'example.com', phase: 'cleared', updatedAt: '' }
  assert.equal(mergeApplicationAttempts({ 'cas-old': cleared }, history)[0].phase, 'cleared')
  assert.equal(mergeApplicationAttempts({}, [{ ...history[0], automation: { ...history[0].automation, certificateId: '123' } }])[0].phase, 'uncertain')
})

test('refreshing validation promotes an issued instance to deployable without issuing or deploying it', async () => {
  const f = fixture()
  f.store.certificates = [{ instanceId: 'cas-free', name: '', status: 'pending', domain: 'example.com', available: false }]
  f.api.getApplicationDetails = async instanceId => ({ instanceId, domain: 'example.com', status: 'normal', certificateStatus: 'issued', certificateId: 456, certificateExpiresAt: newExpiry, validationMethod: 'DNS', available: false, hasValidation: false, records: [] })
  const result = await f.service.inspectApplication('cas-free')
  assert.equal(result.status.certificates?.[0].certificateId, 456)
  assert.equal(result.status.certificates?.[0].certificateStatus, 'issued')
  assert.equal(f.calls.submit, 0)
  assert.equal(f.calls.create, 0)
})

test('explicitly clearing an uncertain record rechecks the cloud before allowing an application', async () => {
  const f = fixture()
  f.store.setApplicationAttempt({ instanceId: 'cas-free', domain: 'example.com', phase: 'uncertain', updatedAt: '' })
  await f.service.clearApplicationUncertainty('cas-free')
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'cleared')
  assert.equal(f.calls.submit, 0)
  assert.equal((await f.service.applyCertificate('cas-free', 'example.com')).status.automation.state, 'succeeded')
  assert.equal(f.calls.submit, 1)
})

test('uncertainty cannot be cleared if any validation record exists, including HTTP', async () => {
  const f = fixture()
  f.store.setApplicationAttempt({ instanceId: 'cas-free', domain: 'example.com', phase: 'uncertain', updatedAt: '' })
  f.api.getApplicationDetails = async instanceId => ({ instanceId, domain: 'example.com', status: 'inactive', certificateStatus: '', validationMethod: 'HTTP', available: true, hasValidation: true, records: [] })
  await assert.rejects(f.service.clearApplicationUncertainty('cas-free'), /已有申请或验证信息/)
  assert.equal(f.store.getApplicationAttempts()[0].phase, 'uncertain')
  assert.equal(f.calls.submit, 0)
})

test('submitted applications cannot have their protection silently cleared', async () => {
  const f = fixture()
  f.store.setApplicationAttempt({ instanceId: 'cas-free', domain: 'example.com', phase: 'submitted', updatedAt: '' })
  await assert.rejects(f.service.clearApplicationUncertainty('cas-free'), /没有可解除/)
  assert.equal(f.calls.inspect, 0)
})

test('an outstanding deployment cannot be overwritten by application or validation requests', async () => {
  const f = fixture()
  f.store.automation = { state: 'failed', mode: 'deploy-existing', instanceId: 'cas-issued', deploymentJobId: 789 }
  await assert.rejects(f.service.applyCertificate('cas-free', 'example.com'), /未完成任务/)
  await assert.rejects(f.service.inspectApplication('cas-free'), /未完成任务/)
  assert.equal(f.store.automation.deploymentJobId, 789)
  assert.equal(f.calls.configure, 0)
})

test('validation lookup can be stopped without a false error or cloud write', async () => {
  const f = fixture()
  const gate = deferred<CertificateApplicationDetail>()
  f.api.getApplicationDetails = () => gate.promise
  const running = f.service.inspectApplication('cas-free')
  await nextTurn()
  f.service.requestStop()
  const result = await immediate(running)
  assert.equal(result.status.automation.state, 'stopped')
  assert.equal(result.details, undefined)
  gate.resolve({ instanceId: 'cas-free', domain: '', status: 'inactive', certificateStatus: '', validationMethod: '', available: true, hasValidation: false, records: [] })
  await nextTurn()
  assert.equal(f.calls.submit, 0)
})

test('refresh can be stopped immediately without overwriting cached certificates', async () => {
  const f = fixture()
  const gate = deferred<CertificateInstanceSummary[]>()
  f.api.listCertificates = () => gate.promise
  const running = f.service.refreshCertificates()
  await nextTurn()
  f.service.requestStop()
  assert.equal((await immediate(running)).automation.state, 'stopped')
  gate.resolve([{ instanceId: 'cas-free', name: '', domain: '', status: 'inactive', available: true }])
  await nextTurn()
  assert.equal(f.store.getCertificates().length, 0)
})

test('loading deployment resources is interruptible even if the cloud never returns', async () => {
  const f = fixture()
  const gate = deferred<{ id: number; domain: string; regionId: string }[]>()
  f.api.listWebHostingResources = () => gate.promise
  const running = f.service.listDeploymentResources()
  await nextTurn()
  f.service.requestStop()
  const result = await immediate(running)
  assert.equal(result.status.automation.state, 'stopped')
  assert.equal(result.resources, undefined)
  gate.resolve([{ id: 7, domain: 'example.com', regionId: '' }])
  await nextTurn()
  assert.equal(f.calls.create, 0)
})
