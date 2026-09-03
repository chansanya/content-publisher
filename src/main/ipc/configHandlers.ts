import { app, clipboard, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, FtpConfigView } from '@shared/types'
import { resolveBaseDir } from '../appPaths'
import { loadEnvConfig, toConfigView } from '../services/envService'
import { toAppError } from '../services/errors'
import { logsDirPath } from '../services/logFileService'

export function registerConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ConfigGet, (): ApiResult<FtpConfigView> => {
    try {
      const result = loadEnvConfig(resolveBaseDir())
      return result.ok ? { ok: true, data: toConfigView(result.data) } : { ok: false, error: result.error }
    } catch (err) {
      // 任何异常都必须收敛为 ApiResult，绝不让 invoke 直接 reject
      return { ok: false, error: toAppError(err) }
    }
  })

  // 复制密码：明文只在主进程内写入剪贴板，渲染进程拿不到密码本身
  ipcMain.handle(IPC_CHANNELS.ConfigCopyPassword, (): ApiResult<null> => {
    try {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      clipboard.writeText(result.data.password)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  // 复制非敏感字段（主机 / 用户名 / 路径等）：渲染进程传入的文本写入剪贴板
  ipcMain.handle(IPC_CHANNELS.ConfigCopyText, (_event, text: unknown): ApiResult<null> => {
    try {
      if (typeof text !== 'string' || text.length === 0) {
        return { ok: false, error: { code: 'PARAM_INVALID', message: '参数非法: 待复制文本必须是非空字符串' } }
      }
      clipboard.writeText(text)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  // 打开发布记录目录：路径来自主进程读取的 .env，不信任渲染进程传入的路径
  ipcMain.handle(IPC_CHANNELS.ConfigOpenRecordDir, async (): Promise<ApiResult<true>> => {
    try {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      const errMsg = await shell.openPath(result.data.recordDir)
      if (errMsg) return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: errMsg } }
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  // 打开本地日志目录（logs/，按天滚动保留 14 天）
  ipcMain.handle(IPC_CHANNELS.ConfigOpenLogDir, async (): Promise<ApiResult<true>> => {
    try {
      const errMsg = await shell.openPath(logsDirPath(resolveBaseDir()))
      if (errMsg) return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: errMsg } }
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  // 在资源管理器中定位 .env 配置文件
  ipcMain.handle(IPC_CHANNELS.ConfigOpenEnvFile, (): ApiResult<true> => {
    try {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      shell.showItemInFolder(result.data.envPath)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  // 应用版本号：来自主进程 package.json（app.getVersion），渲染进程不硬编码
  ipcMain.handle(IPC_CHANNELS.AppGetVersion, (): ApiResult<string> => {
    return { ok: true, data: app.getVersion() }
  })

  ipcMain.handle(IPC_CHANNELS.AppRestart, (): ApiResult<true> => {
    try {
      app.relaunch()
      app.exit(0)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
