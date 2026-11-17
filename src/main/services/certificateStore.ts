import Store from 'electron-store'
import { safeStorage } from 'electron'
import type {
  CertificateAutomationRecord,
  CertificateCredentialInput,
  CertificateMonitorSettings,
  CertificateInstanceSummary,
  CertificateApplicationAttempt,
  CertificateSnapshot
} from '@shared/types'
import { ServiceError } from './errors'
import { mergeApplicationAttempts, normalizeCertificateDomain, validateDeploymentResourceIds } from './certificatePolicy'

interface CertificateStoreData {
  settings: CertificateMonitorSettings
  accessKeyId: string
  accessKeySecret: string
  certificate?: CertificateSnapshot
  certificates?: CertificateInstanceSummary[]
  applicationAttempts?: Record<string, CertificateApplicationAttempt>
  quota?: { instances?: CertificateInstanceSummary[] }
  automation: CertificateAutomationRecord
  taskHistory?: { endedAt: string; automation: CertificateAutomationRecord }[]
}

const DEFAULT_SETTINGS: CertificateMonitorSettings = {
  enabled: true,
  domain: '',
  checkHour: 7,
  warningDays: 7
}

const DEFAULT_AUTOMATION: CertificateAutomationRecord = {
  state: 'idle'
}

export class CertificateStore {
  private readonly store: Store<CertificateStoreData>

  constructor(dataDir: string) {
    this.store = new Store<CertificateStoreData>({
      name: 'certificate-monitor',
      cwd: dataDir,
      defaults: {
        settings: DEFAULT_SETTINGS,
        accessKeyId: '',
        accessKeySecret: '',
        automation: DEFAULT_AUTOMATION
      }
    })
    const previous = this.store.get('automation')
    const retired = previous.mode === 'renewal' || previous.orderId || previous.applicationPending || ['applying', 'validating', 'issuing', 'ready'].includes(previous.state)
    if (retired) {
      if (previous.deploymentJobId && previous.instanceId && previous.certificateId && previous.deploymentResourceIds?.length) {
        this.store.set('automation', { ...previous, mode: 'deploy-existing', state: 'stopped', paused: true })
      } else this.endAutomation()
    }
  }

  getSettings(): CertificateMonitorSettings {
    const saved = this.store.get('settings') as CertificateMonitorSettings & { renewBeforeDays?: number }
    return { enabled: saved.enabled ?? true, domain: saved.domain || '', checkHour: saved.checkHour ?? 7, warningDays: saved.warningDays ?? saved.renewBeforeDays ?? 7, deploymentResourceIds: saved.deploymentResourceIds ?? [] }
  }

  saveSettings(settings: CertificateMonitorSettings): CertificateMonitorSettings {
    const domain = normalizeCertificateDomain(settings.domain)
    if (!Number.isInteger(settings.checkHour) || settings.checkHour < 0 || settings.checkHour > 23) {
      throw new ServiceError('CERT_CHECK_HOUR_INVALID', '每日检查时间必须是 0-23 的整数小时')
    }
    if (!Number.isInteger(settings.warningDays) || settings.warningDays < 1 || settings.warningDays > 60) {
      throw new ServiceError('CERT_WARNING_DAYS_INVALID', '到期预警阈值必须是 1-60 天')
    }
    const previous = this.getSettings()
    if (previous.domain && previous.domain !== domain && (this.getAutomation().orderId || this.getAutomation().instanceId || this.getAutomation().applicationPending)) {
      throw new ServiceError('CERT_DOMAIN_LOCKED', '尚有证书申请或部署记录，请先完成该任务再更换域名')
    }
    const normalized = {
      enabled: settings.enabled, domain, checkHour: settings.checkHour,
      warningDays: settings.warningDays,
      deploymentResourceIds: validateDeploymentResourceIds(settings.deploymentResourceIds)
    }
    this.store.set('settings', normalized)
    if (previous.domain !== domain) {
      this.store.delete('certificate')
      this.store.set('automation', DEFAULT_AUTOMATION)
    }
    return normalized
  }

  credentialsConfigured(): boolean {
    return Boolean(this.store.get('accessKeyId') && this.store.get('accessKeySecret'))
  }

