import type {
  CertificateAutomationRecord,
  CertificateApplicationDetail,
  CertificateCloudResource,
  CertificateExecuteInput,
  CertificateCredentialInput,
  CertificateMonitorSettings,
  CertificateMonitorStatus,
  CertificateProgressEvent,
  OperationLogEvent
} from '@shared/types'
import { loadEnvConfig } from './envService'
import { ServiceError } from './errors'
import { AliyunCertificateService } from './aliyunCertificateService'
import { checkWebsiteCertificate } from './certificateMonitorService'
import { CertificateStore } from './certificateStore'
import { assertCertificateTaskRunning, certificateCoversDomain, certificateSerial, validateDeploymentResourceIds, safeCertificateError } from './certificatePolicy'

const DEPLOYMENT_POLL_MS = 30_000
const DEPLOYMENT_TIMEOUT_MS = 20 * 60_000
const LIVE_VERIFY_ATTEMPTS = 10
const LIVE_VERIFY_INTERVAL_MS = 30_000

export interface CertificateServiceDeps {
  baseDir: () => string
  dataDir: () => string
  sendLog: (event: OperationLogEvent) => void
  sendProgress: (event: CertificateProgressEvent) => void
  store?: Pick<CertificateStore, 'getSettings' | 'saveSettings' | 'credentialsConfigured' | 'accessKeyIdMasked' | 'saveCredentials' | 'getCredentials' | 'clearCredentials' | 'getCertificate' | 'setCertificate' | 'getCertificates' | 'setCertificates' | 'getApplicationAttempts' | 'setApplicationAttempt' | 'getAutomation' | 'setAutomation' | 'endAutomation'>
  createAliyun?: () => AliyunCertificateApi
  checkWebsite?: typeof checkWebsiteCertificate
  wait?: (ms: number) => Promise<void>
}

export type AliyunCertificateApi = Pick<AliyunCertificateService,
  'listCertificates' | 'getApplicationDetails' | 'configureApplication' | 'submitApplication' |
  'getContactId' | 'createDeployment' | 'startDeployment' | 'getDeploymentStatus' |
  'listWebHostingResources' | 'getIssuedCertificate'>

export class CertificateService {
  private readonly store: NonNullable<CertificateServiceDeps['store']>
  private busy = false
  private execution: AbortController | null = null
  private operation: 'monitor' | 'deploy' | 'apply' | 'inspect' | 'refresh' | 'resources' = 'monitor'

  constructor(private readonly deps: CertificateServiceDeps) {
    this.store = deps.store ?? new CertificateStore(deps.dataDir())
  }

  initializeDomainFromEnv(): void {
    const settings = this.store.getSettings()
    if (settings.domain) return
    const config = loadEnvConfig(this.deps.baseDir(), this.deps.dataDir())
    if (!config.ok || !config.data.webUrl) return
    try {
      const domain = new URL(config.data.webUrl).hostname
      this.store.saveSettings({ ...settings, domain })
    } catch {
      // WEB_URL 非法由配置页处理，证书模块保持未配置状态
    }
  }

  getStatus(): CertificateMonitorStatus {
    return {
      settings: this.store.getSettings(),
      credentialsConfigured: this.store.credentialsConfigured(),
      accessKeyIdMasked: this.store.accessKeyIdMasked(),
      certificate: this.store.getCertificate(),
      certificates: this.store.getCertificates(),
      applications: this.store.getApplicationAttempts(),
      automation: this.store.getAutomation(),
      busy: this.busy,
      settling: Boolean(this.execution && !this.busy),
      operation: this.busy ? this.operation : undefined
    }
  }

  saveSettings(settings: CertificateMonitorSettings): CertificateMonitorStatus {
    this.ensureIdle()
    this.store.saveSettings(settings)
    return this.getStatus()
  }

  saveCredentials(input: CertificateCredentialInput): CertificateMonitorStatus {
    this.ensureIdle()
    this.store.saveCredentials(input)
    return this.getStatus()
  }

