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

export interface OperationLogEvent {
  /** debug 仅落日志文件，终端与界面只显示 info 及以上 */
  level: 'debug' | 'info' | 'success' | 'warn' | 'error'
  scope: 'publish' | 'remote' | 'plugin' | 'env'
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
