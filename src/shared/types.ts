export type PublishStatus =
  | 'preparing'
  | 'clearing'
  | 'uploading'
  | 'deploying'
  | 'succeeded'
  | 'failed'
  | 'interrupted'

export type PublishKind = 'publish' | 'rollback'

export type SourceType = 'directory' | 'zip' | 'proxy'

export interface AppError {
  code: string
  message: string
  detail?: string
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  available: boolean
}

export interface OperationLogEvent {
  /** debug 仅落日志文件，终端与界面只显示 info 及以上 */
  level: 'debug' | 'info' | 'success' | 'warn' | 'error'
  scope: 'publish' | 'remote' | 'plugin' | 'env' | 'certificate'
  message: string
}

/** 脱敏后的连接配置，密码永不越过主进程 */
export interface FtpConfigView {
  host: string
  port: number
  user: string
  passwordMasked: string
  remoteRoot: string
  secure: boolean
  tlsRejectUnauthorized: boolean
  recordDir: string
  envPath: string
  deployEndpoint: string
  deployTokenConfigured: boolean
  webUrl?: string
}

export interface ConnectionTestResult {
  latencyMs: number
}

export type RemoteEntryType = 'file' | 'directory' | 'link'

export interface RemoteEntry {
  name: string
  path: string
  type: RemoteEntryType
  size: number
  modifiedAt?: string
}

export interface RemoteDirectoryListing {
  relativePath: string
  remotePath: string
  entries: RemoteEntry[]
  /** 映射插件的远程相对路径，远程文件页禁止删除其本身及子项 */
  protectedPaths?: string[]
}

export interface RemoteDeleteResult {
  path: string
  type: RemoteEntryType
}

export interface RemoteClearResult {
  removed: number
}

export interface RemoteCleanIncomingResult {
  removed: number
}

export interface ProxyReplacementResult {
  files: number
  count: number
}

export interface RemoteDownloadResult {
  path: string
  localPath: string
  size: number
}

export interface RemoteUploadResult {
  remoteDirectory: string
  uploadedFiles: number
  totalBytes: number
}

export interface PluginSummary {
  name: string
  remotePath: string
  localExists: boolean
  totalFiles: number
  totalBytes: number
}

export interface PluginListResult {
  rootDir: string
  plugins: PluginSummary[]
}

export interface PluginCreateResult {
  name: string
  localPath: string
  remotePath: string
}

export interface PluginPushResult {
  name: string
  remoteDirectory: string
  uploadedFiles: number
  totalBytes: number
}

export interface PluginDeleteResult {
  name: string
  remoteDirectory: string
  existed: boolean
  localRemoved: boolean
  mappingRemoved: boolean
}

export interface ManifestFile {
  /** POSIX 风格相对路径，如 assets/app.js */
  path: string
  size: number
  mtime?: number
}

export interface ArtifactManifest {
  id: string
  createdAt: string
  sourceName: string
  sourceType: SourceType
  files: { path: string; size: number }[]
  totalFiles: number
  totalBytes: number
}

export interface ReplacementRule {
  from: string
  to: string
}

export interface FileReplacement {
  path: string
  rules: ReplacementRule[]
}

export interface ReplacementConfig {
  /** 对所有文本文件生效 */
  global: ReplacementRule[]
  /** 按发布根相对路径精确匹配的附加规则 */
  files: FileReplacement[]
}

export interface PrepareSummary {
  releaseId: string
  sourceName: string
  sourceType: SourceType
  files: ManifestFile[]
  totalFiles: number
  totalBytes: number
  /** ZIP 输入被自动剥离的唯一顶级目录名 */
  strippedTopDir?: string
  /** 内容替换统计（命中文件数 / 替换处数） */
  replacements: { files: number; count: number }
}

export interface UploadProgress {
  releaseId: string
  phase: 'clearing' | 'uploading' | 'deploying'
  currentFile: string
  currentFileBytes: number
  currentFileTotalBytes: number
  uploadedBytes: number
  totalBytes: number
  completedFiles: number
  totalFiles: number
  percentage: number
  bytesPerSecond: number
  estimatedSeconds: number | null
}

export interface PluginProgress extends UploadProgress {
  pluginName: string
}

