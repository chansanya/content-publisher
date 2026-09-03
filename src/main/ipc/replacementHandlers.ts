import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, ReplacementConfig } from '@shared/types'
import { resolveBaseDir } from '../appPaths'
import { loadReplacements, REPLACEMENTS_FILE_NAME, saveReplacements } from '../services/replacementService'
import { ServiceError, toAppError } from '../services/errors'

export function registerReplacementHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ReplacementsGet, async (): Promise<ApiResult<ReplacementConfig | null>> => {
    try {
      return { ok: true, data: await loadReplacements(resolveBaseDir()) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.ReplacementsSave,
    async (_event, payload: unknown): Promise<ApiResult<null>> => {
      const config = payload as Partial<ReplacementConfig> | null
      if (!config || !Array.isArray(config.global) || !Array.isArray(config.files)) {
        return { ok: false, error: new ServiceError('PARAM_INVALID', '替换规则结构非法').appError }
      }
      try {
        saveReplacements(resolveBaseDir(), config as ReplacementConfig)
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: toAppError(err) }
      }
    }
  )

  // 打开规则文件所在位置；文件已存在时在资源管理器中高亮选中
  ipcMain.handle(IPC_CHANNELS.ReplacementsOpenFile, async (): Promise<ApiResult<true>> => {
    try {
      const baseDir = resolveBaseDir()
      const file = path.join(baseDir, REPLACEMENTS_FILE_NAME)
      if (existsSync(file)) shell.showItemInFolder(file)
      else await shell.openPath(baseDir)
      return { ok: true, data: true }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}
