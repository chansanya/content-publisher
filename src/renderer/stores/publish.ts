import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { PrepareSummary, PublishRecord, SourceType } from '@shared/types'
import { formatBytes } from '@renderer/utils/format'
import { useLogsStore } from './logs'
import { useProgressStore } from './progress'

export const usePublishStore = defineStore('publish', () => {
  const logs = useLogsStore()
  const progress = useProgressStore()

  const summary = ref<PrepareSummary | null>(null)
  const scanning = ref<SourceType | null>(null)
  const republishRecordId = ref<string | null>(null)
  const loadingRepublishId = ref<string | null>(null)
  const executing = ref(false)
  const confirmClear = ref(false)
  const result = ref<PublishRecord | null>(null)
  const runError = ref<string | null>(null)

  const running = computed(() => executing.value)

  function resetRun(): void {
    executing.value = false
    confirmClear.value = false
    result.value = null
    runError.value = null
  }

  async function selectSource(type: SourceType): Promise<void> {
    scanning.value = type
    republishRecordId.value = null
    resetRun()
    summary.value = null
    try {
      const res = await window.ftpApi.preparePublish({ type })
      if (!res.ok) {
        if (res.error.code !== 'USER_CANCELLED') {
          ElMessage.error(res.error.message)
          logs.log('error', 'publish', `版本准备失败: ${res.error.message}`)
        }
        return
      }
      summary.value = res.data
      const extras: string[] = []
      if (res.data.strippedTopDir) extras.push(`已剥离唯一顶级目录 ${res.data.strippedTopDir}`)
      if (res.data.replacements.count > 0) {
        extras.push(`内容替换 ${res.data.replacements.count} 处 / ${res.data.replacements.files} 个文件`)
      }
      logs.log(
        'success',
        'publish',
        `已加载 ${res.data.sourceName} · ${res.data.totalFiles} 个文件 · ${formatBytes(res.data.totalBytes)}` +
          (extras.length > 0 ? `（${extras.join(' · ')}）` : '')
      )
    } finally {
      scanning.value = null
    }
  }

  async function loadRepublish(recordId: string): Promise<boolean> {
    if (loadingRepublishId.value) return false
    loadingRepublishId.value = recordId
    resetRun()
    summary.value = null
    republishRecordId.value = null
    try {
      const res = await window.ftpApi.prepareRepublish(recordId)
      if (!res.ok) {
        ElMessage.error(res.error.message)
        logs.log('error', 'publish', `历史 ZIP 加载失败: ${res.error.message}`)
        return false
      }
      republishRecordId.value = recordId
      summary.value = res.data
      logs.log(
        'success',
        'publish',
        `已加载失败或中断记录归档 ${res.data.sourceName} · ${res.data.totalFiles} 个文件 · ${formatBytes(res.data.totalBytes)}`
      )
      return true
    } finally {
      loadingRepublishId.value = null
    }
  }

  async function execute(): Promise<void> {
    if (!summary.value || executing.value || !confirmClear.value) return
    executing.value = true
    result.value = null
    runError.value = null
    progress.begin()
    const isRepublish = republishRecordId.value !== null
    logs.log(
      'info',
      'publish',
      `${isRepublish ? '开始再次发布' : '开始发布'} ${summary.value.sourceName}（${summary.value.totalFiles} 个文件 · ${formatBytes(summary.value.totalBytes)}）`
    )
    try {
      const res = isRepublish
        ? await window.ftpApi.republishRecord(republishRecordId.value!)
        : await window.ftpApi.executePublish(summary.value.releaseId)
      if (!res.ok) {
        runError.value = res.error.message
        logs.log('error', 'publish', `发布失败: ${res.error.message}`)
        return
      }
      result.value = res.data
      if (res.data.status === 'succeeded') {
        logs.log(
          'success',
          'publish',
          `发布成功 · ${res.data.totalFiles} 个文件 · ${formatBytes(res.data.totalBytes)} · 耗时 ${res.data.durationMs ?? 0}ms`
        )
      } else {
        logs.log(
          'error',
          'publish',
          `发布失败: ${res.data.error?.message ?? '未知错误'} · 远程目录可能不完整，请从发布记录选择历史成功版本回滚`
        )
      }
    } finally {
      executing.value = false
      progress.end()
    }
  }

  function clearSummary(): void {
    summary.value = null
    republishRecordId.value = null
    resetRun()
  }

  return {
    summary,
    scanning,
    republishRecordId,
    loadingRepublishId,
    executing,
    confirmClear,
    result,
    runError,
    running,
    selectSource,
    loadRepublish,
    execute,
    clearSummary
  }
})
