import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type {
  AppError,
  CertificateCredentialInput,
  CertificateMonitorSettings,
  CertificateMonitorStatus,
  CertificateApplicationDetail,
  CertificateCloudResource,
  CertificateExecuteInput,
  CertificateAutomationState,
  CertificateProgressEvent
} from '@shared/types'

type WorkflowKind = 'monitor' | 'deploy' | 'apply' | 'inspect' | 'refresh' | 'resources'
interface CertificateWorkflow {
  kind: WorkflowKind
  state: CertificateAutomationState
  phase: CertificateAutomationState
  message: string
  startedAt: number
  finishedAt?: number
  running: boolean
}

export const useCertificateStore = defineStore('certificate', () => {
  const status = ref<CertificateMonitorStatus | null>(null)
  const loading = ref(false)
  const stopping = ref(false)
  const error = ref<AppError | null>(null)
  const progress = ref<CertificateProgressEvent | null>(null)
  const resources = ref<CertificateCloudResource[]>([])
  const resourcesKnown = ref(false)
  const workflow = ref<CertificateWorkflow | null>(null)
  const dismissedErrorKey = ref('')
  const errorNotice = computed(() => errorKey() !== dismissedErrorKey.value ? error.value ?? status.value?.automation.lastError ?? null : null)
  let unbind: (() => void) | null = null

  function errorKey(): string {
    const issue = error.value ?? status.value?.automation.lastError
    return issue ? JSON.stringify([issue.code, issue.message, issue.detail]) : ''
  }

  function dismissError(): void {
    dismissedErrorKey.value = errorKey()
    if (workflow.value?.state === 'failed' && !workflow.value.running) workflow.value = null
  }

  function dismissWorkflow(): void {
    if (workflow.value?.running) return
    dismissError()
    workflow.value = null
  }

  function startWorkflow(kind: WorkflowKind): void {
    const messages: Record<WorkflowKind, string> = { deploy: '正在核对证书与部署目标', apply: '正在提交证书申请', inspect: '正在读取验证信息', refresh: '正在刷新证书实例', resources: '正在读取云资源', monitor: '正在检查线上证书' }
    workflow.value = { kind, state: 'checking', phase: 'checking', message: messages[kind], startedAt: Date.now(), running: true }
  }

  function workflowKind(operation: CertificateMonitorStatus['operation']): WorkflowKind {
    return operation ?? 'monitor'
  }

  function bind(): void {
    if (unbind) return
    unbind = window.ftpApi.onCertificateProgress((event) => {
      if (event.state === 'failed' && event.status.automation.updatedAt !== status.value?.automation.updatedAt) dismissedErrorKey.value = ''
      if (event.status.busy && !loading.value && !workflow.value?.running) {
        startWorkflow(workflowKind(event.status.operation))
      }
      progress.value = event
      status.value = event.status
      if (event.state === 'stopped' && workflow.value?.state === 'stopped' && event.message !== '检查与任务状态已更新') workflow.value.message = event.message
      if (workflow.value?.running) {
        const readOnlyFinal = event.message === '检查与任务状态已更新' && ['monitor', 'refresh', 'resources'].includes(workflow.value.kind)
        if (!readOnlyFinal) {
          workflow.value.state = event.state
          if (['checking', 'deploying', 'verifying', 'succeeded'].includes(event.state)) workflow.value.phase = event.state
        }
        if (event.message !== '检查与任务状态已更新') workflow.value.message = event.message
        if (!event.status.busy) {
          workflow.value.running = false
          workflow.value.finishedAt = Date.now()
        }
      }
    })
  }

  async function run<T>(task: () => Promise<{ ok: true; data: T } | { ok: false; error: AppError }>): Promise<T | null> {
    if (loading.value) return null
    loading.value = true
    error.value = null
    try {
      const result = await task()
      if (!result.ok) {
        dismissedErrorKey.value = ''
        error.value = result.error
        ElMessage.error(result.error.message)
        return null
      }
      return result.data
    } catch {
      dismissedErrorKey.value = ''
      error.value = { code: 'CERT_IPC_FAILED', message: '证书服务通信失败，请查看本地日志并重试' }
      ElMessage.error(error.value.message)
      return null
    } finally {
      loading.value = false
    }
  }

  async function load(): Promise<void> {
    const data = await run(() => window.ftpApi.getCertificateStatus())
    if (!data) return
    status.value = data
    if (data.busy && !workflow.value?.running) {
      startWorkflow(workflowKind(data.operation))
      workflow.value!.state = data.automation.state
      workflow.value!.phase = data.automation.state
      workflow.value!.message = '任务正在执行，等待云端状态更新'
    }
  }

  async function saveSettings(settings: CertificateMonitorSettings): Promise<boolean> {
    const data = await run(() => window.ftpApi.saveCertificateSettings(settings))
    if (!data) return false
    status.value = data
    ElMessage.success('证书监控设置已保存')
    return true
  }

  async function saveCredentials(input: CertificateCredentialInput): Promise<boolean> {
    const data = await run(() => window.ftpApi.saveCertificateCredentials(input))
    if (!data) return false
    resourcesKnown.value = false
    resources.value = []
    status.value = data
    ElMessage.success('阿里云 AccessKey 已加密保存')
    return true
  }

  async function clearCredentials(): Promise<void> {
    const data = await run(() => window.ftpApi.clearCertificateCredentials())
    if (data) {
      resourcesKnown.value = false
      resources.value = []
      status.value = data
      ElMessage.success('阿里云 AccessKey 已清除')
    }
  }

  async function checkNow(): Promise<void> {
    if (loading.value || status.value?.busy) return
    startWorkflow('monitor')
    const data = await run(() => window.ftpApi.checkCertificateNow())
    finishRead(data, '证书检查完成')
  }

  function finishRead(data: CertificateMonitorStatus | null, message: string): boolean {
    if (data) status.value = data
    const stopped = workflow.value?.state === 'stopped'
    if (workflow.value) {
      workflow.value.state = data ? stopped ? 'stopped' : 'succeeded' : 'failed'
      if (!data) workflow.value.message = error.value?.message ?? '读取失败'
      else if (!stopped) workflow.value.message = message
      workflow.value.running = false
      workflow.value.finishedAt ??= Date.now()
    }
    return Boolean(data && !stopped)
  }

  async function refreshCertificates(): Promise<void> {
    if (loading.value || status.value?.busy) return
    startWorkflow('refresh')
    const data = await run(() => window.ftpApi.refreshCertificateList())
    if (finishRead(data, '证书实例列表已更新') && data) ElMessage.success(`证书实例：${data.certificates?.length ?? 0} 个`)
  }

  async function resumeDeployment(): Promise<void> {
    await runWorkflow('deploy', () => window.ftpApi.resumeCertificateDeployment())
  }

  async function applyCertificate(instanceId: string, domain: string): Promise<boolean> {
    if (loading.value || status.value?.busy) return false
    startWorkflow('apply')
    const data = await run(() => window.ftpApi.applyCertificate({ instanceId, domain }))
    if (data) status.value = data.status
    if (workflow.value) {
      workflow.value.state = data?.status.automation.state ?? 'failed'
      if (!data) workflow.value.message = error.value?.message ?? '申请结果待核对'
      workflow.value.running = false
      workflow.value.finishedAt ??= Date.now()
    }
    if (data && data.status.automation.state === 'succeeded') {
      ElMessage.success('申请已提交，请查看 DNS 验证信息并稍后刷新状态')
      return true
    }
    return false
  }

  async function inspectApplication(instanceId: string): Promise<CertificateApplicationDetail | null> {
    if (loading.value || status.value?.busy) return null
    startWorkflow('inspect')
    const data = await run(() => window.ftpApi.inspectCertificateApplication(instanceId))
    if (data) status.value = data.status
    if (workflow.value) {
      workflow.value.state = data?.status.automation.state ?? 'failed'
      if (!data) workflow.value.message = error.value?.message ?? '读取验证信息失败'
      workflow.value.running = false
      workflow.value.finishedAt ??= Date.now()
    }
    return data?.details ?? null
  }

  async function clearApplicationUncertainty(instanceId: string): Promise<boolean> {
    if (loading.value || status.value?.busy) return false
    startWorkflow('inspect')
    const data = await run(() => window.ftpApi.clearCertificateApplicationUncertainty(instanceId))
    if (data) status.value = data
    if (workflow.value) {
      workflow.value.state = data?.automation.state ?? 'failed'
      if (!data) workflow.value.message = error.value?.message ?? '解除待核对标记失败'
      workflow.value.running = false
      workflow.value.finishedAt ??= Date.now()
    }
    if (!data || data.automation.state === 'stopped') return false
    ElMessage.success('本地待核对标记已解除')
    return true
  }

  async function stopTask(): Promise<void> {
    if (stopping.value) return
    stopping.value = true
    try {
      const result = await window.ftpApi.stopCertificateTask()
      if (!result.ok) {
        dismissedErrorKey.value = ''
        error.value = result.error
        ElMessage.error(result.error.message)
        return
      }
      status.value = result.data
      if (workflow.value && !result.data.busy) {
        workflow.value.state = result.data.automation.state
        workflow.value.running = false
        workflow.value.finishedAt ??= Date.now()
      }
      if (result.data.settling) {
        const latest = await window.ftpApi.getCertificateStatus()
        if (latest.ok) status.value = latest.data
      }
    } catch {
      ElMessage.error('中止请求发送失败，请确认主进程已更新并重试')
    } finally {
      stopping.value = false
    }
  }

  async function runWorkflow(kind: WorkflowKind, task: () => Promise<{ ok: true; data: CertificateMonitorStatus } | { ok: false; error: AppError }>): Promise<void> {
    if (loading.value || status.value?.busy) return
    startWorkflow(kind)
    const data = await run(task)
    if (data) status.value = data
    if (!workflow.value) return
    workflow.value.state = data?.automation.state ?? 'failed'
    if (!data) workflow.value.message = error.value?.message ?? '证书任务执行失败'
    workflow.value.running = false
    workflow.value.finishedAt ??= Date.now()
  }

  async function endTask(): Promise<void> {
    const data = await run(() => window.ftpApi.endCertificateTask())
    if (!data) return
    status.value = data
    workflow.value = null
    progress.value = null
    error.value = null
    ElMessage.success('本地任务已结束，可以重新选择证书')
  }

  async function loadResources(): Promise<boolean> {
    if (loading.value || status.value?.busy) return false
    resourcesKnown.value = false
    startWorkflow('resources')
    const data = await run(() => window.ftpApi.listCertificateResources())
    if (!finishRead(data?.status ?? null, '云资源列表已更新') || !data?.resources) return false
    resources.value = data.resources
    resourcesKnown.value = true
    return true
  }

  async function executeSelected(input: CertificateExecuteInput): Promise<void> {
    await runWorkflow('deploy', () => window.ftpApi.executeSelectedCertificate(input))
  }


  async function openConsole(): Promise<void> {
    const result = await window.ftpApi.openCertificateConsole()
    if (!result.ok) ElMessage.error(result.error.message)
  }


  return {
    status,
    loading,
    stopping,
    stopTask,
    endTask,
    error,
    errorNotice,
    dismissError,
    dismissWorkflow,
    progress,
    resources,
    resourcesKnown,
    workflow,
    loadResources,
    executeSelected,
    applyCertificate,
    inspectApplication,
    clearApplicationUncertainty,
    bind,
    load,
    saveSettings,
    saveCredentials,
    clearCredentials,
    checkNow,
    refreshCertificates,
    resumeDeployment,
    openConsole
  }
})
