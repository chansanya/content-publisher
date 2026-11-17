import type {
  ApiResult,
  UpdateCheckResult,
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
  PluginListResult,
  PluginDeleteResult,
  PluginCreateResult,
  PluginProgress,
  PluginPushResult,
  PluginSummary,
  CertificateCredentialInput,
  CertificateMonitorSettings,
  CertificateMonitorStatus,
  CertificateApplicationDetail,
  CertificateCloudResource,
  CertificateExecuteInput,
  CertificateProgressEvent,
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
  openWeb(): Promise<ApiResult<true>>
  restartApp(): Promise<ApiResult<true>>
  getAppVersion(): Promise<ApiResult<string>>
  checkForUpdate(): Promise<ApiResult<UpdateCheckResult>>
  openReleases(): Promise<ApiResult<true>>
  testConnection(): Promise<ApiResult<ConnectionTestResult>>
  listRemoteDir(relativePath?: string): Promise<ApiResult<RemoteDirectoryListing>>
  deleteRemoteEntry(relativePath: string): Promise<ApiResult<RemoteDeleteResult>>
  downloadRemoteFile(relativePath: string): Promise<ApiResult<RemoteDownloadResult | null>>
  uploadRemoteFiles(relativeDirectory?: string): Promise<ApiResult<RemoteUploadResult | null>>
  listPlugins(): Promise<ApiResult<PluginListResult>>
  createPlugin(name: string): Promise<ApiResult<PluginCreateResult>>
  savePluginMapping(name: string, remotePath: string): Promise<ApiResult<PluginSummary>>
  pushPlugin(name: string): Promise<ApiResult<PluginPushResult>>
  deletePlugin(name: string): Promise<ApiResult<PluginDeleteResult>>
  openPluginRoot(): Promise<ApiResult<true>>
  onPluginProgress(callback: (progress: PluginProgress) => void): () => void
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
  getCertificateStatus(): Promise<ApiResult<CertificateMonitorStatus>>
  saveCertificateSettings(settings: CertificateMonitorSettings): Promise<ApiResult<CertificateMonitorStatus>>
  saveCertificateCredentials(input: CertificateCredentialInput): Promise<ApiResult<CertificateMonitorStatus>>
  clearCertificateCredentials(): Promise<ApiResult<CertificateMonitorStatus>>
  checkCertificateNow(): Promise<ApiResult<CertificateMonitorStatus>>
  refreshCertificateList(): Promise<ApiResult<CertificateMonitorStatus>>
  applyCertificate(input: { instanceId: string; domain: string }): Promise<ApiResult<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }>>
  inspectCertificateApplication(instanceId: string): Promise<ApiResult<{ status: CertificateMonitorStatus; details?: CertificateApplicationDetail }>>
  clearCertificateApplicationUncertainty(instanceId: string): Promise<ApiResult<CertificateMonitorStatus>>
  resumeCertificateDeployment(): Promise<ApiResult<CertificateMonitorStatus>>
  stopCertificateTask(): Promise<ApiResult<CertificateMonitorStatus>>
  endCertificateTask(): Promise<ApiResult<CertificateMonitorStatus>>
  listCertificateResources(): Promise<ApiResult<{ status: CertificateMonitorStatus; resources?: CertificateCloudResource[] }>>
  executeSelectedCertificate(input: CertificateExecuteInput): Promise<ApiResult<CertificateMonitorStatus>>
  openCertificateConsole(): Promise<ApiResult<true>>
  onCertificateProgress(callback: (event: CertificateProgressEvent) => void): () => void
}
