import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { ARTIFACTS_DIR_NAME, MAX_ZIP_FILES, MAX_ZIP_TOTAL_BYTES } from '@shared/constants'
import type {
  ArtifactManifest,
  ManifestFile,
  PrepareSummary,
  PublishKind,
  PublishRecord,
  SourceType,
  OperationLogEvent,
  UploadProgress
} from '@shared/types'
import type { ResolvedConfig } from './envService'
import { loadEnvConfig, scrubSecrets } from './envService'
import { ElectronStoreRecordStore, ACTIVE_STATUSES } from './recordService'
import type { RecordStore } from './recordService'
import { ServiceError, toAppError } from './errors'
import type { FtpClientLike } from './ftpService'
import { connectClient, createFtpClient } from './ftpService'
import {
  archiveArtifact,
  buildIgnore,
  makeTempDir,
  normalizeDirectory,
  normalizeZip,
  removeDir,
  scanDirectory,
  verifyArtifact
} from './artifactService'
import { ProgressTracker } from './progressTracker'
import { loadReplacements, type ReplacementStats } from './replacementService'
import {
  assertServerDeployConfig,
  remoteArchivePath,
  triggerServerDeploy,
  uploadDeployRuntime
} from './serverDeployService'
import { deployScriptPath } from '../appPaths'

const STAGING_TTL_MS = 24 * 60 * 60 * 1000

export interface PublishDeps {
  /** .env 查找基准目录（开发 = 项目根，打包 = 可执行文件同级） */
  baseDir: () => string
  sendProgress: (progress: UploadProgress) => void
  sendLog?: (event: OperationLogEvent) => void
  createClient?: () => FtpClientLike
  createStore?: (recordDir: string) => RecordStore
  /** 渲染进程未显式传路径时由主进程弹出系统选择框 */
  selectInput?: (type: SourceType) => Promise<string | null>
  /** 当前插件远程路径列表，发布时写入服务端 config.php 的 preserve 清单，避免全量替换误删插件 */
  getPluginPaths?: () => Promise<string[]>
}

interface StagingEntry {
  releaseId: string
  sourceName: string
  sourceType: SourceType
  files: ManifestFile[]
  localRoot: string
  tempDir?: string
  strippedTopDir?: string
  createdAt: number
}