export interface PublishRecord {
  id: string
  kind: PublishKind
  artifactId: string
  rollbackFromId?: string
  sourceName: string
  sourceType: SourceType
  remoteRoot: string
  status: PublishStatus
  startedAt: string
  finishedAt?: string
  durationMs?: number
  totalFiles: number
  totalBytes: number
  uploadedFiles: number
  uploadedBytes: number
  error?: AppError
}

export interface RollbackTarget {
  artifactId: string
  sourceName: string
  sourceType: SourceType
  createdAt: string
  totalFiles: number
  totalBytes: number
  /** 本地归档是否仍然可用 */
  artifactAvailable: boolean
}

export interface DeleteRecordResult {
  id: string
  /** 是否连带删除了本地归档目录（该版本不再被任何记录引用时） */
  artifactRemoved: boolean
}

export interface ProxySettings {
  port: number
  spaFallback: boolean
  lastAppliedArtifactId?: string
}

export interface ProxyStatus extends ProxySettings {
  running: boolean
  busy: boolean
  rootDir: string
  bindHost: '0.0.0.0'
  urls: string[]
}

export interface ApplyArtifactResult {
  artifactId: string
  totalFiles: number
  rootDir: string
  restarted: boolean
}

export type CertificateAutomationState =
  | 'idle'
  | 'checking'
  | 'deploying'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'stopped'

export interface CertificateMonitorSettings {
  enabled: boolean
  domain: string
  checkHour: number
  warningDays: number
  deploymentResourceIds?: number[]
}

export interface CertificateCredentialInput {
  accessKeyId: string
  accessKeySecret: string
}

export interface CertificateSnapshot {
  domain: string
  subject: string
  issuer: string
  serialNumber: string
  fingerprint256: string
  validFrom: string
  validTo: string
  remainingDays: number
  checkedAt: string
}

export interface CertificateInstanceSummary {
  instanceId: string
  name: string
  status: string
  domain: string
  certificateId?: number
  certificateStatus?: string
  certificateExpiresAt?: string
  available?: boolean
  subscriptionExpiresAt?: string
}

export interface CertificateDnsInstruction {
  domain: string
  rootDomain: string
  type: string
  name: string
  value: string
}

export interface CertificateApplicationDetail {
  instanceId: string
  domain: string
  status: string
  certificateStatus: string
  certificateId?: number
  certificateExpiresAt?: string
  validationMethod: string
  available: boolean
  hasValidation: boolean
  records: CertificateDnsInstruction[]
}

export interface CertificateApplicationAttempt {
  instanceId: string
  domain: string
  phase: 'configuring' | 'configured' | 'submitting' | 'submitted' | 'uncertain' | 'cleared'
  updatedAt: string
}

export interface CertificateAutomationRecord {
  state: CertificateAutomationState
  paused?: boolean
  mode?: 'renewal' | 'deploy-existing'
  deploymentResourceIds?: number[]
  deploymentDomains?: string[]
  expectedSerial?: string
  expectedValidTo?: string
  domain?: string
  sourceSerial?: string
  sourceFingerprint?: string
  sourceValidTo?: string
  applicationPending?: boolean
  orderId?: number
  instanceId?: string
  certificateId?: string
  deploymentJobId?: number
  deploymentStarted?: boolean
  deploymentPending?: boolean
  expectedFingerprint?: string
  lastCheckAt?: string
  nextCheckAt?: string
  updatedAt?: string
  lastError?: AppError
}

export interface CertificateMonitorStatus {
  settings: CertificateMonitorSettings
  credentialsConfigured: boolean
  accessKeyIdMasked: string
  certificate?: CertificateSnapshot
  certificates?: CertificateInstanceSummary[]
  applications?: CertificateApplicationAttempt[]
  automation: CertificateAutomationRecord
  busy: boolean
  settling?: boolean
  operation?: 'monitor' | 'deploy' | 'apply' | 'inspect' | 'refresh' | 'resources'
}

export interface CertificateCloudResource {
  id: number
  domain: string
  regionId: string
  instanceId?: string
  certificateId?: number
  certificateName?: string
  certificateEndTime?: string
}

export interface CertificateExecuteInput {
  instanceId: string
  resourceIds: number[]
  certificateId: number
  resourceDomains?: string[]
}

export interface CertificateProgressEvent {
  state: CertificateAutomationState
  message: string
  updatedAt: string
  status: CertificateMonitorStatus
}
