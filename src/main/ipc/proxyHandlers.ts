import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, ApplyArtifactResult, ProxyReplacementResult, ProxyStatus } from '@shared/types'
import type { ProxyService } from '../services/proxyService'
import { ServiceError, toAppError } from '../services/errors'
import { resolveBaseDir } from '../appPaths'
import { applyReplacementsToDirectory, loadReplacements } from '../services/replacementService'

function requireArtifactId(payload: unknown): string {
  const artifactId = (payload as Record<string, unknown>)?.artifactId
  if (typeof artifactId !== 'string' || artifactId.trim() === '') {
    throw new ServiceError('PARAM_INVALID', '参数非法: artifactId 必须是非空字符串')
  }
  return artifactId
}

export function registerProxyHandlers(service: ProxyService): void {
  ipcMain.handle(IPC_CHANNELS.ProxyGetStatus, (): ApiResult<ProxyStatus> => {
    try {
      return { ok: true, data: service.getStatus() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ProxySaveSettings, (_event, payload: unknown): ApiResult<ProxyStatus> => {
    try {
      const raw = (payload ?? {}) as Record<string, unknown>
      if (typeof raw.port !== 'number' || typeof raw.spaFallback !== 'boolean') {
        throw new ServiceError('PARAM_INVALID', '代理端口或 SPA 设置非法')
      }
      return { ok: true, data: service.saveSettings({ port: raw.port, spaFallback: raw.spaFallback }) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ProxyStart, async (): Promise<ApiResult<ProxyStatus>> => {
    try {
      return { ok: true, data: await service.start() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ProxyStop, async (): Promise<ApiResult<ProxyStatus>> => {
    try {
      return { ok: true, data: await service.stop() }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.ProxyApplyArtifact,
    async (_event, payload: unknown): Promise<ApiResult<ApplyArtifactResult>> => {
      try {
        return { ok: true, data: await service.applyArtifact(requireArtifactId(payload)) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  // 对本地代理目录内容原地应用替换规则（本地验证所见即发布所得）
  ipcMain.handle(IPC_CHANNELS.ProxyApplyReplacements, async (): Promise<ApiResult<ProxyReplacementResult>> => {
    try {
      const config = await loadReplacements(resolveBaseDir())
      if (!config) throw new ServiceError('REPLACEMENTS_NOT_CONFIGURED', '尚未配置替换规则，请先在替换规则页新增')
      const stats = await applyReplacementsToDirectory(service.rootDir, config)
      return { ok: true, data: { files: stats.files, count: stats.count } }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ProxyOpenSite, async (): Promise<ApiResult<true>> => {
    try {
      if (!service.getStatus().running) throw new ServiceError('PROXY_NOT_RUNNING', '请先启动本地代理')
      await shell.openExternal(service.getPrimaryUrl())
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.ProxyOpenRoot, async (): Promise<ApiResult<true>> => {
    try {
      const error = await shell.openPath(service.getRootDir())
      if (error) throw new ServiceError('PROXY_OPEN_ROOT_FAILED', '无法打开代理目录', error)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