  clearCredentials(): CertificateMonitorStatus {
    this.ensureIdle()
    this.store.clearCredentials()
    return this.getStatus()
  }

  setNextCheckAt(nextCheckAt: string): void {
    this.store.setAutomation({ nextCheckAt })
  }

  private log(level: OperationLogEvent['level'], message: string): void {
    this.deps.sendLog({ level, scope: 'certificate', message })
  }

  private progress(state: CertificateAutomationRecord['state'], message: string): void {
    if (state !== 'stopped') this.checkRunning()
    const updatedAt = new Date().toISOString()
    this.store.setAutomation({ state, updatedAt })
    this.deps.sendProgress({ state, message, updatedAt, status: this.getStatus() })
    this.log(state === 'failed' ? 'error' : state === 'succeeded' ? 'success' : 'info', message)
  }

  private readProgress(state: 'checking' | 'succeeded', message: string): void {
    this.checkRunning()
    this.deps.sendProgress({ state, message, updatedAt: new Date().toISOString(), status: this.getStatus() })
  }

  private aliyun(): AliyunCertificateApi {
    this.checkRunning()
    return this.deps.createAliyun?.() ?? new AliyunCertificateService(this.store.getCredentials())
  }

  private ensureIdle(): void {
    if (this.busy) throw new ServiceError('CERT_BUSY', '证书任务正在执行，请稍候')
    if (this.execution) throw new ServiceError('CERT_TASK_SETTLING', '本地任务已中止，在途请求仍待返回；为避免重复操作，暂不发起新任务')
  }

  private checkRunning(): void {
    assertCertificateTaskRunning(this.execution?.signal)
  }

  private async checkWebsite(domain: string) {
    this.checkRunning()
    const result = await (this.deps.checkWebsite ?? checkWebsiteCertificate)(domain)
    this.checkRunning()
    return result
  }

