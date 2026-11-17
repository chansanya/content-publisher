import { powerMonitor } from 'electron'
import type { OperationLogEvent } from '@shared/types'
import { CertificateService } from './certificateService'
import { nextCertificateCheck } from './certificatePolicy'

const RESUME_MIN_INTERVAL_MS = 6 * 60 * 60_000

export class CertificateScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly resumeHandler = (): void => {
    const status = this.service.getStatus()
    if (!status.settings.enabled) return
    const last = status.automation.lastCheckAt ? Date.parse(status.automation.lastCheckAt) : 0
    if (!last || Date.now() - last >= RESUME_MIN_INTERVAL_MS) void this.run('电脑唤醒后补检')
  }

  constructor(
    private readonly service: CertificateService,
    private readonly sendLog: (event: OperationLogEvent) => void
  ) {}

  start(): void {
    powerMonitor.on('resume', this.resumeHandler)
    void this.run('应用启动检查')
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    powerMonitor.removeListener('resume', this.resumeHandler)
  }

  reschedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.scheduleNext()
  }

  private nextCheckDate(): Date {
    return nextCertificateCheck(this.service.getStatus().settings.checkHour)
  }

  private scheduleNext(): void {
    const settings = this.service.getStatus().settings
    if (!settings.enabled) {
      this.service.setNextCheckAt('')
      return
    }
    const next = this.nextCheckDate()
    this.service.setNextCheckAt(next.toISOString())
    this.timer = setTimeout(() => {
      void this.run('每日定时检查').finally(() => this.scheduleNext())
    }, Math.max(1_000, next.getTime() - Date.now()))
  }

  private async run(reason: string): Promise<void> {
    const settings = this.service.getStatus().settings
    if (!settings.enabled || !settings.domain) return
    this.sendLog({ level: 'info', scope: 'certificate', message: `${reason} · ${settings.domain}` })
    try {
      await this.service.checkNow()
    } catch {
      // 具体错误已由 CertificateService 记录；调度器不能因单次失败停止下一次任务
    }
  }
}