function makeId(prefix: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${prefix}_${stamp}_${Math.random().toString(36).slice(2, 6)}`
}

function archiveDisplayName(sourceName: string): string {
  return sourceName.toLowerCase().endsWith('.zip') ? sourceName : `${sourceName}.zip`
}

export class PublishService {
  private readonly staging = new Map<string, StagingEntry>()
  private running = false
  private store: RecordStore | null = null
  private storeDir = ''

  constructor(private readonly deps: PublishDeps) {}

  private mustConfig(): ResolvedConfig {
    const result = loadEnvConfig(this.deps.baseDir())
    if (!result.ok) throw new ServiceError(result.error.code, result.error.message, result.error.detail)
    return result.data
  }

  private getStore(config: ResolvedConfig): RecordStore {
    if (!this.store || this.storeDir !== config.recordDir) {
      this.store = this.deps.createStore
        ? this.deps.createStore(config.recordDir)
        : new ElectronStoreRecordStore(config.recordDir)
      this.storeDir = config.recordDir
    }
    return this.store
  }

  private artifactsDir(config: ResolvedConfig): string {
    return path.join(config.recordDir, ARTIFACTS_DIR_NAME)
  }

  private ensureIdle(): void {
    if (this.running) {
      throw new ServiceError('PUBLISH_BUSY', '已有发布或回滚任务正在进行，请等待其完成')
    }
  }

  /**
   * 阶段一：扫描 / 解压规范化，产出待发布清单（不触发任何远程动作）。
   * 本地代理源（.web）只原地扫描生成清单，不做快照复制，发布时直接压缩该目录。
   */
  async prepare(input: { type: SourceType; path?: string }): Promise<PrepareSummary> {
    const isProxy = input.type === 'proxy'
    let sourcePath = isProxy ? '' : (input.path ?? '').trim()
    if (!isProxy && !sourcePath && this.deps.selectInput) {
      sourcePath = (await this.deps.selectInput(input.type)) ?? ''
      if (!sourcePath) throw new ServiceError('USER_CANCELLED', '已取消选择')
    }
    if (!isProxy && !sourcePath) {
      throw new ServiceError('INPUT_INVALID', '未提供待发布路径')
    }

    const releaseId = makeId('rel')
    const tempDir = isProxy ? undefined : makeTempDir()
    let proxyRoot = ''
    let files: ManifestFile[]
    let strippedTopDir: string | undefined
    let sourceName: string
    let replacementStats: ReplacementStats = { files: 0, count: 0, hits: [] }
    try {
      if (isProxy) {
        proxyRoot = path.join(this.deps.baseDir(), '.web')
        if (!existsSync(proxyRoot) || !statSync(proxyRoot).isDirectory()) {
          throw new ServiceError('INPUT_INVALID', '本地代理目录不存在，请先在本地代理页应用版本', proxyRoot)
        }
        files = await scanDirectory(proxyRoot, buildIgnore(null))
        if (files.length === 0) {
          throw new ServiceError('ARTIFACT_EMPTY', '本地代理目录中没有可发布内容', proxyRoot)
        }
        if (files.length > MAX_ZIP_FILES) {
          throw new ServiceError('ARTIFACT_TOO_LARGE', `文件数量超过限制: ${files.length}`)
        }
        if (files.reduce((sum, f) => sum + f.size, 0) > MAX_ZIP_TOTAL_BYTES) {
          throw new ServiceError('ARTIFACT_TOO_LARGE', '本地代理目录总容量超过限制')
        }
        sourceName = '本地代理'
      } else {
        const replacements = await loadReplacements(this.deps.baseDir())
        if (input.type === 'directory') {
          if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
            throw new ServiceError('INPUT_INVALID', '仅支持有效的文件夹', sourcePath)
          }
          const normalized = await normalizeDirectory(sourcePath, tempDir!, replacements)
          files = normalized.files
          replacementStats = normalized.replacements
          sourceName = path.basename(sourcePath) || sourcePath
        } else {
          if (!sourcePath.toLowerCase().endsWith('.zip') || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
            throw new ServiceError('INPUT_INVALID', '仅支持有效的 .zip 文件', sourcePath)
          }
          const normalized = normalizeZip(sourcePath, tempDir!, replacements)
          files = normalized.files
          strippedTopDir = normalized.strippedTopDir
          replacementStats = normalized.replacements
          sourceName = path.basename(sourcePath)
        }
      }
    } catch (err) {
      if (tempDir) removeDir(tempDir)
      throw err
    }
    if (replacementStats.count > 0) {
      this.deps.sendLog?.({
        level: 'debug',
        scope: 'publish',
        message: `替换明细: ${replacementStats.hits.map((hit) => `${hit.path} ×${hit.count}`).join(' · ')}`
      })
    }
    const entry: StagingEntry = {
      releaseId,
      sourceName,
      sourceType: input.type,
      files,
      localRoot: tempDir ?? proxyRoot,
      tempDir,
      strippedTopDir,
      createdAt: Date.now()
    }

    this.expireStaging()
    this.staging.set(releaseId, entry)
    return {
      releaseId,
      sourceName: entry.sourceName,
      sourceType: entry.sourceType,
      files: entry.files,
      totalFiles: entry.files.length,
      totalBytes: entry.files.reduce((sum, f) => sum + f.size, 0),
      strippedTopDir: entry.strippedTopDir,
      replacements: replacementStats
    }
  }

  /** 阶段二：本地不可变归档 → 上传单个 ZIP → 服务端解压替换 → 记录 */
  async execute(releaseId: string): Promise<PublishRecord> {
    this.ensureIdle()
    const entry = this.staging.get(releaseId)
    if (!entry) {
      throw new ServiceError('STAGING_NOT_FOUND', '待发布 ZIP 已失效，请重新选择')
    }
    const config = this.mustConfig()
    assertServerDeployConfig(config)
    const store = this.getStore(config)
    const { record, t0 } = this.makeRecord('publish', config, {
      artifactId: releaseId,
      sourceName: entry.sourceName,
      sourceType: entry.sourceType,
      totalFiles: entry.files.length,
      totalBytes: entry.files.reduce((sum, f) => sum + f.size, 0)
    })
    let tracker = new ProgressTracker(record.id, entry.files, this.deps.sendProgress)

    this.running = true
    try {
      store.insert(record)
      // preparing：本地归档必须在任何远程动作之前完成
      await archiveArtifact({
        releaseId,
        stagingRoot: entry.localRoot,
        files: entry.files.map(({ path: p, size }) => ({ path: p, size })),
        sourceName: entry.sourceName,
        sourceType: entry.sourceType,
        artifactsDir: this.artifactsDir(config)
      })
      const verified = verifyArtifact(this.artifactsDir(config), releaseId)
      const manifest = verified.manifest
      record.totalFiles = manifest.totalFiles
      record.totalBytes = manifest.totalBytes
      tracker = new ProgressTracker(
        record.id,
        [{ path: path.basename(verified.zipPath), size: statSync(verified.zipPath).size }],
        this.deps.sendProgress
      )

      await this.runServerDeploy(record, store, config, verified.zipPath, manifest, tracker, t0)
      return record
    } catch (err) {
      this.failRecord(record, store, err, config, tracker, t0)
      return record
    } finally {
      this.running = false
      this.staging.delete(releaseId)
      if (entry.tempDir) removeDir(entry.tempDir)
    }
  }

  /** 回滚：校验历史 ZIP → 上传单个 ZIP → 服务端解压替换；每次生成新的 rollback 记录 */
  async rollback(artifactId: string): Promise<PublishRecord> {
    this.ensureIdle()
    const config = this.mustConfig()
    assertServerDeployConfig(config)
    const store = this.getStore(config)

    const successful = store.list().some((record) => record.status === 'succeeded' && record.artifactId === artifactId)
    if (!successful) {
      throw new ServiceError('ROLLBACK_TARGET_INVALID', '只能回滚到成功发布过的历史版本')
    }

    // 任何校验失败都发生在远程清理之前
    const { zipPath, manifest } = verifyArtifact(this.artifactsDir(config), artifactId)
    const { record, t0 } = this.makeRecord('rollback', config, {
      artifactId,
      rollbackFromId: artifactId,
      sourceName: manifest.sourceName,
      sourceType: manifest.sourceType,
      totalFiles: manifest.totalFiles,
      totalBytes: manifest.totalBytes
    })
    const tracker = new ProgressTracker(
      record.id,
      [{ path: path.basename(zipPath), size: statSync(zipPath).size }],
      this.deps.sendProgress
    )

    this.running = true
    try {
      store.insert(record)
      await this.runServerDeploy(record, store, config, zipPath, manifest, tracker, t0)
      return record
    } catch (err) {
      this.failRecord(record, store, err, config, tracker, t0)
      return record
    } finally {
      this.running = false
    }
  }

  /** 再次发布：复用失败或中断记录已经生成的归档，重新执行完整发布流程 */
  prepareRepublish(recordId: string): PrepareSummary {
    this.ensureIdle()
    const config = this.mustConfig()
    assertServerDeployConfig(config)
    const store = this.getStore(config)
    const record = store.get(recordId)
    if (!record) throw new ServiceError('RECORD_NOT_FOUND', `发布记录不存在: ${recordId}`)
    if (record.status !== 'failed' && record.status !== 'interrupted') {
      throw new ServiceError('REPUBLISH_STATUS_INVALID', '只有失败或中断记录可以再次发布')
    }
    const { manifest } = verifyArtifact(this.artifactsDir(config), record.artifactId)
    return {
      releaseId: record.artifactId,
      sourceName: archiveDisplayName(manifest.sourceName),
      sourceType: 'zip',
      files: manifest.files,
      totalFiles: manifest.totalFiles,
      totalBytes: manifest.totalBytes,
      replacements: { files: 0, count: 0 }
    }
  }

  async republish(recordId: string): Promise<PublishRecord> {
    this.ensureIdle()
    const config = this.mustConfig()
    assertServerDeployConfig(config)
    const store = this.getStore(config)
    const sourceRecord = store.get(recordId)
    if (!sourceRecord) throw new ServiceError('RECORD_NOT_FOUND', `发布记录不存在: ${recordId}`)
    if (sourceRecord.status !== 'failed' && sourceRecord.status !== 'interrupted') {
      throw new ServiceError('REPUBLISH_STATUS_INVALID', '只有失败或中断记录可以再次发布')
    }

    const { zipPath, manifest } = verifyArtifact(this.artifactsDir(config), sourceRecord.artifactId)
    const t0 = Date.now()
    const record: PublishRecord = {
      ...sourceRecord,
      kind: 'publish',
      sourceName: archiveDisplayName(manifest.sourceName),
      sourceType: 'zip',
      remoteRoot: config.remoteRoot,
      status: 'preparing',
      startedAt: new Date(t0).toISOString(),
      totalFiles: manifest.totalFiles,
      totalBytes: manifest.totalBytes,
      uploadedFiles: 0,
      uploadedBytes: 0
    }
    delete record.rollbackFromId
    delete record.finishedAt
    delete record.durationMs
    delete record.error
    const tracker = new ProgressTracker(
      record.id,
      [{ path: path.basename(zipPath), size: statSync(zipPath).size }],
      this.deps.sendProgress
    )

    this.running = true
    try {
      store.update(record)
      await this.runServerDeploy(record, store, config, zipPath, manifest, tracker, t0)
      return record
    } catch (err) {
      this.failRecord(record, store, err, config, tracker, t0)
      return record
    } finally {
      this.running = false
    }
  }

  getRecords(): PublishRecord[] {
    return this.getStore(this.mustConfig()).list()
  }

  getRecord(id: string): PublishRecord {
    const record = this.getStore(this.mustConfig()).get(id)
    if (!record) throw new ServiceError('RECORD_NOT_FOUND', `发布记录不存在: ${id}`)
    return record
  }

  getVerifiedArtifact(artifactId: string): ReturnType<typeof verifyArtifact> {
    const config = this.mustConfig()
    const store = this.getStore(config)
    const successful = store.list().some((record) => record.status === 'succeeded' && record.artifactId === artifactId)
    if (!successful) {
      throw new ServiceError('ARTIFACT_NOT_PUBLISHED', '只能应用成功发布过的历史版本')
    }
    return verifyArtifact(this.artifactsDir(config), artifactId)
  }

  /** 删除记录：终态记录可删；若该版本归档不再被任何记录引用，连带删除归档目录 */
  deleteRecord(id: string): { id: string; artifactRemoved: boolean } {
    this.ensureIdle()
    const config = this.mustConfig()
    const store = this.getStore(config)

    const record = store.get(id)
    if (!record) throw new ServiceError('RECORD_NOT_FOUND', `发布记录不存在: ${id}`)
    if ((ACTIVE_STATUSES as readonly string[]).includes(record.status)) {
      throw new ServiceError('RECORD_ACTIVE', '进行中的任务记录不能删除')
    }

    const artifactId = record.artifactId
    store.delete(id)

    const stillReferenced = store.list().some((r) => r.artifactId === artifactId)
    let artifactRemoved = false
    if (!stillReferenced) {
      removeDir(path.join(this.artifactsDir(config), artifactId))
      artifactRemoved = true
    }
    return { id, artifactRemoved }
  }

  /** 启动时调用：把遗留的进行中任务标记为 interrupted */
  markStartupInterrupted(): number {
    try {
      return this.getStore(this.mustConfig()).markInterrupted()
    } catch {
      return 0
    }
  }

  dispose(): void {
    for (const entry of this.staging.values()) {
      if (entry.tempDir) removeDir(entry.tempDir)
    }
    this.staging.clear()
  }

  private async runServerDeploy(
    record: PublishRecord,
    store: RecordStore,
    config: ResolvedConfig,
    zipPath: string,
    manifest: ArtifactManifest,
    tracker: ProgressTracker,
    t0: number
  ): Promise<void> {
    const log = (message: string): void => {
      this.deps.sendLog?.({ level: 'info', scope: 'publish', message })
    }
    const client = (this.deps.createClient ?? createFtpClient)()
    try {
      log('[1/6] 校验部署配置')
      log('[2/6] 连接 FTP')
      await connectClient(client, config)
      // 发布前同步 deploy.php + config.php，并把插件远程路径写入 preserve 清单，避免全量替换误删插件
      const pluginPaths = this.deps.getPluginPaths ? await this.deps.getPluginPaths() : []
      log('[3/6] 同步服务端运行文件')
      await uploadDeployRuntime(client, config, deployScriptPath(), undefined, pluginPaths)
      record.status = 'uploading'
      store.update(record)
      const zipName = path.basename(zipPath)
      tracker.onUploadStart({ path: zipName, size: statSync(zipPath).size })
      client.trackProgress((info) => tracker.onBytes(info.bytesOverall, info.bytes))
      log(`[4/6] 上传 ${zipName}`)
      await client.uploadFrom(zipPath, remoteArchivePath(config, manifest.id))
      tracker.onFileDone()
    } finally {
      client.trackProgress(undefined)
      client.close()
    }

    record.status = 'deploying'
    store.update(record)
    tracker.emitDeploying()
    log('[5/6] 调用 DEPLOY_ENDPOINT')
    const result = await triggerServerDeploy(config, manifest.id)
    this.deps.sendLog?.({
      level: 'success',
      scope: 'publish',
      message: `[6/6] PHP 解压并替换站点 · ${result.files} 个 ZIP 条目 · ${result.durationMs}ms`
    })

    tracker.emitSuccess()
    record.status = 'succeeded'
    record.finishedAt = new Date().toISOString()
    record.durationMs = Date.now() - t0
    record.uploadedFiles = manifest.totalFiles
    record.uploadedBytes = manifest.totalBytes
    store.update(record)
  }

  private failRecord(
    record: PublishRecord,
    store: RecordStore,
    err: unknown,
    config: ResolvedConfig,
    tracker: ProgressTracker,
    t0: number
  ): void {
    const appError = toAppError(err)
    record.status = 'failed'
    record.finishedAt = new Date().toISOString()
    record.durationMs = Date.now() - t0
    record.error = {
      code: appError.code,
      message: scrubSecrets(appError.message, config.password),
      detail: appError.detail ? scrubSecrets(appError.detail, config.password) : undefined
    }
    const snapshot = tracker.snapshot()
    record.uploadedFiles = snapshot.uploadedFiles
    record.uploadedBytes = snapshot.uploadedBytes
    store.update(record)
  }

  private makeRecord(
    kind: PublishKind,
    config: ResolvedConfig,
    info: {
      artifactId: string
      rollbackFromId?: string
      sourceName: string
      sourceType: SourceType
      totalFiles: number
      totalBytes: number
    }
  ): { record: PublishRecord; t0: number } {
    const t0 = Date.now()
    return {
      t0,
      record: {
        id: makeId('rec'),
        kind,
        artifactId: info.artifactId,
        rollbackFromId: info.rollbackFromId,
        sourceName: info.sourceName,
        sourceType: info.sourceType,
        remoteRoot: config.remoteRoot,
        status: 'preparing',
        startedAt: new Date(t0).toISOString(),
        totalFiles: info.totalFiles,
        totalBytes: info.totalBytes,
        uploadedFiles: 0,
        uploadedBytes: 0
      }
    }
  }

  private expireStaging(): void {
    const now = Date.now()
    for (const [releaseId, entry] of this.staging) {
      if (now - entry.createdAt > STAGING_TTL_MS) {
        if (entry.tempDir) removeDir(entry.tempDir)
        this.staging.delete(releaseId)
      }
    }
  }
}