  accessKeyIdMasked(): string {
    const value = this.store.get('accessKeyId')
    if (!value) return ''
    if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`
    return `${value.slice(0, 4)}****${value.slice(-4)}`
  }

  saveCredentials(input: CertificateCredentialInput): void {
    const accessKeyId = input.accessKeyId.trim()
    const accessKeySecret = input.accessKeySecret.trim()
    if (!accessKeyId || !accessKeySecret) {
      throw new ServiceError('CERT_CREDENTIALS_INVALID', 'AccessKey ID 和 AccessKey Secret 不能为空')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ServiceError('CERT_ENCRYPTION_UNAVAILABLE', '当前系统无法安全加密 AccessKey Secret')
    }
    this.store.set({ accessKeyId, accessKeySecret: safeStorage.encryptString(accessKeySecret).toString('base64') })
  }

  getCredentials(): CertificateCredentialInput {
    const accessKeyId = this.store.get('accessKeyId')
    const encrypted = this.store.get('accessKeySecret')
    if (!accessKeyId || !encrypted) {
      throw new ServiceError('CERT_CREDENTIALS_MISSING', '尚未配置阿里云 AccessKey')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ServiceError('CERT_ENCRYPTION_UNAVAILABLE', '当前系统无法解密 AccessKey Secret')
    }
    try {
      return {
        accessKeyId,
        accessKeySecret: safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      }
    } catch {
      throw new ServiceError('CERT_CREDENTIALS_DECRYPT_FAILED', 'AccessKey Secret 解密失败，请重新配置')
    }
  }

  clearCredentials(): void {
    this.store.set('accessKeyId', '')
    this.store.set('accessKeySecret', '')
  }

  getCertificate(): CertificateSnapshot | undefined {
    return this.store.get('certificate')
  }

  setCertificate(certificate: CertificateSnapshot): void {
    this.store.set('certificate', certificate)
  }

  getCertificates(): CertificateInstanceSummary[] {
    const saved = this.store.get('certificates') ?? this.store.get('quota')?.instances ?? []
    return saved
  }

  setCertificates(certificates: CertificateInstanceSummary[]): void {
    this.store.set('certificates', certificates)
  }

  getApplicationAttempts(): CertificateApplicationAttempt[] {
    return mergeApplicationAttempts(this.store.get('applicationAttempts', {}), this.store.get('taskHistory', []))
  }

  setApplicationAttempt(attempt: CertificateApplicationAttempt): void {
    this.store.set('applicationAttempts', { ...this.store.get('applicationAttempts', {}), [attempt.instanceId]: attempt })
  }

  getAutomation(): CertificateAutomationRecord {
    const saved = { ...DEFAULT_AUTOMATION, ...this.store.get('automation') }
    if (saved.mode === 'renewal' || !['idle', 'checking', 'deploying', 'verifying', 'succeeded', 'failed', 'stopped'].includes(saved.state)) return { ...saved, state: 'stopped', paused: true }
    return saved
  }

  endAutomation(): void {
    const previous = { ...DEFAULT_AUTOMATION, ...this.store.get('automation') }
    const active = previous.instanceId || previous.orderId || previous.certificateId || previous.applicationPending || previous.deploymentJobId || previous.deploymentPending
    if (!active && previous.state === 'stopped') return
    const history = this.store.get('taskHistory', [])
    const automation: CertificateAutomationRecord = {
      state: 'stopped', paused: true, domain: this.getSettings().domain,
      lastCheckAt: previous.lastCheckAt, nextCheckAt: previous.nextCheckAt, updatedAt: new Date().toISOString()
    }
    this.store.set({ automation, taskHistory: [...history, { endedAt: new Date().toISOString(), automation: previous }] })
  }

  setAutomation(patch: Partial<CertificateAutomationRecord>): CertificateAutomationRecord {
    const next = { ...this.getAutomation(), ...patch, updatedAt: new Date().toISOString() }
    for (const key of Object.keys(next) as (keyof CertificateAutomationRecord)[]) {
      if (next[key] === undefined) delete next[key]
    }
    this.store.set('automation', next)
    return next
  }
}
