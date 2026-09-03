import { ref } from 'vue'
import { defineStore } from 'pinia'

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'
export type LogScope = 'connection' | 'remote' | 'publish' | 'rollback' | 'records' | 'proxy' | 'env'

export interface LogEntry {
  id: number
  time: string
  level: LogLevel
  scope: LogScope
  message: string
}

const MAX_ENTRIES = 400

function nowTime(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 全局日志：合并渲染进程操作结果与主进程发布过程日志 */
export const useLogsStore = defineStore('logs', () => {
  const entries = ref<LogEntry[]>([])
  let seq = 0
  let unbindMain: (() => void) | null = null

  function log(level: LogLevel, scope: LogScope, message: string): void {
    entries.value.push({ id: seq++, time: nowTime(), level, scope, message })
    if (entries.value.length > MAX_ENTRIES) {
      entries.value.splice(0, entries.value.length - MAX_ENTRIES)
    }
  }

  function clear(): void {
    entries.value = []
  }

  function bindMain(): void {
    if (unbindMain) return
    unbindMain = window.ftpApi.onOperationLog((entry) => {
      log(entry.level, entry.scope, entry.message)
    })
  }

  return { entries, log, clear, bindMain }
})
