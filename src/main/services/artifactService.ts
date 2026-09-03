import AdmZip from 'adm-zip'
import archiver from 'archiver'
import ignoreFactory from 'ignore'
import type { Ignore } from 'ignore'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'
import {
  ARTIFACT_ZIP_NAME,
  DEFAULT_IGNORE_RULES,
  MANIFEST_JSON_NAME,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_FILES,
  MAX_ZIP_TOTAL_BYTES
} from '@shared/constants'
import type { ArtifactManifest, ManifestFile, ReplacementConfig, SourceType } from '@shared/types'
import { ServiceError } from './errors'
import type { ReplacementStats } from './replacementService'
import { applyReplacements, isTextPath } from './replacementService'

export function createReleaseId(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `rel_${stamp}_${Math.random().toString(36).slice(2, 6)}`
}

export function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'ftppub-'))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/** 默认忽略规则 + 用户 .ftpignore 内容 */
export function buildIgnore(userRules: string | null): Ignore {
  const ig = ignoreFactory().add([...DEFAULT_IGNORE_RULES])
  if (userRules) ig.add(userRules)
  return ig
}

/** 递归扫描目录，返回过滤后的 POSIX 相对路径清单（跳过符号链接防循环）；异步 IO 不阻塞主进程事件循环 */
export async function scanDirectory(root: string, ig: Ignore): Promise<ManifestFile[]> {
  const out: ManifestFile[] = []

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (ig.ignores(`${relPath}/`)) continue
        await walk(path.join(dir, entry.name), relPath)
      } else if (entry.isFile()) {
        if (ig.ignores(relPath)) continue
        const st = await stat(path.join(dir, entry.name))
        out.push({ path: relPath, size: st.size, mtime: st.mtimeMs })
      }
    }
  }

  await walk(root, '')
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

/** 文件夹输入：读取文件夹内 .ftpignore（可选）后扫描 */
export async function collectFromDirectory(dir: string): Promise<ManifestFile[]> {
  const ignoreFile = path.join(dir, '.ftpignore')
  let userRules: string | null = null
  try {
    userRules = await readFile(ignoreFile, 'utf-8')
  } catch {
    // .ftpignore 是可选文件
  }
  return scanDirectory(dir, buildIgnore(userRules))
}

/** ZIP 路径安全校验：拒绝绝对路径、盘符、空字节与 `..` 越界（Zip Slip） */
export function isUnsafeZipPath(rawName: string): boolean {
  const name = rawName.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.includes('\0')) return true
  return name.split('/').some((part) => part === '..')
}

/**
 * ZIP 输入规范化：校验安全 → 剥离唯一顶级目录 → 安全解压到 targetDir。
 * 文本文件按替换规则改写内容；返回剥离后的相对路径清单与替换统计。
 */
