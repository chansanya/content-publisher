import Store from 'electron-store'
import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  OperationLogEvent,
  PluginCreateResult,
  PluginDeleteResult,
  PluginListResult,
  PluginProgress,
  PluginPushResult,
  PluginSummary
} from '@shared/types'
import { pluginRootPath } from '../appPaths'
import { loadEnvConfig, type ResolvedConfig } from './envService'
import { ServiceError } from './errors'
import { connectClient, createFtpClient, joinPosix, resolveRemotePath } from './ftpService'
import type { FtpClientLike } from './ftpService'
import { ProgressTracker } from './progressTracker'

export interface PluginMappingStore {
  get(): Record<string, string>
  set(name: string, remotePath: string): void
  delete(name: string): void
}

export class ElectronPluginMappingStore implements PluginMappingStore {
  private readonly store: Store<{ mappings: Record<string, string> }>

  constructor(settingsDir: string) {
    this.store = new Store<{ mappings: Record<string, string> }>({
      name: 'plugin-mappings',
      cwd: settingsDir,
      defaults: { mappings: {} }
    })
  }

  get(): Record<string, string> {
    return { ...this.store.get('mappings') }
  }

  set(name: string, remotePath: string): void {
    this.store.set('mappings', { ...this.store.get('mappings'), [name]: remotePath })
  }

  delete(name: string): void {
    const mappings = { ...this.store.get('mappings') }
    delete mappings[name]
    this.store.set('mappings', mappings)
  }
}

export interface PluginServiceDeps {
  baseDir: () => string
  mappingStore?: PluginMappingStore
  sendProgress: (progress: PluginProgress) => void
  sendLog: (event: OperationLogEvent) => void
  createClient?: () => FtpClientLike
}

interface PluginFile {
  path: string
  size: number
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function normalizePluginName(raw: string): string {
  const name = raw.trim()
  if (!name || name.startsWith('.') || /\r|\n/.test(name) || name.includes('/') || name.includes('\\')) {
    throw new ServiceError('PLUGIN_NAME_INVALID', '插件名称非法')
  }
  return name
}

/** 存储为相对 FTP_REMOTE_ROOT 的 POSIX 路径，输入可带开头或结尾斜杠。 */
export function normalizePluginRemotePath(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts = value.split('/')
  if (!value || /^[A-Za-z]:/.test(value) || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new ServiceError('PLUGIN_MAPPING_INVALID', '插件远程路径必须是安全的相对路径')
  }
  return parts.join('/')
}

export function pluginPathsIntersect(first: string, second: string): boolean {
  const a = first.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  const b = second.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function isPluginPathProtected(relativePath: string, preservePaths: readonly string[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  return preservePaths.some((preserved) => pluginPathsIntersect(normalized, preserved))
}

async function scanFiles(pluginDir: string): Promise<PluginFile[]> {
  const root = path.resolve(pluginDir)
  const files: PluginFile[] = []

  const walk = async (dir: string, relativeDir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new ServiceError('PLUGIN_SYMLINK_UNSUPPORTED', `插件包含不支持的符号链接: ${entry.name}`)
      }
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const fullPath = path.resolve(dir, entry.name)
      if (!isInside(root, fullPath)) {
        throw new ServiceError('PLUGIN_PATH_INVALID', `插件路径超出目录范围: ${relativePath}`)
      }
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath)
        files.push({ path: toPosix(relativePath), size: fileStat.size })
      }
    }
  }

  await walk(root, '')
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return files
}

function mustConfig(baseDir: string): ResolvedConfig {
  const result = loadEnvConfig(baseDir)
  if (!result.ok) throw new ServiceError(result.error.code, result.error.message, result.error.detail)
  return result.data
}

export class PluginService {
  private busy = false
  private readonly mappings: PluginMappingStore

  constructor(private readonly deps: PluginServiceDeps) {
    this.mappings = deps.mappingStore ?? new MemoryPluginMappingStore()
  }

  getRootDir(): string {
    return pluginRootPath(this.deps.baseDir())
  }

  private async readPluginNames(): Promise<string[]> {
    const rootDir = this.getRootDir()
    await mkdir(rootDir, { recursive: true })
    const names: string[] = []
    for (const entry of await readdir(rootDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) names.push(entry.name)
    }
    return names.sort((a, b) => a.localeCompare(b))
  }

