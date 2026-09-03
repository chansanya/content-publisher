import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import path from 'node:path'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { OperationLogEvent } from '@shared/types'
import { resolveBaseDir } from './appPaths'
import { PublishService } from './services/publishService'
import { ElectronProxySettingsStore, ProxyService } from './services/proxyService'
import { registerIpc } from './ipc/registerIpc'
import { appendLogFile, initLogFileService } from './services/logFileService'

let mainWindow: BrowserWindow | null = null
let proxyService: ProxyService | null = null
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
  }
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
  const userDataDir = app.getPath('userData')
  proxyService = new ProxyService({
    rootDir: path.join(resolveBaseDir(), '.web'),
    settingsStore: new ElectronProxySettingsStore(userDataDir),
    resolveArtifact: (artifactId) => publishService.getVerifiedArtifact(artifactId)
  })
  registerIpc(publishService, proxyService, {
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