export function normalizeZip(
  zipPath: string,
  targetDir: string,
  replacements?: ReplacementConfig | null
): { files: ManifestFile[]; strippedTopDir?: string; replacements: ReplacementStats } {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new ServiceError('ARTIFACT_ZIP_CORRUPT', 'ZIP 文件损坏或无法读取', zipPath)
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  if (entries.length === 0) {
    throw new ServiceError('ARTIFACT_EMPTY', 'ZIP 中没有任何可发布文件', zipPath)
  }
  if (entries.length > MAX_ZIP_FILES) {
    throw new ServiceError('ARTIFACT_ZIP_TOO_LARGE', `ZIP 文件数量超过限制: ${entries.length}`)
  }
  let totalBytes = 0
  const names = new Set<string>()
  for (const entry of entries) {
    if (isUnsafeZipPath(entry.entryName)) {
      throw new ServiceError('ARTIFACT_ZIP_UNSAFE', `ZIP 包含不安全路径，已拒绝`, entry.entryName)
    }
    if (entry.header.size > MAX_ZIP_ENTRY_BYTES) {
      throw new ServiceError('ARTIFACT_ZIP_TOO_LARGE', 'ZIP 包含过大的单个文件', entry.entryName)
    }
    totalBytes += entry.header.size
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new ServiceError('ARTIFACT_ZIP_TOO_LARGE', 'ZIP 解压后总容量超过限制')
    }
    const key = entry.entryName.replace(/\\/g, '/').toLowerCase()
    if (names.has(key)) {
      throw new ServiceError('ARTIFACT_ZIP_DUPLICATE', 'ZIP 包含重名文件', entry.entryName)
    }
    names.add(key)
  }

  // 唯一顶级目录剥离：所有文件都位于同名首段目录之下
  const firstSegment = (p: string): string | null => {
    const idx = p.indexOf('/')
    return idx === -1 ? null : p.slice(0, idx)
  }
  const tops = entries.map((e) => firstSegment(e.entryName))
  const strippedTopDir = tops.every((t) => t !== null && t === tops[0]) ? (tops[0] as string) : undefined

  mkdirSync(targetDir, { recursive: true })
  const stats: ReplacementStats = { files: 0, count: 0, hits: [] }
  const files: ManifestFile[] = entries.map((entry) => {
    const relPath = strippedTopDir ? entry.entryName.slice(strippedTopDir.length + 1) : entry.entryName
    const outPath = path.join(targetDir, relPath)
    mkdirSync(path.dirname(outPath), { recursive: true })
    let data = entry.getData()
    if (replacements && isTextPath(relPath)) {
      const result = applyReplacements(relPath, data, replacements)
      data = result.content
      if (result.count > 0) {
        stats.files += 1
        stats.count += result.count
        stats.hits.push({ path: relPath, count: result.count })
      }
    }
    writeFileSync(outPath, data)
    return { path: relPath, size: data.length, mtime: entry.header.time.getTime() }
  })

  return { files, strippedTopDir, replacements: stats }
}

/**
 * 文件夹输入规范化：扫描（支持 .ftpignore）→ 数量/容量限制 → 复制到 targetDir 形成内容快照。
 * 选中文件夹即发布边界，不做顶级目录剥离；文本文件按替换规则改写内容。
 */
export async function normalizeDirectory(
  sourceDir: string,
  targetDir: string,
  replacements?: ReplacementConfig | null
): Promise<{ files: ManifestFile[]; replacements: ReplacementStats }> {
  const files = await collectFromDirectory(sourceDir)
  if (files.length === 0) {
    throw new ServiceError('ARTIFACT_EMPTY', '文件夹中没有可发布文件', sourceDir)
  }
  if (files.length > MAX_ZIP_FILES) {
    throw new ServiceError('ARTIFACT_TOO_LARGE', `文件数量超过限制: ${files.length}`)
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
    throw new ServiceError('ARTIFACT_TOO_LARGE', '文件夹总容量超过限制')
  }
  await mkdir(targetDir, { recursive: true })
  const stats: ReplacementStats = { files: 0, count: 0, hits: [] }
  const finalFiles: ManifestFile[] = []
  for (const file of files) {
    const outPath = path.join(targetDir, file.path)
    await mkdir(path.dirname(outPath), { recursive: true })
    const source = path.join(sourceDir, file.path)
    if (replacements && isTextPath(file.path)) {
      const result = applyReplacements(file.path, await readFile(source), replacements)
      await writeFile(outPath, result.content)
      if (result.count > 0) {
        stats.files += 1
        stats.count += result.count
        stats.hits.push({ path: file.path, count: result.count })
        finalFiles.push({ ...file, size: result.content.length })
        continue
      }
    } else {
      await copyFile(source, outPath)
    }
    finalFiles.push(file)
  }
  return { files: finalFiles, replacements: stats }
}

export interface ArchiveParams {
  releaseId: string
  stagingRoot: string
  files: { path: string; size: number }[]
  sourceName: string
  sourceType: SourceType
  artifactsDir: string
}

