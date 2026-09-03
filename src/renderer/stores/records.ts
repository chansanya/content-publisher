import { ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { AppError, PublishRecord } from '@shared/types'
import { useLogsStore } from './logs'
import { useProgressStore } from './progress'

export const useRecordsStore = defineStore('records', () => {
  const logs = useLogsStore()
  const progress = useProgressStore()

  const records = ref<PublishRecord[]>([])
  const loading = ref(false)
  const loadError = ref<AppError | null>(null)

  const drawerOpen = ref(false)
  const detail = ref<PublishRecord | null>(null)

  const rollbackBusy = ref(false)
  const rollbackError = ref<AppError | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const res = await window.ftpApi.getRecords()
      if (res.ok) {
        records.value = res.data
        loadError.value = null
      } else {
        loadError.value = res.error
        logs.log('warn', 'records', `记录加载失败: ${res.error.message}`)
      }
    } finally {
      loading.value = false
    }
  }

  async function openDetail(id: string): Promise<void> {
    const res = await window.ftpApi.getRecord(id)
    if (res.ok) {
      detail.value = res.data
      drawerOpen.value = true
    } else {
      ElMessage.error(res.error.message)
    }
  }

  function closeDetail(): void {
    drawerOpen.value = false
  }

  /** 删除记录：若该版本归档不再被引用，主进程会连带删除本地 ZIP */
  async function remove(id: string): Promise<boolean> {
    const res = await window.ftpApi.deleteRecord(id)
    if (!res.ok) {
      ElMessage.error(res.error.message)
      return false
    }
    logs.log(
      'info',
      'records',
      res.data.artifactRemoved
        ? `已删除记录 ${id}，并移除本地归档`
        : `已删除记录 ${id}（本地归档仍被其它记录引用，保留）`
    )
    await load()
    if (drawerOpen.value && detail.value?.id === id) {
      drawerOpen.value = false
      detail.value = null
    }
    return true
  }

  /** 回滚 = 重新执行「清空 + 完整上传」目标历史版本 */
  async function rollback(artifactId: string, sourceName: string): Promise<void> {
    if (rollbackBusy.value) return
    rollbackBusy.value = true
    rollbackError.value = null
    progress.begin()
    logs.log('info', 'rollback', `开始回滚到版本 ${sourceName}`)
    try {
      const res = await window.ftpApi.rollbackPublish(artifactId)
      if (!res.ok) {
        rollbackError.value = res.error
        logs.log('error', 'rollback', `回滚失败: ${res.error.message}${res.error.detail ? ` (${res.error.detail})` : ''}`)
        return
      }
      if (res.data.status === 'succeeded') {
        logs.log('success', 'rollback', `回滚成功 · ${res.data.totalFiles} 个文件 · ${res.data.durationMs ?? 0}ms`)
      } else {
        rollbackError.value = res.data.error ?? { code: 'ROLLBACK_FAILED', message: '回滚失败' }
        logs.log('error', 'rollback', `回滚失败: ${res.data.error?.message ?? '未知错误'} · 远程目录可能不完整`)
      }
      await load()
    } finally {
      rollbackBusy.value = false
      progress.end()
    }
  }

  return {
    records,
    loading,
    loadError,
    drawerOpen,
    detail,
    rollbackBusy,
    rollbackError,
    load,
    openDetail,
    closeDetail,
    rollback,
    remove
  }
})
