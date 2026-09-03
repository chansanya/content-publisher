import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { AppError, FtpConfigView } from '@shared/types'
import { useLogsStore } from './logs'

export type TestState = 'idle' | 'testing' | 'success' | 'failed'

export const useConnectionStore = defineStore('connection', () => {
  const logs = useLogsStore()

  const config = ref<FtpConfigView | null>(null)
  const configError = ref<AppError | null>(null)
  const loaded = ref(false)

  const testState = ref<TestState>('idle')
  const latencyMs = ref<number | null>(null)
  const testError = ref<AppError | null>(null)

  const canTest = computed(() => config.value !== null)

  async function loadConfig(): Promise<void> {
    try {
      const result = await window.ftpApi.getConfig()
      if (result.ok) {
        config.value = result.data
        configError.value = null
        logs.log('info', 'connection', `已加载配置 ${result.data.host}:${result.data.port} · 远程根目录 ${result.data.remoteRoot}`)
      } else {
        config.value = null
        configError.value = result.error
        logs.log('warn', 'connection', `配置加载失败: ${result.error.message}`)
      }
    } catch (err) {
      config.value = null
      configError.value = { code: 'IPC_ERROR', message: err instanceof Error ? err.message : String(err) }
      logs.log('error', 'connection', `配置加载异常: ${configError.value.message}`)
    }
    loaded.value = true
  }

  async function testConnection(): Promise<void> {
    if (!config.value || testState.value === 'testing') return
    testState.value = 'testing'
    testError.value = null
    latencyMs.value = null
    logs.log('info', 'connection', `正在测试连接 ${config.value.secure ? 'FTPS' : 'FTP'} ${config.value.host}:${config.value.port}`)
    try {
      const result = await window.ftpApi.testConnection()
      if (result.ok) {
        testState.value = 'success'
        latencyMs.value = result.data.latencyMs
        logs.log('success', 'connection', `连接成功，延迟 ${result.data.latencyMs}ms，远程根目录可访问`)
      } else {
        testState.value = 'failed'
        testError.value = result.error
        logs.log('error', 'connection', `连接失败: ${result.error.message}${result.error.detail ? ` (${result.error.detail})` : ''}`)
      }
    } catch (err) {
      testState.value = 'failed'
      testError.value = { code: 'IPC_ERROR', message: err instanceof Error ? err.message : String(err) }
      logs.log('error', 'connection', `连接测试异常: ${testError.value.message}`)
    }
  }

  async function copyPassword(): Promise<void> {
    const result = await window.ftpApi.copyPassword()
    if (result.ok) {
      ElMessage.success('密码已复制到剪贴板')
    } else {
      ElMessage.error(result.error.message)
    }
  }

  async function copyText(text: string, label: string): Promise<void> {
    const result = await window.ftpApi.copyText(text)
    if (result.ok) {
      ElMessage.success(`${label}已复制`)
    } else {
      ElMessage.error(result.error.message)
    }
  }

  async function openRecordDir(): Promise<void> {
    const result = await window.ftpApi.openRecordDir()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  async function openLogDir(): Promise<void> {
    const result = await window.ftpApi.openLogDir()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  async function openEnvFile(): Promise<void> {
    const result = await window.ftpApi.openEnvFile()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  async function restartApp(): Promise<void> {
    const result = await window.ftpApi.restartApp()
    if (!result.ok) ElMessage.error(result.error.message)
  }

  return {
    config,
    configError,
    loaded,
    testState,
    latencyMs,
    testError,
    canTest,
    loadConfig,
    testConnection,
    copyPassword,
    copyText,
    openRecordDir,
    openLogDir,
    openEnvFile,
    restartApp
  }
})