/** 生成不可变本地版本：artifacts/<releaseId>/{artifact.zip, manifest.json}，先写临时名再原子重命名 */
export async function archiveArtifact(params: ArchiveParams): Promise<ArtifactManifest> {
  const { releaseId, stagingRoot, files, sourceName, sourceType, artifactsDir } = params
  const releaseDir = path.join(artifactsDir, releaseId)
  mkdirSync(releaseDir, { recursive: true })

  const zipPath = path.join(releaseDir, ARTIFACT_ZIP_NAME)
  const tmpPath = `${zipPath}.tmp`
  const output = createWriteStream(tmpPath)
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.pipe(output)
  for (const file of files) {
    archive.file(path.join(stagingRoot, file.path), { name: file.path })
  }
  try {
    await archive.finalize()
    await finished(output)
  } catch (err) {
    removeDir(releaseDir)
    throw new ServiceError('ARTIFACT_ARCHIVE_FAILED', '生成本地版本 artifact.zip 失败', err instanceof Error ? err.message : String(err))
  }
  renameSync(tmpPath, zipPath)

  const manifest: ArtifactManifest = {
    id: releaseId,
    createdAt: new Date().toISOString(),
    sourceName,
    sourceType,
    files,
    totalFiles: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0)
  }
  writeFileSync(path.join(releaseDir, MANIFEST_JSON_NAME), JSON.stringify(manifest, null, 2), 'utf-8')
  return manifest
}

export function artifactDirOf(artifactsDir: string, releaseId: string): string {
  const base = path.resolve(artifactsDir)
  const target = path.resolve(base, releaseId)
  if (target === base || !target.startsWith(`${base}${path.sep}`)) {
    throw new ServiceError('ARTIFACT_ID_INVALID', `版本 ID 非法: ${releaseId}`)
  }
  return target
}

export function readArtifactManifest(artifactsDir: string, releaseId: string): ArtifactManifest {
  const manifestPath = path.join(artifactDirOf(artifactsDir, releaseId), MANIFEST_JSON_NAME)
  if (!existsSync(manifestPath)) {
    throw new ServiceError('ARTIFACT_MANIFEST_MISSING', `版本清单不存在: ${releaseId}`, manifestPath)
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ArtifactManifest
  } catch {
    throw new ServiceError('ARTIFACT_MANIFEST_INVALID', `版本清单损坏: ${releaseId}`, manifestPath)
  }
}

/**
 * 回滚前校验：artifact.zip 与 manifest.json 齐全、ZIP 可读且条目与清单一致。
 * 校验失败必须发生在任何远程清理之前。
 */
export function verifyArtifact(artifactsDir: string, releaseId: string): { zipPath: string; manifest: ArtifactManifest } {
  const zipPath = path.join(artifactDirOf(artifactsDir, releaseId), ARTIFACT_ZIP_NAME)
  if (!existsSync(zipPath)) {
    throw new ServiceError('ARTIFACT_MISSING', `本地版本已缺失: ${releaseId}`, zipPath)
  }
  const manifest = readArtifactManifest(artifactsDir, releaseId)

  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new ServiceError('ARTIFACT_ZIP_CORRUPT', `本地版本已损坏: ${releaseId}`, zipPath)
  }

  const zipFiles = new Map(zip.getEntries().filter((e) => !e.isDirectory).map((e) => [e.entryName, e.header.size]))
  if (zipFiles.size !== manifest.files.length) {
    throw new ServiceError('ARTIFACT_MISMATCH', `本地版本与清单不一致: ${releaseId}`, `清单 ${manifest.files.length} 个文件，归档 ${zipFiles.size} 个`)
  }
  for (const file of manifest.files) {
    const size = zipFiles.get(file.path)
    if (size === undefined || size !== file.size) {
      throw new ServiceError('ARTIFACT_MISMATCH', `本地版本与清单不一致: ${releaseId}`, file.path)
    }
  }
  return { zipPath, manifest }
}

/** 解压本地归档到临时目录（自家产物同样执行路径安全校验），供回滚上传使用 */
export function extractArtifact(zipPath: string, manifest: ArtifactManifest, targetDir: string): ManifestFile[] {
  const zip = new AdmZip(zipPath)
  mkdirSync(targetDir, { recursive: true })
  const files: ManifestFile[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (isUnsafeZipPath(entry.entryName)) {
      throw new ServiceError('ARTIFACT_ZIP_UNSAFE', '本地归档包含不安全路径，已拒绝', entry.entryName)
    }
    const outPath = path.join(targetDir, entry.entryName)
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, entry.getData())
    files.push({ path: toPosix(entry.entryName), size: entry.header.size })
  }
  const manifestPaths = new Set(manifest.files.map((f) => f.path))
  if (files.length !== manifest.files.length || files.some((f) => !manifestPaths.has(f.path))) {
    throw new ServiceError('ARTIFACT_MISMATCH', '本地归档内容与清单不一致', manifest.id)
  }
  return files
}