  private async wait(ms: number): Promise<void> {
    this.checkRunning()
    const signal = this.execution?.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        abort = () => reject(new ServiceError('CERT_TASK_STOPPED', '本地证书任务已中止'))
        signal?.addEventListener('abort', abort, { once: true })
        if (this.deps.wait) void this.deps.wait(ms).then(resolve, reject)
        else timer = setTimeout(resolve, ms)
      })
    } finally {
      if (timer) clearTimeout(timer)
      if (abort) signal?.removeEventListener('abort', abort)
    }
    this.checkRunning()
  }

  requestStop(): CertificateMonitorStatus {
    if (!this.execution || this.execution.signal.aborted) return this.getStatus()
    this.store.setAutomation({ paused: true, lastError: undefined })
    this.busy = false
    this.progress('stopped', '本地等待已中止；任务记录已保留，已发出的云端请求可能仍在处理')
    this.execution.abort()
    return this.getStatus()
  }

  endTask(): CertificateMonitorStatus {
    this.ensureIdle()
    this.store.endAutomation()
    this.progress('stopped', '本地任务已结束并归档，可重新选择证书；未撤销云端申请或部署')
    return this.getStatus()
  }

  private async withTask(action: () => Promise<void>, operation: 'monitor' | 'deploy' | 'apply' | 'inspect' | 'refresh' | 'resources' = 'monitor'): Promise<CertificateMonitorStatus> {
    this.ensureIdle()
    this.busy = true
    this.operation = operation
    const execution = new AbortController()
    this.execution = execution
    let settled = false
    let abort: (() => void) | undefined
    const work = Promise.resolve().then(action).catch(err => {
      const error = safeCertificateError(err)
      if (execution.signal.aborted && error.code !== 'CERT_TASK_STOPPED') this.log('warn', `本地已中止，在途请求返回错误：${error.message}${error.detail ? ` · ${error.detail}` : ''}`)
      throw err
    }).finally(() => {
      settled = true
      if (!this.busy && this.execution === execution) {
        this.execution = null
        if (execution.signal.aborted) this.progress('stopped', '本地任务已中止，在途请求已结束；可核对后手动接续')
      }
    })
    try {
      const stopped = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new ServiceError('CERT_TASK_STOPPED', '本地证书任务已中止'))
        execution.signal.addEventListener('abort', abort, { once: true })
      })
      await Promise.race([work, stopped])
    } catch (err) {
      const error = safeCertificateError(err)
      if (!execution.signal.aborted) {
        this.store.setAutomation({ state: 'failed', lastError: error })
        this.progress('failed', `${error.message}${error.detail ? ` · ${error.detail}` : ''}`)
        throw new ServiceError(error.code, error.message, error.detail)
      }
    } finally {
      if (abort) execution.signal.removeEventListener('abort', abort)
      this.busy = false
      if (settled && this.execution === execution) this.execution = null
      const status = this.getStatus()
      this.deps.sendProgress({ state: status.automation.state, message: status.automation.lastError?.message ?? '检查与任务状态已更新', updatedAt: new Date().toISOString(), status })
    }
    return this.getStatus()
  }

  async checkNow(): Promise<CertificateMonitorStatus> {
    const settings = this.store.getSettings()
    if (!settings.domain) throw new ServiceError('CERT_DOMAIN_MISSING', '请先配置证书监控域名')
    return this.withTask(async () => {
      const priorState = this.store.getAutomation().state
      this.progress('checking', `正在检查 ${settings.domain} 的线上证书`)
      const certificate = await this.checkWebsite(settings.domain)
      this.store.setCertificate(certificate)
      const active = this.store.getAutomation()
      this.store.setAutomation({ state: active.paused ? 'stopped' : active.orderId || active.instanceId ? priorState : 'idle', lastCheckAt: certificate.checkedAt })
      this.log('success', `证书检查完成 · 剩余 ${certificate.remainingDays} 天 · 到期 ${certificate.validTo}`)
      this.readProgress('succeeded', `证书检查完成 · 剩余 ${certificate.remainingDays} 天`)
    })
  }

  async refreshCertificates(): Promise<CertificateMonitorStatus> {
    return this.withTask(async () => {
      this.readProgress('checking', '正在刷新证书实例')
      const certificates = await this.aliyun().listCertificates()
      this.checkRunning()
      this.store.setCertificates(certificates)
      this.log('info', `证书实例列表已更新 · ${certificates.length} 个`)
      this.readProgress('succeeded', `证书实例列表已更新 · ${certificates.length} 个`)
    }, 'refresh')
  }

  private validateInstanceId(instanceId: string): void {
    if (typeof instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(instanceId)) throw new ServiceError('PARAM_INVALID', '证书实例 ID 非法')
  }

  private ensureNoPendingDeployment(): void {
    const task = this.store.getAutomation()
    if (task.instanceId || task.orderId || task.deploymentJobId || task.deploymentPending || task.applicationPending) throw new ServiceError('CERT_ACTIVE_TASK', '已有未完成任务，请先继续或结束本地任务')
  }

  async inspectApplication(instanceId: string): Promise<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }> {
    this.validateInstanceId(instanceId)
    this.ensureNoPendingDeployment()
    let details: CertificateApplicationDetail | undefined
    const status = await this.withTask(async () => {
      this.progress('checking', '正在读取证书 DNS 验证信息')
      details = await this.aliyun().getApplicationDetails(instanceId)
      this.checkRunning()
      const attempt = this.store.getApplicationAttempts().find(item => item.instanceId === instanceId)
      if (attempt && (details.hasValidation || details.status === 'pending' || ['issued', 'willExpire'].includes(details.certificateStatus))) {
        this.store.setApplicationAttempt({ ...attempt, phase: 'submitted', updatedAt: new Date().toISOString() })
      }
      if (details.certificateId && ['issued', 'willExpire'].includes(details.certificateStatus)) {
        const current = details
        this.store.setCertificates(this.store.getCertificates().map(item => item.instanceId === instanceId
          ? { ...item, domain: current.domain || item.domain, certificateId: current.certificateId, certificateStatus: current.certificateStatus, certificateExpiresAt: current.certificateExpiresAt, available: false }
          : item))
      }
      this.progress('succeeded', '验证信息已更新；可刷新证书列表查看签发状态')
    }, 'inspect')
    return { status, details }
  }

  async applyCertificate(instanceId: string, confirmedDomain: string): Promise<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }> {
    this.validateInstanceId(instanceId)
    const domain = this.store.getSettings().domain
    if (!domain) throw new ServiceError('CERT_DOMAIN_MISSING', '请先保存监控域名')
    if (typeof confirmedDomain !== 'string' || confirmedDomain !== domain) throw new ServiceError('CERT_DOMAIN_CHANGED', '监控域名已变化，请重新确认后再提交申请')
    if (!this.store.credentialsConfigured()) throw new ServiceError('CERT_CREDENTIALS_MISSING', '请先配置阿里云 AccessKey')
    this.ensureNoPendingDeployment()
    const previous = this.store.getApplicationAttempts().find(item => item.instanceId === instanceId)
    if (previous && !['configured', 'cleared'].includes(previous.phase)) throw new ServiceError('CERT_APPLICATION_UNCERTAIN', '该实例已提交或结果待核对，请查看验证状态，禁止重复申请')
    if (previous?.phase === 'configured' && previous.domain !== domain) throw new ServiceError('CERT_INSTANCE_DOMAIN_MISMATCH', '该实例已配置其他域名，不能覆盖')
    const status = await this.withTask(async () => {
      this.store.setAutomation({ paused: undefined, lastError: undefined })
      this.progress('checking', `正在核对实例 ${instanceId}`)
      const aliyun = this.aliyun()
      const current = await aliyun.getApplicationDetails(instanceId)
      this.checkRunning()
      if (current.hasValidation || current.status === 'pending' || ['issued', 'willExpire'].includes(current.certificateStatus)) {
        this.store.setApplicationAttempt({ instanceId, domain, phase: 'submitted', updatedAt: new Date().toISOString() })
        throw new ServiceError('CERT_INSTANCE_ALREADY_SUBMITTED', '该实例已提交或已有验证信息，请查看状态，不会重复申请')
      }
      if (!current.available || (current.domain && current.domain.toLowerCase() !== domain)) throw new ServiceError('CERT_INSTANCE_UNAVAILABLE', '该实例不可申请或绑定其他域名，请刷新核对')
      const save = (phase: 'configuring' | 'configured' | 'submitting' | 'submitted' | 'uncertain') => this.store.setApplicationAttempt({ instanceId, domain, phase, updatedAt: new Date().toISOString() })
      save('configuring')
      try { await aliyun.configureApplication(instanceId, domain, this.execution?.signal) }
      catch (err) { save('uncertain'); throw err }
      save('configured')
      this.checkRunning()
      save('submitting')
      try { await aliyun.submitApplication(instanceId, this.execution?.signal) }
      catch (err) { save('uncertain'); throw err }
      save('submitted')
      this.checkRunning()
      this.progress('succeeded', '申请已提交；请查看 DNS 验证信息，之后刷新签发状态')
    }, 'apply')
    return { status }
  }

  async clearApplicationUncertainty(instanceId: string): Promise<CertificateMonitorStatus> {
    this.validateInstanceId(instanceId)
    this.ensureNoPendingDeployment()
    const attempt = this.store.getApplicationAttempts().find(item => item.instanceId === instanceId)
    if (!attempt || !['uncertain', 'configuring', 'submitting'].includes(attempt.phase)) throw new ServiceError('CERT_APPLICATION_NOT_UNCERTAIN', '该实例没有可解除的待核对记录')
    return this.withTask(async () => {
      this.progress('checking', '正在重新核对实例申请状态')
      const details = await this.aliyun().getApplicationDetails(instanceId)
      this.checkRunning()
      if (!details.available || details.hasValidation || details.status !== 'inactive' || (details.domain && attempt.domain && details.domain.toLowerCase() !== attempt.domain)) throw new ServiceError('CERT_APPLICATION_ALREADY_ACTIVE', '实例已有申请或验证信息，不能解除保护，请继续查看状态')
      this.store.setApplicationAttempt({ ...attempt, phase: 'cleared', updatedAt: new Date().toISOString() })
      this.progress('succeeded', '已解除本地待核对标记；重新申请前仍需再次确认')
    }, 'inspect')
  }


  async listDeploymentResources(): Promise<{ status: CertificateMonitorStatus; resources?: CertificateCloudResource[] }> {
    let resources: CertificateCloudResource[] | undefined
    const status = await this.withTask(async () => {
      this.readProgress('checking', '正在读取云虚拟主机资源')
      resources = await this.aliyun().listWebHostingResources()
      this.checkRunning()
      this.readProgress('succeeded', `云资源列表已更新 · ${resources.length} 个`)
    }, 'resources')
    return { status, resources }
  }

  private ensureNoActiveTask(input: CertificateExecuteInput): void {
    this.ensureIdle()
    const task = this.store.getAutomation()
    if (!(task.instanceId || task.orderId || task.applicationPending || task.deploymentJobId || task.deploymentPending)) return
    const same = task.mode === 'deploy-existing' && task.instanceId === input.instanceId && task.certificateId === String(input.certificateId) &&
      JSON.stringify([...(task.deploymentResourceIds ?? [])].sort((a, b) => a - b)) === JSON.stringify([...input.resourceIds].sort((a, b) => a - b))
    if (!same) throw new ServiceError('CERT_ACTIVE_TASK', '已有未完成的证书任务，请使用顶部流程按钮接续，不能覆盖或更换目标')
  }

  async executeSelected(input: CertificateExecuteInput): Promise<CertificateMonitorStatus> {
    if (!input || typeof input.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.instanceId)) throw new ServiceError('PARAM_INVALID', '证书实例参数非法')
    const resourceIds = validateDeploymentResourceIds(input.resourceIds, true)
    if (!Number.isSafeInteger(input.certificateId) || input.certificateId <= 0) throw new ServiceError('PARAM_INVALID', '请选择已签发证书，证书 ID 必须是正整数')
    if (input.resourceDomains !== undefined && (!Array.isArray(input.resourceDomains) || input.resourceDomains.length !== resourceIds.length || input.resourceDomains.some(item => typeof item !== 'string' || !item || item.length > 253))) throw new ServiceError('PARAM_INVALID', '所选资源域名参数非法')
    const request = { ...input, resourceIds }
    this.ensureNoActiveTask(request)
    const domain = this.store.getSettings().domain
    if (!domain) throw new ServiceError('CERT_DOMAIN_MISSING', '请先保存监控域名')
    if (!this.store.credentialsConfigured()) throw new ServiceError('CERT_CREDENTIALS_MISSING', '请先配置阿里云 AccessKey')
    return this.withTask(async () => {
      this.store.setAutomation({ paused: undefined })
      await this.deployExisting(input.instanceId, resourceIds, domain, input)
    }, 'deploy')
  }

  private async selectedResources(aliyun: AliyunCertificateApi, ids: number[], domains: string[]): Promise<CertificateCloudResource[]> {
    this.checkRunning()
    const resources = await aliyun.listWebHostingResources()
    this.checkRunning()
    return ids.map((id) => {
      const resource = resources.find((item) => item.id === id)
      if (!resource || !certificateCoversDomain(domains, resource.domain)) throw new ServiceError('CERT_RESOURCE_DOMAIN_MISMATCH', `资源 ${id} 不存在或证书不覆盖其域名，请刷新并重新选择`)
      return resource
    })
  }

  private completeTask(message: string): void {
    this.checkRunning()
    this.store.setAutomation({ mode: undefined, orderId: undefined, instanceId: undefined, certificateId: undefined,
      deploymentJobId: undefined, deploymentStarted: undefined, deploymentPending: undefined, applicationPending: undefined,
      deploymentResourceIds: undefined, deploymentDomains: undefined, expectedSerial: undefined, expectedValidTo: undefined,
      sourceSerial: undefined, sourceFingerprint: undefined, sourceValidTo: undefined, expectedFingerprint: undefined, paused: undefined, lastError: undefined })
    this.progress('succeeded', message)
  }

  private async deployExisting(instanceId: string, ids: number[], domain: string, confirmed?: CertificateExecuteInput): Promise<void> {
    this.progress('checking', `正在核对实例 ${instanceId} 的已签发证书及部署目标`)
    const aliyun = this.aliyun()
    const cert = await aliyun.getIssuedCertificate(instanceId, domain)
    this.checkRunning()
    if (confirmed?.certificateId !== undefined && String(confirmed.certificateId) !== cert.certificateId) throw new ServiceError('CERT_SELECTED_CHANGED', '所选证书已发生变化，请刷新列表后重新确认，未部署其他证书')
    const targets = await this.selectedResources(aliyun, ids, cert.domains)
    if (confirmed?.resourceDomains && JSON.stringify(confirmed.resourceDomains) !== JSON.stringify(targets.map(item => item.domain))) throw new ServiceError('CERT_TARGET_CHANGED', '所选资源域名已发生变化，请刷新列表后重新确认')
    const task = this.store.getAutomation()
    if (task.certificateId && task.certificateId !== cert.certificateId) throw new ServiceError('CERT_SELECTED_CHANGED', '实例证书已变化，不能继续原部署任务，请在控制台核对')
    if (task.deploymentDomains && JSON.stringify(task.deploymentDomains) !== JSON.stringify(targets.map((item) => item.domain))) throw new ServiceError('CERT_TARGET_CHANGED', '部署资源绑定域名已变化，停止执行，请在控制台核对')
    const matches = (current: Awaited<ReturnType<typeof checkWebsiteCertificate>>) => certificateSerial(current.serialNumber) === certificateSerial(cert.serialNumber) && Math.abs(Date.parse(current.validTo) - Date.parse(cert.validTo)) < 1000
    let allLive = true
    for (const target of targets) {
      if (target.certificateEndTime && Date.parse(target.certificateEndTime) > Date.parse(cert.validTo)) throw new ServiceError('CERT_DEPLOY_DOWNGRADE', `${target.domain} 的云资源证书有效期更长，已阻止降级部署`)
      let current: Awaited<ReturnType<typeof checkWebsiteCertificate>>
      try {
        current = await this.checkWebsite(target.domain)
      } catch (err) {
        this.checkRunning()
        if (target.certificateId) throw err
        allLive = false
        this.log('warn', `${target.domain} 尚无可读取的线上证书，按未配置证书资源继续部署，完成后仍须线上核验`)
        continue
      }
      if (target.domain === domain) this.store.setCertificate(current)
      if (matches(current)) continue
      allLive = false
      if (Date.parse(current.validTo) > Date.parse(cert.validTo)) throw new ServiceError('CERT_DEPLOY_DOWNGRADE', `${target.domain} 的线上证书有效期更长，已阻止降级部署`)
    }
    if (allLive) {
      this.completeTask('所选证书已在全部目标域名生效，无需重复创建部署任务')
      return
    }
    if (task.deploymentPending && !task.deploymentJobId) throw new ServiceError('CERT_DEPLOY_UNCERTAIN', '上次创建部署任务的结果未确认，请先到控制台核对，禁止重复创建')
    await aliyun.getContactId()
    this.checkRunning()
    this.store.setAutomation({ mode: 'deploy-existing', domain, instanceId, certificateId: cert.certificateId,
      deploymentResourceIds: ids, deploymentDomains: targets.map((item) => item.domain), expectedSerial: cert.serialNumber,
      expectedValidTo: cert.validTo, lastError: undefined })
    if (task.deploymentJobId) {
      if (!task.deploymentStarted) {
        await aliyun.startDeployment(task.deploymentJobId, this.execution?.signal)
        this.store.setAutomation({ deploymentStarted: true })
        this.checkRunning()
      }
      await this.waitForDeployment(aliyun, task.deploymentJobId)
    } else {
      await this.deployCertificate(aliyun, cert.certificateId, domain, targets)
    }
    for (const target of targets) {
      let verified = false
      for (let attempt = 1; attempt <= LIVE_VERIFY_ATTEMPTS; attempt++) {
        try {
          const live = await this.checkWebsite(target.domain)
          if (target.domain === domain) this.store.setCertificate(live)
          if (matches(live)) { verified = true; break }
        } catch {
          this.checkRunning()
          this.log('warn', `${target.domain} 第 ${attempt} 次 TLS 检查未成功，等待部署生效`)
        }
        if (attempt < LIVE_VERIFY_ATTEMPTS) await this.wait(LIVE_VERIFY_INTERVAL_MS)
      }
      if (!verified) throw new ServiceError('CERT_LIVE_VERIFY_FAILED', `${target.domain} 尚未呈现所选证书，保留部署任务以便接续核验`)
      this.log('success', `${target.domain} 已验证为所选证书 ${cert.certificateId}`)
    }
    this.completeTask(`已将证书 ${cert.certificateId} 部署到 ${targets.length} 个云虚拟主机资源并验证生效`)
  }

  async resumeDeployment(): Promise<CertificateMonitorStatus> {
    const task = this.store.getAutomation()
    const domain = this.store.getSettings().domain
    if (task.mode !== 'deploy-existing' || !task.instanceId || !task.deploymentResourceIds?.length || task.domain !== domain) {
      throw new ServiceError('CERT_NO_DEPLOYMENT', '没有可接续的部署任务；旧申请任务请先结束，再选择已签发证书')
    }
    return this.withTask(async () => {
      this.store.setAutomation({ paused: undefined })
      await this.deployExisting(task.instanceId!, task.deploymentResourceIds!, domain)
    }, 'deploy')
  }

  private async deployCertificate(
    aliyun: AliyunCertificateApi,
    certificateId: string,
    domain: string,
    targets: CertificateCloudResource[]
  ): Promise<number> {
    this.progress('deploying', '正在查找阿里云云虚拟主机资源')
    const resources = targets
    this.checkRunning()
    const contactId = await aliyun.getContactId()
    this.checkRunning()
    this.progress('deploying', '正在创建并启动证书部署任务')
    this.store.setAutomation({ deploymentPending: true })
    const jobId = await aliyun.createDeployment(certificateId, resources.map((item) => item.id), contactId, domain)
    this.store.setAutomation({ deploymentJobId: jobId, deploymentPending: false, deploymentStarted: false })
    this.checkRunning()
    await aliyun.startDeployment(jobId, this.execution?.signal)
    this.store.setAutomation({ deploymentStarted: true })
    this.checkRunning()
    return this.waitForDeployment(aliyun, jobId)
  }

  private async waitForDeployment(aliyun: AliyunCertificateApi, jobId: number): Promise<number> {
    this.progress('deploying', `正在等待证书部署任务 ${jobId}`)
    const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const status = await aliyun.getDeploymentStatus(jobId)
      this.checkRunning()
      if (status.finished) {
        if (!status.success) {
          throw new ServiceError('CERT_DEPLOY_FAILED', '证书部署任务执行失败', status.errors.join('；'))
        }
        this.progress('verifying', '阿里云部署任务已完成，正在验证线上证书')
        return jobId
      }
      this.progress('deploying', `证书部署中 · 成功 ${status.successCount}/${status.workerCount}`)
      await this.wait(DEPLOYMENT_POLL_MS)
    }
    throw new ServiceError('CERT_DEPLOY_TIMEOUT', '等待证书部署任务完成超时')
  }
}
