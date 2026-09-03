import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { AppError, RemoteDirectoryListing, RemoteEntry } from '@shared/types'
import { useLogsStore } from './logs'

export const useRemoteStore = defineStore('remote', () => {
  const logs = useLogsStore()
  const listing = ref<RemoteDirectoryListing | null>(null)
  const loading = ref(false)
  const deletingPath = ref<string | null>(null)
  const downloadingPath = ref<string | null>(null)
  const uploading = ref(false)
  const clearing = ref(false)
  const error = ref<AppError | null>(null)

  const canGoUp = computed(() => Boolean(listing.value?.relativePath))

  async function load(relativePath = listing.value?.relativePath ?? ''): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      const result = await window.ftpApi.listRemoteDir(relativePath)
      if (!result.ok) {
        error.value = result.error
        logs.log('error', 'remote', `远程目录读取失败: ${result.error.message}`)
        return
      }
      listing.value = result.data
      logs.log('info', 'remote', `已读取 ${result.data.remotePath} · ${result.data.entries.length} 项`)
    } finally {
      loading.value = false
    }
  }

  async function open(entry: RemoteEntry): Promise<void> {
    if (entry.type === 'directory') await load(entry.path)
  }

  async function goUp(): Promise<void> {
    const current = listing.value?.relativePath ?? ''
    if (!current) return
    const parts = current.split('/')
    parts.pop()
    await load(parts.join('/'))
  }

  async function remove(entry: RemoteEntry): Promise<boolean> {
    if (deletingPath.value || downloadingPath.value || uploading.value) return false
    deletingPath.value = entry.path
    error.value = null
    try {
      const result = await window.ftpApi.deleteRemoteEntry(entry.path)
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        logs.log('error', 'remote', `删除失败: ${result.error.message}`)
        return false
      }
      ElMessage.success(`已删除 ${entry.name}`)
      logs.log('success', 'remote', `已删除远程${result.data.type === 'directory' ? '目录' : '文件'} ${entry.path}`)
      await load()
      return true
    } finally {
      deletingPath.value = null
    }
  }

  async function download(entry: RemoteEntry): Promise<void> {
    if (entry.type === 'directory' || downloadingPath.value || deletingPath.value || uploading.value) return
    downloadingPath.value = entry.path
    error.value = null
    try {
      const result = await window.ftpApi.downloadRemoteFile(entry.path)
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        logs.log('error', 'remote', `下载失败: ${result.error.message}`)
        return
      }
      if (!result.data) return
      ElMessage.success(`已下载 ${entry.name}`)
      logs.log('success', 'remote', `远程文件已下载到 ${result.data.localPath}`)
    } finally {
      downloadingPath.value = null
    }
  }

  async function uploadFiles(): Promise<void> {
    if (uploading.value || deletingPath.value || downloadingPath.value) return
    uploading.value = true
    error.value = null
    try {
      const result = await window.ftpApi.uploadRemoteFiles(listing.value?.relativePath ?? '')
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        logs.log('error', 'remote', `上传失败: ${result.error.message}`)
        return
      }
      if (!result.data) return
      ElMessage.success(`已上传 ${result.data.uploadedFiles} 个文件`)
      logs.log('success', 'remote', `已上传 ${result.data.uploadedFiles} 个文件到 ${result.data.remoteDirectory}`)
      await load()
    } finally {
      uploading.value = false
    }
  }

  async function clearRoot(): Promise<boolean> {
    if (clearing.value || uploading.value || deletingPath.value !== null || downloadingPath.value !== null) return false
    clearing.value = true
    error.value = null
    try {
      const result = await window.ftpApi.clearRemoteRoot()
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        logs.log('error', 'remote', `远程根目录清空失败: ${result.error.message}`)
        return false
      }
      ElMessage.success(`已清空远程根目录，删除 ${result.data.removed} 个顶层条目`)
      logs.log('success', 'remote', `远程根目录已清空 · 删除 ${result.data.removed} 个顶层条目（.ftppublisher 已保留）`)
      await load('')
      return true
    } finally {
      clearing.value = false
    }
  }

  return {
    listing,
    loading,
    deletingPath,
    downloadingPath,
    uploading,
    clearing,
    error,
    canGoUp,
    load,
    open,
    goUp,
    remove,
    download,
    uploadFiles,
    clearRoot
  }
})
