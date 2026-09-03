import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { AppError, ApplyArtifactResult, ProxyStatus } from '@shared/types'
import { useLogsStore } from './logs'

export const useProxyStore = defineStore('proxy', () => {
  const logs = useLogsStore()
  const status = ref<ProxyStatus | null>(null)
  const port = ref(4173)
  const spaFallback = ref(false)
  const loading = ref(false)
  const applyingArtifactId = ref<string | null>(null)
  const applyingReplacements = ref(false)
  const error = ref<AppError | null>(null)

  const busy = computed(
    () => loading.value || applyingArtifactId.value !== null || applyingReplacements.value || status.value?.busy === true
  )

  /** 对本地代理目录原地应用替换规则，验证所见即发布所得 */
  async function applyReplacements(): Promise<void> {
    if (applyingReplacements.value) return
    applyingReplacements.value = true
    try {
      const result = await window.ftpApi.applyProxyReplacements()
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        return
      }
      if (result.data.count === 0) ElMessage.info('规则已应用，无内容变更')
      else ElMessage.success(`本地代理内容已替换 ${result.data.count} 处 / ${result.data.files} 个文件`)
      logs.log('success', 'proxy', `本地代理替换规则应用 · ${result.data.count} 处 / ${result.data.files} 个文件`)
    } finally {
      applyingReplacements.value = false
    }
  }

  function sync(next: ProxyStatus): void {
    status.value = next
    port.value = next.port
    spaFallback.value = next.spaFallback
    error.value = null
  }

  async function load(): Promise<void> {
    const result = await window.ftpApi.getProxyStatus()
    if (result.ok) sync(result.data)
    else error.value = result.error
  }

  async function saveSettings(): Promise<boolean> {
    loading.value = true
    try {
      const result = await window.ftpApi.saveProxySettings(port.value, spaFallback.value)
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        return false
      }
      sync(result.data)
      logs.log('success', 'proxy', `代理设置已保存 · 端口 ${result.data.port} · SPA ${result.data.spaFallback ? '开启' : '关闭'}`)
      return true
    } finally {
      loading.value = false
    }
  }

  async function start(): Promise<void> {
    if (!(await saveSettings())) return
    loading.value = true
    try {
      const result = await window.ftpApi.startProxy()
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        return
      }
      sync(result.data)
      logs.log('success', 'proxy', `本地代理已启动 · ${result.data.urls.join(' · ')}`)
    } finally {
      loading.value = false
    }
  }

  async function stop(): Promise<void> {
    loading.value = true
    try {
      const result = await window.ftpApi.stopProxy()
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        return
      }
      sync(result.data)
      logs.log('info', 'proxy', '本地代理已停止')
    } finally {
      loading.value = false
    }
  }

  async function applyArtifact(artifactId: string, sourceName: string): Promise<ApplyArtifactResult | null> {
    if (busy.value) return null
    applyingArtifactId.value = artifactId
    error.value = null
    logs.log('info', 'proxy', `正在将历史版本 ${sourceName} 应用到本地代理`)
    try {
      const result = await window.ftpApi.applyProxyArtifact(artifactId)
      if (!result.ok) {
        error.value = result.error
        ElMessage.error(result.error.message)
        logs.log('error', 'proxy', `本地版本应用失败: ${result.error.message}`)
        return null
      }
      await load()
      ElMessage.success(`已应用 ${result.data.totalFiles} 个文件到本地代理`)
      logs.log('success', 'proxy', `历史版本已应用 · ${result.data.totalFiles} 个文件${result.data.restarted ? ' · 代理已恢复运行' : ''}`)
      return result.data
    } finally {
      applyingArtifactId.value = null
    }
  }

  async function openSite(): Promise<void> {
    const result = await window.ftpApi.openProxySite()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  async function openRoot(): Promise<void> {
    const result = await window.ftpApi.openProxyRoot()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  return {
    status,
    port,
    spaFallback,
    loading,
    applyingArtifactId,
    applyingReplacements,
    error,
    busy,
    load,
    saveSettings,
    start,
    stop,
    applyArtifact,
    applyReplacements,
    openSite,
    openRoot
  }
})
