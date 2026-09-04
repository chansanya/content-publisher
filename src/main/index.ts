import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import path from 'node:path'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { OperationLogEvent } from '@shared/types'
import { resolveBaseDir } from './appPaths'
import { PublishService } from './services/publishService'
import { ElectronPluginMappingStore, PluginService } from './services/pluginService'
import { ElectronProxySettingsStore, ProxyService } from './services/proxyService'
import { ensureEnvSeeded } from './services/envService'
import { registerIpc } from './ipc/registerIpc'
import { appendLogFile, initLogFileService } from './services/logFileService'

let mainWindow: BrowserWindow | null = null
let proxyService: ProxyService | null = null
let pluginService: PluginService | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

/** 日志统一出口：文件记录全部级别；debug 仅落文件，终端与界面只出 info 及以上 */
function dispatchLog(event: OperationLogEvent): void {
  appendLogFile(event)
  if (event.level === 'debug') return
  const tag = `[fp] [${event.level}] [${event.scope}]`
  if (event.level === 'error') console.error(tag, event.message)
  else console.log(tag, event.message)
  mainWindow?.webContents.send(IPC_CHANNELS.OperationLog, event)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0e14',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // F12 / Ctrl+Shift+I 开 DevTools：仅开发模式；打包版不给入口，避免交付对象误触
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return
      const isF12 = input.key === 'F12'
      const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i'
      if (isF12 || isCtrlShiftI) mainWindow?.webContents.toggleDevTools()
    })
  }

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const publishService = new PublishService({
  baseDir: resolveBaseDir,
  sendProgress: (progress) => {
    mainWindow?.webContents.send(IPC_CHANNELS.PublishProgress, progress)
  },
  sendLog: (event) => {
    dispatchLog(event)
  },
  selectInput: async (type) => {
    if (!mainWindow) return null
    const result =
      type === 'directory'
        ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
          })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  },
  getPluginPaths: async () => pluginService?.getPluginPaths() ?? []
})

if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  nativeTheme.themeSource = 'dark'
  await initLogFileService(resolveBaseDir())
  // 安装/便携版首次启动：exe 同级无 .env 时用包内出厂默认值补一份（已有配置绝不覆盖）
  try {
    if (ensureEnvSeeded(resolveBaseDir(), path.join(__dirname, 'default.env'))) {
      dispatchLog({ level: 'info', scope: 'env', message: '未发现 .env，已按出厂默认值生成配置文件' })
    }
  } catch (err) {
    console.error('[fp] [error] [env] 写入默认 .env 失败:', err)
  }
  const userDataDir = app.getPath('userData')
  proxyService = new ProxyService({
    rootDir: path.join(resolveBaseDir(), '.web'),
    settingsStore: new ElectronProxySettingsStore(userDataDir),
    resolveArtifact: (artifactId) => publishService.getVerifiedArtifact(artifactId)
  })
  const activePluginService = new PluginService({
    baseDir: resolveBaseDir,
    mappingStore: new ElectronPluginMappingStore(userDataDir),
    sendProgress: (progress) => {
      mainWindow?.webContents.send(IPC_CHANNELS.PluginProgress, progress)
    },
    sendLog: (event) => {
      dispatchLog(event)
    }
  })
  pluginService = activePluginService
  registerIpc(publishService, proxyService, activePluginService, {
    sendLog: (event) => {
      dispatchLog(event)
    }
  })

  const interrupted = publishService.markStartupInterrupted()
  if (interrupted > 0) {
    console.log(`[startup] Marked ${interrupted} unfinished task(s) as interrupted`)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  publishService.dispose()
  proxyService?.dispose()
})
