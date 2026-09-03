import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, DeleteRecordResult, PrepareSummary, PublishRecord, SourceType } from '@shared/types'
import type { PublishService } from '../services/publishService'
import { ServiceError, toAppError } from '../services/errors'

const SOURCE_TYPES: readonly SourceType[] = ['zip', 'directory', 'proxy']

/** 渲染进程传入的一切参数均不可信任，逐项校验 */
function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ServiceError('PARAM_INVALID', `参数非法: ${name} 必须是非空字符串`)
  }
  return value
}

export function registerPublishHandlers(service: PublishService): void {
  ipcMain.handle(
    IPC_CHANNELS.PublishPrepare,
    async (_event, input: unknown): Promise<ApiResult<PrepareSummary>> => {
      try {
        const raw = (input ?? {}) as Record<string, unknown>
        const type = raw.type
        if (typeof type !== 'string' || !SOURCE_TYPES.includes(type as SourceType)) {
          throw new ServiceError('PARAM_INVALID', '发布仅支持 ZIP 文件或文件夹')
        }
        return { ok: true, data: await service.prepare({ type: type as SourceType }) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PublishExecute,
    async (_event, payload: unknown): Promise<ApiResult<PublishRecord>> => {
      try {
        const releaseId = requireString((payload as Record<string, unknown>)?.releaseId, 'releaseId')
        return { ok: true, data: await service.execute(releaseId) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PublishPrepareRepublish,
    (_event, payload: unknown): ApiResult<PrepareSummary> => {
      try {
        const recordId = requireString((payload as Record<string, unknown>)?.recordId, 'recordId')
        return { ok: true, data: service.prepareRepublish(recordId) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PublishRollback,
    async (_event, payload: unknown): Promise<ApiResult<PublishRecord>> => {
      try {
        const artifactId = requireString((payload as Record<string, unknown>)?.artifactId, 'artifactId')
        return { ok: true, data: await service.rollback(artifactId) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PublishRepublish,
    async (_event, payload: unknown): Promise<ApiResult<PublishRecord>> => {
      try {
        const recordId = requireString((payload as Record<string, unknown>)?.recordId, 'recordId')
        return { ok: true, data: await service.republish(recordId) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.PublishGetRecords, (): ApiResult<PublishRecord[]> => {
    try {
      return { ok: true, data: service.getRecords() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.PublishGetRecord,
    (_event, payload: unknown): ApiResult<PublishRecord> => {
      try {
        const id = requireString((payload as Record<string, unknown>)?.id, 'id')
        return { ok: true, data: service.getRecord(id) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PublishDeleteRecord,
    (_event, payload: unknown): ApiResult<DeleteRecordResult> => {
      try {
        const id = requireString((payload as Record<string, unknown>)?.id, 'id')
        return { ok: true, data: service.deleteRecord(id) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )
}