  private async allPluginNames(): Promise<string[]> {
    const names = new Set(await this.readPluginNames())
    for (const name of Object.keys(this.mappings.get())) {
      try {
        if (!name.startsWith('.')) names.add(normalizePluginName(name))
      } catch {
        // 忽略损坏的历史映射
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }

  private mappingFor(name: string): { remotePath: string } {
    const raw = this.mappings.get()[name]
    if (!raw) return { remotePath: name }
    try {
      const remotePath = normalizePluginRemotePath(raw)
      return { remotePath }
    } catch {
      return { remotePath: name }
    }
  }

  private async summary(name: string): Promise<PluginSummary> {
    const pluginDir = path.join(this.getRootDir(), name)
    const localStat = await lstat(pluginDir).catch(() => null)
    const localExists = Boolean(localStat?.isDirectory())
    const files = localExists ? await scanFiles(pluginDir) : []
    const mapping = this.mappingFor(name)
    return {
      name,
      remotePath: mapping.remotePath,
      localExists,
      totalFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0)
    }
  }

  async list(): Promise<PluginListResult> {
    const rootDir = this.getRootDir()
    const names = await this.allPluginNames()
    const plugins: PluginSummary[] = []
    for (const name of names) {
      const item = await this.summary(name)
      plugins.push(item)
    }
    return { rootDir, plugins }
  }

  async create(rawName: string): Promise<PluginCreateResult> {
    if (this.busy) throw new ServiceError('PLUGIN_BUSY', '已有插件操作正在进行，请稍候')
    const name = normalizePluginName(rawName)
    const rootDir = this.getRootDir()
    await mkdir(rootDir, { recursive: true })
    const localPath = path.join(rootDir, name)
    const existing = await lstat(localPath).catch(() => null)
    if (existing) throw new ServiceError('PLUGIN_EXISTS', `插件目录已存在: ${name}`)
    try {
      await mkdir(localPath)
    } catch (err) {
      throw new ServiceError('PLUGIN_CREATE_FAILED', `创建插件目录失败: ${name}`, err instanceof Error ? err.message : String(err))
    }
    return { name, localPath, remotePath: this.mappingFor(name).remotePath }
  }

  /** 返回本地插件及历史映射的有效远程路径，空目录或本地缺失的映射也会被保护。 */
  async getPluginPaths(): Promise<string[]> {
    const names = await this.allPluginNames()
    return [...new Set(names.map((name) => this.mappingFor(name).remotePath))]
  }

  async saveMapping(rawName: string, rawRemotePath: string): Promise<PluginSummary> {
    const name = normalizePluginName(rawName)
    const names = await this.allPluginNames()
    if (!names.includes(name)) throw new ServiceError('PLUGIN_NOT_FOUND', `插件目录不存在: ${name}`)
    const remotePath = normalizePluginRemotePath(rawRemotePath)
    for (const otherName of names) {
      if (otherName === name) continue
      const otherPath = this.mappingFor(otherName).remotePath
      if (pluginPathsIntersect(remotePath, otherPath)) {
        throw new ServiceError('PLUGIN_MAPPING_CONFLICT', `插件远程路径与 ${otherName} 冲突: ${remotePath}`)
      }
    }
    if (remotePath === name) this.mappings.delete(name)
    else this.mappings.set(name, remotePath)
    return this.summary(name)
  }

  private async uploadPlugin(
    client: FtpClientLike,
    config: ResolvedConfig,
    name: string,
    remotePath: string,
    files: PluginFile[],
    log: (level: OperationLogEvent['level'], message: string) => void
  ): Promise<PluginPushResult> {
    const pluginDir = path.resolve(this.getRootDir(), name)
    const remoteDirectory = resolveRemotePath(config.remoteRoot, remotePath)
    const tracker = new ProgressTracker(`plugin:${name}`, files, (progress) => {
      this.deps.sendProgress({ ...progress, pluginName: name })
    })
    client.trackProgress((info) => tracker.onBytes(info.bytesOverall, info.bytes))
    try {
      log('info', `开始同步插件 ${name} 到 ${remoteDirectory}`)
      for (const file of files) {
        const localPath = path.join(pluginDir, ...file.path.split('/'))
        const remoteFile = joinPosix(remoteDirectory, file.path)
        tracker.onUploadStart(file)
        await client.ensureDir(path.posix.dirname(remoteFile))
        await client.uploadFrom(localPath, remoteFile)
        tracker.onFileDone()
      }
      tracker.emitSuccess()
      log('success', `插件 ${name} 推送完成 · ${files.length} 个文件`)
      return {
        name,
        remoteDirectory,
        uploadedFiles: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0)
      }
    } finally {
      client.trackProgress(undefined)
    }
  }

