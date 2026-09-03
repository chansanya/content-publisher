import type {
  ApiResult,
  ConnectionTestResult,
  FtpConfigView,
  OperationLogEvent,
  ApplyArtifactResult,
  DeleteRecordResult,
  PrepareSummary,
  ProxyReplacementResult,
  ProxyStatus,
  RemoteCleanIncomingResult,
  ReplacementConfig,
  RemoteClearResult,
  SourceType,
  PublishRecord,
  RemoteDeleteResult,
  RemoteDirectoryListing,
  RemoteDownloadResult,
  RemoteUploadResult,
  UploadProgress
} from '@shared/types'

export type PrepareInput = { type: SourceType }

/** preload 暴露给渲染进程的全部能力，与 IPC 白名单一一对应 */
export interface FtpApi {
  getConfig(): Promise<ApiResult<FtpConfigView>>
  copyPassword(): Promise<ApiResult<null>>
  copyText(text: string): Promise<ApiResult<null>>
  openRecordDir(): Promise<ApiResult<true>>
  openLogDir(): Promise<ApiResult<true>>
  openEnvFile(): Promise<ApiResult<true>>
  restartApp(): Promise<ApiResult<true>>
  getAppVersion(): Promise<ApiResult<string>>
  testConnection(): Promise<ApiResult<ConnectionTestResult>>
  listRemoteDir(relativePath?: string): Promise<ApiResult<RemoteDirectoryListing>>
  deleteRemoteEntry(relativePath: string): Promise<ApiResult<RemoteDeleteResult>>
  downloadRemoteFile(relativePath: string): Promise<ApiResult<RemoteDownloadResult | null>>
  uploadRemoteFiles(relativeDirectory?: string): Promise<ApiResult<RemoteUploadResult | null>>
  syncDeployRuntime(): Promise<ApiResult<null>>
  clearRemoteRoot(): Promise<ApiResult<RemoteClearResult>>
  cleanIncoming(): Promise<ApiResult<RemoteCleanIncomingResult>>
  getReplacements(): Promise<ApiResult<ReplacementConfig | null>>
  saveReplacements(config: ReplacementConfig): Promise<ApiResult<null>>
  openReplacementsFile(): Promise<ApiResult<true>>
  preparePublish(input: PrepareInput): Promise<ApiResult<PrepareSummary>>
  prepareRepublish(recordId: string): Promise<ApiResult<PrepareSummary>>
  executePublish(releaseId: string): Promise<ApiResult<PublishRecord>>
  rollbackPublish(artifactId: string): Promise<ApiResult<PublishRecord>>
  republishRecord(recordId: string): Promise<ApiResult<PublishRecord>>
  getRecords(): Promise<ApiResult<PublishRecord[]>>
  getRecord(id: string): Promise<ApiResult<PublishRecord>>
  deleteRecord(id: string): Promise<ApiResult<DeleteRecordResult>>
  onProgress(callback: (progress: UploadProgress) => void): () => void
  onOperationLog(callback: (event: OperationLogEvent) => void): () => void
  getProxyStatus(): Promise<ApiResult<ProxyStatus>>
  saveProxySettings(port: number, spaFallback: boolean): Promise<ApiResult<ProxyStatus>>
  startProxy(): Promise<ApiResult<ProxyStatus>>
  stopProxy(): Promise<ApiResult<ProxyStatus>>
  applyProxyArtifact(artifactId: string): Promise<ApiResult<ApplyArtifactResult>>
  applyProxyReplacements(): Promise<ApiResult<ProxyReplacementResult>>
  openProxySite(): Promise<ApiResult<true>>
  openProxyRoot(): Promise<ApiResult<true>>
}
