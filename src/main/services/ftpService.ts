import { Client } from 'basic-ftp'
import { renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ResolvedConfig } from './envService'
import type {
  RemoteDeleteResult,
  RemoteDirectoryListing,
  RemoteDownloadResult,
  RemoteEntryType,
  RemoteUploadResult
} from '@shared/types'
import { scrubSecrets } from './envService'
import { ServiceError } from './errors'

/** basic-ftp 客户端的最小结构接口，测试以普通对象 mock */
export interface FtpListEntry {
  name: string
  isDirectory: boolean
  isSymbolicLink: boolean
  size?: number
  modifiedAt?: Date
}

export interface FtpProgressInfo {
  name: string
  type: string
  bytes: number
  bytesOverall: number
}

export interface FtpClientLike {
  access(options: unknown): Promise<unknown>
  cd(remotePath: string): Promise<unknown>
  list(remotePath?: string): Promise<FtpListEntry[]>
  removeDir(remotePath: string): Promise<unknown>
  remove(remotePath: string): Promise<unknown>
  ensureDir(remotePath: string): Promise<unknown>
  uploadFrom(localPath: string, remotePath: string): Promise<unknown>
  downloadTo(localPath: string, remotePath: string): Promise<unknown>
  trackProgress(tracker?: (info: FtpProgressInfo) => void): void
  close(): void
}

export function createFtpClient(): FtpClientLike {
  return new Client(30000)
}

function errorDetail(err: unknown, config: ResolvedConfig): string {
  const text = err instanceof Error ? err.message : String(err)
  return scrubSecrets(text, config.password)
}

/** 建立 FTP / 显式 FTPS 连接；禁止任何形式的自动降级 */
export async function connectClient(client: FtpClientLike, config: ResolvedConfig): Promise<void> {
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      secure: config.secure,
      secureOptions: config.tlsRejectUnauthorized ? undefined : { rejectUnauthorized: false }
    })
  } catch (err) {
    throw new ServiceError(
      'FTP_CONNECT_FAILED',
      `连接 FTP 服务器失败 (${config.secure ? 'FTPS' : 'FTP'} ${config.host}:${config.port})`,
      errorDetail(err, config)
    )
  }
}

/** 测试连接：连接成功后还需能进入固定远程根目录 */
export async function testConnection(client: FtpClientLike, config: ResolvedConfig): Promise<number> {
  const started = Date.now()
  await connectClient(client, config)
  try {
    await client.cd(config.remoteRoot)
  } catch (err) {
    throw new ServiceError(
      'FTP_REMOTE_ROOT_UNREACHABLE',
      `无法进入远程根目录 ${config.remoteRoot}`,
      errorDetail(err, config)
    )
  }
  return Date.now() - started
}

export function joinPosix(root: string, rel: string): string {
  return root.endsWith('/') ? `${root}${rel}` : `${root}/${rel}`
}

export function resolveRemotePath(remoteRoot: string, relativePath = ''): string {
  const root = path.posix.normalize(remoteRoot)
  const relative = relativePath.trim().replace(/\\/g, '/')
  if (relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new ServiceError('FTP_PATH_INVALID', '远程相对路径非法')
  }
  const target = path.posix.normalize(joinPosix(root, relative))
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new ServiceError('FTP_PATH_INVALID', '远程路径超出固定根目录')
  }
  return target
}

export async function listRemoteDirectory(
  client: FtpClientLike,
  config: ResolvedConfig,
  relativePath = ''
): Promise<RemoteDirectoryListing> {
  const normalizedRelative = relativePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const remotePath = resolveRemotePath(config.remoteRoot, normalizedRelative)
  try {
    await connectClient(client, config)
    const entries = await client.list(remotePath)
    return {
      relativePath: normalizedRelative,
      remotePath,
      entries: entries
        .map((entry) => {
          const type: RemoteEntryType = entry.isSymbolicLink
            ? 'link'
            : entry.isDirectory
              ? 'directory'
              : 'file'
          return {
            name: entry.name,
            path: normalizedRelative ? `${normalizedRelative}/${entry.name}` : entry.name,
            type,
            size: entry.size ?? 0,
            modifiedAt: entry.modifiedAt?.toISOString()
          }
        })
        .sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1
          if (a.type !== 'directory' && b.type === 'directory') return 1
          return a.name.localeCompare(b.name)
        })
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError('FTP_LIST_FAILED', `读取远程目录失败: ${remotePath}`, errorDetail(err, config))
  }
}

export async function deleteRemoteEntry(
  client: FtpClientLike,
  config: ResolvedConfig,
  relativePath: string
): Promise<RemoteDeleteResult> {
  const relative = relativePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!relative) throw new ServiceError('FTP_DELETE_ROOT_FORBIDDEN', '禁止删除远程根目录')
  const target = resolveRemotePath(config.remoteRoot, relative)
  const parentRelative = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative)
  const parent = resolveRemotePath(config.remoteRoot, parentRelative)
  const name = path.posix.basename(relative)

  try {
    await connectClient(client, config)
    const entry = (await client.list(parent)).find((item) => item.name === name)
    if (!entry) throw new ServiceError('FTP_ENTRY_NOT_FOUND', `远程文件不存在: ${relative}`)

    const type: RemoteEntryType = entry.isSymbolicLink ? 'link' : entry.isDirectory ? 'directory' : 'file'
    if (type === 'directory') await client.removeDir(target)
    else await client.remove(target)
    return { path: relative, type }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError('FTP_DELETE_FAILED', `删除远程内容失败: ${relative}`, errorDetail(err, config))
  }
}

