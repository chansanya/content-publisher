import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import type { ApiResult, OperationLogEvent, UploadProgress } from '@shared/types'
import type { FtpApi, PrepareInput } from './api'

function invoke<T>(channel: string, arg?: unknown): Promise<ApiResult<T>> {
  return ipcRenderer.invoke(channel, arg)
}

const api: FtpApi = {
  getConfig: () => invoke(IPC_CHANNELS.ConfigGet),
  copyPassword: () => invoke(IPC_CHANNELS.ConfigCopyPassword),
  copyText: (text: string) => invoke(IPC_CHANNELS.ConfigCopyText, text),
  openRecordDir: () => invoke(IPC_CHANNELS.ConfigOpenRecordDir),
  openLogDir: () => invoke(IPC_CHANNELS.ConfigOpenLogDir),
  openEnvFile: () => invoke(IPC_CHANNELS.ConfigOpenEnvFile),
  openWeb: () => invoke(IPC_CHANNELS.ConfigOpenWeb),
  restartApp: () => invoke(IPC_CHANNELS.AppRestart),
  getAppVersion: () => invoke(IPC_CHANNELS.AppGetVersion),
  testConnection: () => invoke(IPC_CHANNELS.FtpTestConnection),
  listRemoteDir: (relativePath = '') => invoke(IPC_CHANNELS.FtpListDir, { relativePath }),
  deleteRemoteEntry: (relativePath: string) => invoke(IPC_CHANNELS.FtpDelete, { relativePath }),
  downloadRemoteFile: (relativePath: string) => invoke(IPC_CHANNELS.FtpDownload, { relativePath }),
  uploadRemoteFiles: (relativeDirectory = '') => invoke(IPC_CHANNELS.FtpUploadFiles, { relativeDirectory }),
  syncDeployRuntime: () => invoke(IPC_CHANNELS.FtpSyncDeployRuntime),
  clearRemoteRoot: () => invoke(IPC_CHANNELS.FtpClearRoot),
  cleanIncoming: () => invoke(IPC_CHANNELS.FtpCleanIncoming),
  getReplacements: () => invoke(IPC_CHANNELS.ReplacementsGet),
  saveReplacements: (config) => invoke(IPC_CHANNELS.ReplacementsSave, config),
  openReplacementsFile: () => invoke(IPC_CHANNELS.ReplacementsOpenFile),
  preparePublish: (input: PrepareInput) => invoke(IPC_CHANNELS.PublishPrepare, input),
  prepareRepublish: (recordId: string) => invoke(IPC_CHANNELS.PublishPrepareRepublish, { recordId }),
  executePublish: (releaseId: string) => invoke(IPC_CHANNELS.PublishExecute, { releaseId }),
  rollbackPublish: (artifactId: string) => invoke(IPC_CHANNELS.PublishRollback, { artifactId }),
  republishRecord: (recordId: string) => invoke(IPC_CHANNELS.PublishRepublish, { recordId }),
  getRecords: () => invoke(IPC_CHANNELS.PublishGetRecords),
  getRecord: (id: string) => invoke(IPC_CHANNELS.PublishGetRecord, { id }),
  deleteRecord: (id: string) => invoke(IPC_CHANNELS.PublishDeleteRecord, { id }),
  getProxyStatus: () => invoke(IPC_CHANNELS.ProxyGetStatus),
  saveProxySettings: (port: number, spaFallback: boolean) =>
    invoke(IPC_CHANNELS.ProxySaveSettings, { port, spaFallback }),
  startProxy: () => invoke(IPC_CHANNELS.ProxyStart),
  stopProxy: () => invoke(IPC_CHANNELS.ProxyStop),
  applyProxyArtifact: (artifactId: string) => invoke(IPC_CHANNELS.ProxyApplyArtifact, { artifactId }),
  applyProxyReplacements: () => invoke(IPC_CHANNELS.ProxyApplyReplacements),
  openProxySite: () => invoke(IPC_CHANNELS.ProxyOpenSite),
  openProxyRoot: () => invoke(IPC_CHANNELS.ProxyOpenRoot),
  onProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, progress: UploadProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.PublishProgress, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PublishProgress, listener)
  },
  onOperationLog: (callback) => {
    const listener = (_event: IpcRendererEvent, log: OperationLogEvent): void => callback(log)
    ipcRenderer.on(IPC_CHANNELS.OperationLog, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OperationLog, listener)
  }
}

contextBridge.exposeInMainWorld('ftpApi', api)
