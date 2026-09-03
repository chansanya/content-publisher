import { appendFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { OperationLogEvent } from '@shared/types'

const RETENTION_DAYS = 14

let logDir = ''

export function logsDirPath(baseDir: string): string {
  return path.join(baseDir, 'logs')
}

/** 启动时调用：创建日志目录并清理保留期外的旧文件 */
export async function initLogFileService(baseDir: string): Promise<void> {
  logDir = logsDirPath(baseDir)
  await mkdir(logDir, { recursive: true })
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
    for (const name of await readdir(logDir)) {
      const match = /^fp-(\d{4}-\d{2}-\d{2})\.log$/.exec(name)
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) {
        await rm(path.join(logDir, name), { force: true })
      }
    }
  } catch {
    // 旧文件清理失败不影响启动
  }
}

const LEVEL_TAGS: Record<OperationLogEvent['level'], string> = {
  debug: 'DEBUG',
  info: 'INFO',
  success: 'SUCCESS',
  warn: 'WARN',
  error: 'ERROR'
}

/** 全量级别按天落盘；追加失败静默，日志写入永不影响业务 */
export function appendLogFile(event: OperationLogEvent): void {
  if (!logDir) return
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const line = `${date} ${time} [${LEVEL_TAGS[event.level]}] [${event.scope}] ${event.message}\n`
  void appendFile(path.join(logDir, `fp-${date}.log`), line, 'utf-8').catch(() => {})
}