export async function downloadRemoteFile(
  client: FtpClientLike,
  config: ResolvedConfig,
  relativePath: string,
  localPath: string
): Promise<RemoteDownloadResult> {
  const relative = relativePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!relative) throw new ServiceError('FTP_DOWNLOAD_INVALID', '请选择要下载的远程文件')
  const target = resolveRemotePath(config.remoteRoot, relative)
  const parentRelative = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative)
  const parent = resolveRemotePath(config.remoteRoot, parentRelative)
  const name = path.posix.basename(relative)
  const tempPath = `${localPath}.ftppublisher-part`

  try {
    await connectClient(client, config)
    const entry = (await client.list(parent)).find((item) => item.name === name)
    if (!entry) throw new ServiceError('FTP_ENTRY_NOT_FOUND', `远程文件不存在: ${relative}`)
    if (entry.isDirectory) throw new ServiceError('FTP_DOWNLOAD_DIRECTORY_UNSUPPORTED', '暂不支持下载整个目录')

    rmSync(tempPath, { force: true })
    await client.downloadTo(tempPath, target)
    rmSync(localPath, { force: true })
    renameSync(tempPath, localPath)
    return { path: relative, localPath, size: entry.size ?? 0 }
  } catch (err) {
    rmSync(tempPath, { force: true })
    if (err instanceof ServiceError) throw err
    throw new ServiceError('FTP_DOWNLOAD_FAILED', `下载远程文件失败: ${relative}`, errorDetail(err, config))
  }
}

export async function uploadRemoteFiles(
  client: FtpClientLike,
  config: ResolvedConfig,
  relativeDirectory: string,
  localPaths: string[]
): Promise<RemoteUploadResult> {
  const relative = relativeDirectory.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const remoteDirectory = resolveRemotePath(config.remoteRoot, relative)
  const files = localPaths.map((localPath) => {
    const stat = statSync(localPath)
    if (!stat.isFile()) throw new ServiceError('FTP_UPLOAD_INPUT_INVALID', `本地路径不是文件: ${localPath}`)
    return { localPath, name: path.basename(localPath), size: stat.size }
  })
  if (files.length === 0) throw new ServiceError('FTP_UPLOAD_INPUT_INVALID', '未选择上传文件')

  try {
    await connectClient(client, config)
    await client.cd(remoteDirectory)
    for (const file of files) {
      await client.uploadFrom(file.localPath, joinPosix(remoteDirectory, file.name))
    }
    return {
      remoteDirectory,
      uploadedFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0)
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError('FTP_UPLOAD_FILES_FAILED', `上传文件到远程目录失败: ${remoteDirectory}`, errorDetail(err, config))
  }
}

/**
 * 清空 FTP_REMOTE_ROOT 内部全部内容，保留根目录本身。
 * 删除目标一律基于 remoteRoot 拼接，绝不删除根目录。
 */
export type ClearLogSink = (level: 'info' | 'success' | 'error', message: string) => void

export async function clearRemoteRoot(
  client: FtpClientLike,
  remoteRoot: string,
  log?: ClearLogSink
): Promise<number> {
  let currentTarget = ''
  let currentType = ''
  try {
    log?.('info', `正在读取远程目录 ${remoteRoot}`)
    await client.cd(remoteRoot)
    const entries = await client.list()
    log?.('info', `远程目录共有 ${entries.length} 项，开始清理`)
    let removed = 0
    let lastLoggedAt = 0
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]
      const target = joinPosix(remoteRoot, entry.name)
      currentTarget = target
      currentType = entry.isDirectory ? '目录' : '文件'
      const now = Date.now()
      if (index === 0 || entry.isDirectory || now - lastLoggedAt >= 1000) {
        log?.('info', `[${index + 1}/${entries.length}] 正在删除${currentType} ${target}`)
        lastLoggedAt = now
      }
      if (entry.isDirectory) {
        await client.removeDir(target)
      } else {
        await client.remove(target)
      }
      removed += 1
    }
    log?.('success', `远程目录清理完成，共删除 ${removed} 项`)
    return removed
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log?.('error', currentTarget ? `清理失败，停在${currentType} ${currentTarget}：${detail}` : `清理失败：${detail}`)
    throw new ServiceError(
      'FTP_CLEAR_FAILED',
      `清空远程目录失败: ${remoteRoot}`,
      currentTarget ? `${detail}；当前项: ${currentTarget}` : detail
    )
  }
}

export interface UploadOptions {
  localRoot: string
  remoteRoot: string
  files: { path: string; size: number }[]
  onFileStart?: (file: { path: string; size: number }) => void
  onFileDone?: (file: { path: string; size: number }) => void
}

/** 按清单串行上传，逐文件创建目录；任意失败立即抛出，不做重试 */
export async function uploadFiles(client: FtpClientLike, options: UploadOptions): Promise<void> {
  const { localRoot, remoteRoot, files, onFileStart, onFileDone } = options
  try {
    for (const file of files) {
      const local = path.join(localRoot, file.path)
      const remote = joinPosix(remoteRoot, file.path)
      onFileStart?.(file)
      await client.ensureDir(path.posix.dirname(remote))
      await client.uploadFrom(local, remote)
      onFileDone?.(file)
    }
  } catch (err) {
    throw new ServiceError(
      'FTP_UPLOAD_FAILED',
      '上传失败，任务已停止',
      err instanceof Error ? err.message : String(err)
    )
  }
}
