import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type {
  ApiResult,
  CertificateCredentialInput,
  CertificateMonitorSettings,
  CertificateMonitorStatus,
  CertificateCloudResource,
  CertificateExecuteInput,
  CertificateApplicationDetail
} from '@shared/types'
import { CertificateScheduler } from '../services/certificateScheduler'
import { CertificateService } from '../services/certificateService'
import { ServiceError, toAppError } from '../services/errors'

const CERTIFICATE_CONSOLE_URL = 'https://yundun.console.aliyun.com/?p=cas#/'

function settingsFrom(payload: unknown): CertificateMonitorSettings {
  const raw = (payload ?? {}) as Partial<CertificateMonitorSettings>
  if (
    typeof raw.enabled !== 'boolean' ||
    typeof raw.domain !== 'string' ||
    typeof raw.checkHour !== 'number' ||
    typeof raw.warningDays !== 'number'
  ) {
    throw new ServiceError('PARAM_INVALID', '证书监控设置参数非法')
  }
  return raw as CertificateMonitorSettings
}

function credentialsFrom(payload: unknown): CertificateCredentialInput {
  const raw = (payload ?? {}) as Partial<CertificateCredentialInput>
  if (typeof raw.accessKeyId !== 'string' || typeof raw.accessKeySecret !== 'string') {
    throw new ServiceError('PARAM_INVALID', 'AccessKey 参数非法')
  }
  return raw as CertificateCredentialInput
}

export function registerCertificateHandlers(service: CertificateService, scheduler: CertificateScheduler): void {
  ipcMain.handle(IPC_CHANNELS.CertificateClearApplicationUncertainty, async (_event, instanceId: unknown): Promise<ApiResult<CertificateMonitorStatus>> => {
    try { if (typeof instanceId !== 'string') throw new ServiceError('PARAM_INVALID', '实例 ID 非法'); return { ok: true, data: await service.clearApplicationUncertainty(instanceId) } }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })
  ipcMain.handle(IPC_CHANNELS.CertificateApply, async (_event, payload: unknown): Promise<ApiResult<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }>> => {
    try {
      const input = payload as { instanceId?: unknown; domain?: unknown } | null
      if (!input || typeof input.instanceId !== 'string' || typeof input.domain !== 'string') throw new ServiceError('PARAM_INVALID', '申请参数非法')
      return { ok: true, data: await service.applyCertificate(input.instanceId, input.domain) }
    }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })
  ipcMain.handle(IPC_CHANNELS.CertificateInspectApplication, async (_event, instanceId: unknown): Promise<ApiResult<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }>> => {
    try { if (typeof instanceId !== 'string') throw new ServiceError('PARAM_INVALID', '实例 ID 非法'); return { ok: true, data: await service.inspectApplication(instanceId) } }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })
  ipcMain.handle(IPC_CHANNELS.CertificateEndTask, (): ApiResult<CertificateMonitorStatus> => {
    try { return { ok: true, data: service.endTask() } }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateStopTask, (): ApiResult<CertificateMonitorStatus> => {
    try { return { ok: true, data: service.requestStop() } }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateListResources, async (): Promise<ApiResult<{ status: CertificateMonitorStatus; resources?: CertificateCloudResource[] }>> => {
    try { return { ok: true, data: await service.listDeploymentResources() } }
    catch (err) { return { ok: false, error: toAppError(err) } }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateExecuteSelected, async (_event, payload: unknown): Promise<ApiResult<CertificateMonitorStatus>> => {
    try {
      if (!payload || typeof payload !== 'object') throw new ServiceError('PARAM_INVALID', '证书操作参数非法')
      const raw = payload as CertificateExecuteInput
      return { ok: true, data: await service.executeSelected({ instanceId: raw.instanceId, resourceIds: raw.resourceIds, certificateId: raw.certificateId, resourceDomains: raw.resourceDomains }) }
    } catch (err) { return { ok: false, error: toAppError(err) } }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateGetStatus, (): ApiResult<CertificateMonitorStatus> => {
    try {
      return { ok: true, data: service.getStatus() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.CertificateSaveSettings,
    (_event, payload: unknown): ApiResult<CertificateMonitorStatus> => {
      try {
        const status = service.saveSettings(settingsFrom(payload))
        scheduler.reschedule()
        return { ok: true, data: status }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CertificateSaveCredentials,
    (_event, payload: unknown): ApiResult<CertificateMonitorStatus> => {
      try {
        return { ok: true, data: service.saveCredentials(credentialsFrom(payload)) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.CertificateClearCredentials, (): ApiResult<CertificateMonitorStatus> => {
    try {
      return { ok: true, data: service.clearCredentials() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateCheckNow, async (): Promise<ApiResult<CertificateMonitorStatus>> => {
    try {
      return { ok: true, data: await service.checkNow() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateRefreshList, async (): Promise<ApiResult<CertificateMonitorStatus>> => {
    try {
      return { ok: true, data: await service.refreshCertificates() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CertificateResumeDeployment, async (): Promise<ApiResult<CertificateMonitorStatus>> => {
    try {
      return { ok: true, data: await service.resumeDeployment() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })


  ipcMain.handle(IPC_CHANNELS.CertificateOpenConsole, async (): Promise<ApiResult<true>> => {
    try {
      await shell.openExternal(CERTIFICATE_CONSOLE_URL)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
