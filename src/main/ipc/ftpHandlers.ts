import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type {
  ApiResult,
  ConnectionTestResult,
  OperationLogEvent,
  RemoteCleanIncomingResult,
  RemoteClearResult,
  RemoteDeleteResult,
  RemoteDirectoryListing,
  RemoteDownloadResult,
  RemoteUploadResult
} from '@shared/types'
import { resolveBaseDir, deployScriptPath } from '../appPaths'
import { loadEnvConfig } from '../services/envService'
import { toAppError } from '../services/errors'
import {
  connectClient,
  createFtpClient,
  deleteRemoteEntry,
  downloadRemoteFile,
  joinPosix,
  listRemoteDirectory,
  testConnection,
  uploadRemoteFiles
} from '../services/ftpService'
import type { FtpListEntry } from '../services/ftpService'
import {
  assertServerDeployConfig,
  CONTROL_DIR_NAME,
  serverDeployEnabled,
  triggerServerClear,
  triggerServerDelete,
  uploadDeployRuntime
} from '../services/serverDeployService'
import { ServiceError } from '../services/errors'

export interface FtpHandlerDeps {
  sendLog: (event: OperationLogEvent) => void
}

export function registerFtpHandlers(deps: FtpHandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.FtpTestConnection, async (): Promise<ApiResult<ConnectionTestResult>> => {
    const result = loadEnvConfig(resolveBaseDir())
    if (!result.ok) return { ok: false, error: result.error }

    const client = createFtpClient()
    try {
      const latencyMs = await testConnection(client, result.data)
      return { ok: true, data: { latencyMs } }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    } finally {
      client.close()
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.FtpListDir,
    async (_event, payload: unknown): Promise<ApiResult<RemoteDirectoryListing>> => {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      const relativePath = (payload as Record<string, unknown>)?.relativePath
      if (relativePath !== undefined && typeof relativePath !== 'string') {
        return { ok: false, error: new ServiceError('PARAM_INVALID', 'relativePath 必须是字符串').appError }
      }
      const client = createFtpClient()
      try {
        return { ok: true, data: await listRemoteDirectory(client, result.data, relativePath ?? '') }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      } finally {
        client.close()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.FtpDelete,
    async (_event, payload: unknown): Promise<ApiResult<RemoteDeleteResult>> => {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      const relativePath = (payload as Record<string, unknown>)?.relativePath
      if (typeof relativePath !== 'string' || relativePath.trim() === '') {
        return { ok: false, error: new ServiceError('PARAM_INVALID', 'relativePath 必须是非空字符串').appError }
      }
      const config = result.data
      const log = (level: OperationLogEvent['level'], message: string): void => {
        deps.sendLog({ level, scope: 'remote', message })
      }

      // 部署接口可用时优先服务端删除（PHP 本地递归删除远快于 FTP 逐层删），失败自动回退 FTP
      if (serverDeployEnabled(config)) {
        const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        let runtimeReady = false
        const serverClient = createFtpClient()
        try {
          await connectClient(serverClient, config)
          await uploadDeployRuntime(serverClient, config, deployScriptPath())
          runtimeReady = true
        } catch (err) {
          log('warn', `服务端部署脚本上传失败，回退 FTP 删除: ${toAppError(err).message}`)
        } finally {
          serverClient.close()
        }

        if (runtimeReady) {
          try {
            log('info', `正在通过服务端接口删除 ${normalized}`)
            const response = await triggerServerDelete(config, [normalized])
            const entry = response.entries[0]
            if (!entry?.existed) throw new ServiceError('FTP_ENTRY_NOT_FOUND', `远程文件不存在: ${relativePath}`)
            log('success', `服务端删除完成 · ${response.durationMs}ms`)
            return { ok: true, data: { path: entry.path || normalized, type: entry.type ?? 'file' } }
          } catch (err) {
            log('warn', `服务端接口删除失败，回退 FTP 删除: ${toAppError(err).message}`)
          }
        }
      }

      const client = createFtpClient()
      try {
        return { ok: true, data: await deleteRemoteEntry(client, config, relativePath) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      } finally {
        client.close()
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.FtpSyncDeployRuntime, async (): Promise<ApiResult<null>> => {
    const result = loadEnvConfig(resolveBaseDir())
    if (!result.ok) return { ok: false, error: result.error }
    const config = result.data
    const log = (level: OperationLogEvent['level'], message: string): void => {
      deps.sendLog({ level, scope: 'publish', message })
    }

    try {
      log('info', '[1/4] 校验部署配置')
      assertServerDeployConfig(config)
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }

    const client = createFtpClient()
    try {
      log('info', '[2/4] 连接 FTP')
      await connectClient(client, config)
      await uploadDeployRuntime(client, config, deployScriptPath(), (message) => log('info', message))
      log('success', '服务端部署脚本已更新 · deploy.php + config.php')
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    } finally {
      client.close()
    }
  })

  ipcMain.handle(IPC_CHANNELS.FtpClearRoot, async (): Promise<ApiResult<RemoteClearResult>> => {
    const result = loadEnvConfig(resolveBaseDir())
    if (!result.ok) return { ok: false, error: result.error }
    const config = result.data
    const log = (level: OperationLogEvent['level'], message: string): void => {
      deps.sendLog({ level, scope: 'remote', message })
    }

    // 部署接口可用时优先服务端清空；.ftppublisher 控制目录（deploy.php/config.php）始终保留
    if (serverDeployEnabled(config)) {
      let runtimeReady = false
      const serverClient = createFtpClient()
      try {
        await connectClient(serverClient, config)
        await uploadDeployRuntime(serverClient, config, deployScriptPath())
        runtimeReady = true
      } catch (err) {
        log('warn', `服务端部署脚本上传失败，回退 FTP 清空: ${toAppError(err).message}`)
      } finally {
        serverClient.close()
      }

      if (runtimeReady) {
        try {
          log('info', `正在通过服务端接口清空 ${config.remoteRoot}（保留 ${CONTROL_DIR_NAME}）`)
          const response = await triggerServerClear(config)
          log('success', `服务端清空完成 · 删除 ${response.removed} 个顶层条目 · ${response.durationMs}ms`)
          return { ok: true, data: { removed: response.removed } }
        } catch (err) {
          log('warn', `服务端接口清空失败，回退 FTP 清空: ${toAppError(err).message}`)
        }
      }
    }

    const client = createFtpClient()
    try {
      log('info', `正在通过 FTP 清空 ${config.remoteRoot}（保留 ${CONTROL_DIR_NAME}）`)
      await connectClient(client, config)
      await client.cd(config.remoteRoot)
      const entries = await client.list()
      let removed = 0
      let lastLoggedAt = 0
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index]
        if (entry.name === CONTROL_DIR_NAME) continue
        const target = joinPosix(config.remoteRoot, entry.name)
        const now = Date.now()
        if (index === 0 || entry.isDirectory || now - lastLoggedAt >= 1000) {
          log('info', `[${removed + 1}/${entries.length}] 正在删除${entry.isDirectory ? '目录' : '文件'} ${target}`)
          lastLoggedAt = now
        }
        if (entry.isDirectory) await client.removeDir(target)
        else await client.remove(target)
        removed += 1
      }
      log('success', `FTP 清空完成，共删除 ${removed} 个顶层条目`)
      return { ok: true, data: { removed } }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    } finally {
      client.close()
    }
  })

  /** 清理 .ftppublisher/incoming/ 下部署失败残留的 ZIP，保留目录本身；纯 FTP 操作，不依赖 deploy.php */
  ipcMain.handle(IPC_CHANNELS.FtpCleanIncoming, async (): Promise<ApiResult<RemoteCleanIncomingResult>> => {
    const result = loadEnvConfig(resolveBaseDir())
    if (!result.ok) return { ok: false, error: result.error }
    const config = result.data
    const log = (level: OperationLogEvent['level'], message: string): void => {
      deps.sendLog({ level, scope: 'publish', message })
    }

    const incomingPath = joinPosix(joinPosix(config.remoteRoot, CONTROL_DIR_NAME), 'incoming')
    const client = createFtpClient()
    try {
      await connectClient(client, config)
      let entries: FtpListEntry[]
      try {
        entries = await client.list(incomingPath)
      } catch {
        log('success', 'incoming 目录不存在或不可读，视为无残留')
        return { ok: true, data: { removed: 0 } }
      }
      log('info', `正在清理 ${incomingPath}，共 ${entries.length} 个条目`)
      let removed = 0
      for (const entry of entries) {
        const target = joinPosix(incomingPath, entry.name)
        if (entry.isDirectory) await client.removeDir(target)
        else await client.remove(target)
        removed += 1
      }
      log('success', `incoming 清理完成 · 删除 ${removed} 个残留条目`)
      return { ok: true, data: { removed } }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    } finally {
      client.close()
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.FtpDownload,
    async (_event, payload: unknown): Promise<ApiResult<RemoteDownloadResult | null>> => {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      const relativePath = (payload as Record<string, unknown>)?.relativePath
      if (typeof relativePath !== 'string' || relativePath.trim() === '') {
        return { ok: false, error: new ServiceError('PARAM_INVALID', 'relativePath 必须是非空字符串').appError }
      }

      const save = await dialog.showSaveDialog({
        title: '下载远程文件',
        defaultPath: path.join(app.getPath('downloads'), path.posix.basename(relativePath))
      })
      if (save.canceled || !save.filePath) return { ok: true, data: null }

      const client = createFtpClient()
      try {
        return { ok: true, data: await downloadRemoteFile(client, result.data, relativePath, save.filePath) }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      } finally {
        client.close()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.FtpUploadFiles,
    async (_event, payload: unknown): Promise<ApiResult<RemoteUploadResult | null>> => {
      const result = loadEnvConfig(resolveBaseDir())
      if (!result.ok) return { ok: false, error: result.error }
      const relativeDirectory = (payload as Record<string, unknown>)?.relativeDirectory
      if (relativeDirectory !== undefined && typeof relativeDirectory !== 'string') {
        return { ok: false, error: new ServiceError('PARAM_INVALID', 'relativeDirectory 必须是字符串').appError }
      }

      const selected = await dialog.showOpenDialog({
        title: '选择要上传的文件',
        properties: ['openFile', 'multiSelections']
      })
      if (selected.canceled || selected.filePaths.length === 0) return { ok: true, data: null }

      const client = createFtpClient()
      try {
        return {
          ok: true,
          data: await uploadRemoteFiles(client, result.data, relativeDirectory ?? '', selected.filePaths)
        }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      } finally {
        client.close()
      }
    }
  )
}
