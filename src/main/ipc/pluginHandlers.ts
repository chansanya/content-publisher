import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, PluginCreateResult, PluginDeleteResult, PluginListResult, PluginPushResult, PluginSummary } from '@shared/types'
import type { PluginService } from '../services/pluginService'
import { ServiceError, toAppError } from '../services/errors'

function requirePluginName(payload: unknown): string {
  const name = (payload as Record<string, unknown>)?.name
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ServiceError('PARAM_INVALID', '插件名称必须是非空字符串')
  }
  return name
}

export function registerPluginHandlers(service: PluginService): void {
  ipcMain.handle(IPC_CHANNELS.PluginList, async (): Promise<ApiResult<PluginListResult>> => {
    try {
      return { ok: true, data: await service.list() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PluginCreate, async (_event, payload: unknown): Promise<ApiResult<PluginCreateResult>> => {
    try {
      const name = (payload as Record<string, unknown>)?.name
      if (typeof name !== 'string' || name.trim() === '') {
        throw new ServiceError('PARAM_INVALID', '插件名称必须是非空字符串')
      }
      return { ok: true, data: await service.create(name) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PluginSaveMapping, async (_event, payload: unknown): Promise<ApiResult<PluginSummary>> => {
    try {
      const raw = (payload ?? {}) as Record<string, unknown>
      if (typeof raw.name !== 'string' || typeof raw.remotePath !== 'string') {
        throw new ServiceError('PARAM_INVALID', '插件名称或远程路径非法')
      }
      return { ok: true, data: await service.saveMapping(raw.name, raw.remotePath) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PluginPush, async (_event, payload: unknown): Promise<ApiResult<PluginPushResult>> => {
    try {
      return { ok: true, data: await service.push(requirePluginName(payload)) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PluginDelete, async (_event, payload: unknown): Promise<ApiResult<PluginDeleteResult>> => {
    try {
      return { ok: true, data: await service.deleteRemote(requirePluginName(payload)) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PluginOpenRoot, async (): Promise<ApiResult<true>> => {
    try {
      const error = await shell.openPath(service.getRootDir())
      if (error) throw new ServiceError('PLUGIN_OPEN_ROOT_FAILED', '无法打开插件目录', error)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