  async push(rawName: string): Promise<PluginPushResult> {
    if (this.busy) throw new ServiceError('PLUGIN_BUSY', '已有插件推送正在进行，请等待其完成')
    const name = normalizePluginName(rawName)
    const rootDir = path.resolve(this.getRootDir())
    const pluginDir = path.resolve(rootDir, name)
    if (!isInside(rootDir, pluginDir)) throw new ServiceError('PLUGIN_PATH_INVALID', '插件路径超出插件目录范围')

    const pluginStat = await lstat(pluginDir).catch(() => null)
    if (!pluginStat?.isDirectory()) throw new ServiceError('PLUGIN_NOT_FOUND', `插件目录不存在: ${name}`)
    const files = await scanFiles(pluginDir)
    if (files.length === 0) throw new ServiceError('PLUGIN_EMPTY', `插件目录为空: ${name}`)

    const config = mustConfig(this.deps.baseDir())
    const remotePath = this.mappingFor(name).remotePath
    const client = (this.deps.createClient ?? createFtpClient)()
    const log = (level: OperationLogEvent['level'], message: string): void => {
      this.deps.sendLog({ level, scope: 'plugin', message })
    }
    this.busy = true
    try {
      log('info', `[1/4] 准备插件 ${name} · ${files.length} 个文件`)
      log('info', '[2/4] 连接 FTP')
      await connectClient(client, config)
      return await this.uploadPlugin(client, config, name, remotePath, files, log)
    } catch (err) {
      log('error', `插件 ${name} 推送失败: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    } finally {
      client.trackProgress(undefined)
      client.close()
      this.busy = false
    }
  }

  async deleteRemote(rawName: string): Promise<PluginDeleteResult> {
    if (this.busy) throw new ServiceError('PLUGIN_BUSY', '已有插件操作正在进行，请等待其完成')
    const name = normalizePluginName(rawName)
    const names = await this.allPluginNames()
    if (!names.includes(name)) throw new ServiceError('PLUGIN_NOT_FOUND', `插件目录不存在: ${name}`)
    const remotePath = this.mappingFor(name).remotePath
    const otherPaths = names.filter((item) => item !== name).map((item) => this.mappingFor(item).remotePath)
    if (otherPaths.some((item) => pluginPathsIntersect(remotePath, item))) {
      throw new ServiceError('PLUGIN_MAPPING_CONFLICT', '该插件路径包含其他插件映射，不能单独删除')
    }
    const config = mustConfig(this.deps.baseDir())
    const remoteDirectory = resolveRemotePath(config.remoteRoot, remotePath)
    const client = (this.deps.createClient ?? createFtpClient)()
    const log = (level: OperationLogEvent['level'], message: string): void => {
      this.deps.sendLog({ level, scope: 'plugin', message })
    }
    this.busy = true
    try {
      log('info', `连接 FTP，准备删除插件远程目录 ${remoteDirectory}`)
      await connectClient(client, config)
      const parent = path.posix.dirname(remoteDirectory)
      const targetName = path.posix.basename(remoteDirectory)
      let entries: Awaited<ReturnType<FtpClientLike['list']>>
      try {
        entries = await client.list(parent)
      } catch (err) {
        const code = Number((err as { code?: unknown }).code)
        const message = err instanceof Error ? err.message : String(err)
        if (code !== 550 && !/^550\b/.test(message)) throw err
        entries = []
      }
      const entry = entries.find((item) => item.name === targetName)
      if (!entry) {
        const pluginRoot = path.resolve(this.getRootDir())
        const localPath = path.resolve(pluginRoot, name)
        if (!isInside(pluginRoot, localPath) || localPath === pluginRoot) {
          throw new ServiceError('PLUGIN_PATH_INVALID', '本地插件路径超出插件目录范围')
        }
        const localEntry = await lstat(localPath).catch(() => null)
        if (localEntry) await rm(localPath, { recursive: true, force: true })
        const mappingRemoved = Object.prototype.hasOwnProperty.call(this.mappings.get(), name)
        this.mappings.delete(name)
        log('success', `远程插件不存在，已删除本地插件${mappingRemoved ? '及映射' : ''}: ${localPath}`)
        return { name, remoteDirectory, existed: false, localRemoved: localEntry !== null, mappingRemoved }
      }
      if (entry.isDirectory) await client.removeDir(remoteDirectory)
      else await client.remove(remoteDirectory)
      log('success', `插件远程目录已删除: ${remoteDirectory}`)
      return { name, remoteDirectory, existed: true, localRemoved: false, mappingRemoved: false }
    } finally {
      client.close()
      this.busy = false
    }
  }

  /** 在已建立的 FTP 连接上同步全部插件，供“同步运行文件”使用。 */
  async syncAll(client: FtpClientLike, config: ResolvedConfig): Promise<PluginPushResult[]> {
    if (this.busy) throw new ServiceError('PLUGIN_BUSY', '已有插件操作正在进行，请等待其完成')
    this.busy = true
    const log = (level: OperationLogEvent['level'], message: string): void => {
      this.deps.sendLog({ level, scope: 'plugin', message })
    }
    try {
      const names = await this.readPluginNames()
      const results: PluginPushResult[] = []
      for (const name of names) {
        const files = await scanFiles(path.join(this.getRootDir(), name))
        if (files.length === 0) continue
        results.push(await this.uploadPlugin(client, config, name, this.mappingFor(name).remotePath, files, log))
      }
      return results
    } finally {
      client.trackProgress(undefined)
      this.busy = false
    }
  }
}

class MemoryPluginMappingStore implements PluginMappingStore {
  private mappings: Record<string, string> = {}

  get(): Record<string, string> {
    return { ...this.mappings }
  }

  set(name: string, remotePath: string): void {
    this.mappings = { ...this.mappings, [name]: remotePath }
  }

  delete(name: string): void {
    const next = { ...this.mappings }
    delete next[name]
    this.mappings = next
  }
}
