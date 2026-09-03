import { readdir, readFile, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FileReplacement, ReplacementConfig, ReplacementRule } from '@shared/types'
import { ServiceError } from './errors'

/** 规则文件与 .env 同目录，每次发布准备时现读，修改无需重启 */
export const REPLACEMENTS_FILE_NAME = 'publish-replacements.json'

export interface ReplacementStats {
  files: number
  count: number
  /** 命中明细（仅替换发生的文件），用于 debug 日志 */
  hits: { path: string; count: number }[]
}

/** 允许内容替换的文本扩展名；其余类型原样处理，防止二进制损坏 */
const TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'json', 'map', 'txt', 'md',
  'xml', 'svg', 'php', 'vue', 'svelte', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml',
  'ini', 'conf', 'cfg', 'csv', 'webmanifest'
])

export function isTextPath(relPath: string): boolean {
  return TEXT_EXTENSIONS.has(path.posix.extname(relPath).slice(1).toLowerCase())
}

/** 统一校验：from 非空、文件路径必须是安全相对路径 */
export function validateReplacementConfig(config: ReplacementConfig): void {
  config.global.forEach((rule, i) => {
    if (rule.from.trim() === '') {
      throw new ServiceError('REPLACEMENT_CONFIG_INVALID', `全局规则第 ${i + 1} 条的查找内容不能为空`)
    }
  })
  config.files.forEach((file, i) => {
    const rel = file.path.trim().replace(/\\/g, '/')
    if (rel === '' || rel.startsWith('/') || rel.split('/').includes('..')) {
      throw new ServiceError('REPLACEMENT_CONFIG_INVALID', `指定文件规则第 ${i + 1} 条的文件路径必须是安全的相对路径`)
    }
    file.rules.forEach((rule, j) => {
      if (rule.from.trim() === '') {
        throw new ServiceError('REPLACEMENT_CONFIG_INVALID', `${file.path} 的第 ${j + 1} 条规则查找内容不能为空`)
      }
    })
  })
}

/** 校验并归一化后写入规则文件，返回文件路径 */
export function saveReplacements(baseDir: string, config: ReplacementConfig): string {
  validateReplacementConfig(config)
  const normalized: ReplacementConfig = {
    global: config.global.map((rule) => ({ from: rule.from, to: rule.to })),
    files: config.files
      .map((file) => ({
        path: file.path.trim().replace(/\\/g, '/'),
        rules: file.rules.map((rule) => ({ from: rule.from, to: rule.to }))
      }))
      .filter((file) => file.path !== '' && file.rules.length > 0)
  }
  const file = path.join(baseDir, REPLACEMENTS_FILE_NAME)
  writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf-8')
  return file
}

/** 加载替换规则；文件不存在返回 null（可选配置），存在但非法直接抛错 */
export async function loadReplacements(baseDir: string): Promise<ReplacementConfig | null> {
  const file = path.join(baseDir, REPLACEMENTS_FILE_NAME)
  let text: string
  try {
    text = await readFile(file, 'utf-8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ServiceError('REPLACEMENT_CONFIG_INVALID', `${REPLACEMENTS_FILE_NAME} 不是合法 JSON`, err instanceof Error ? err.message : String(err))
  }

  const root = parsed as Partial<ReplacementConfig>
  const rule = (raw: unknown): ReplacementRule => {
    const item = raw as Partial<ReplacementRule>
    return { from: typeof item.from === 'string' ? item.from : '', to: typeof item.to === 'string' ? item.to : '' }
  }
  const config: ReplacementConfig = {
    global: (Array.isArray(root.global) ? root.global : []).map(rule),
    files: (Array.isArray(root.files) ? root.files : []).map((raw) => {
      const item = raw as Partial<FileReplacement>
      return {
        path: typeof item.path === 'string' ? item.path.trim().replace(/\\/g, '/') : '',
        rules: (Array.isArray(item.rules) ? item.rules : []).map(rule)
      }
    }).filter((item) => item.path !== '')
  }
  validateReplacementConfig(config)
  return config
}

function replaceBuffer(content: Buffer, from: Buffer, to: Buffer): { buffer: Buffer; count: number } {
  const chunks: Buffer[] = []
  let cursor = 0
  let count = 0
  for (;;) {
    const index = content.indexOf(from, cursor)
    if (index === -1) break
    chunks.push(content.subarray(cursor, index), to)
    cursor = index + from.length
    count += 1
  }
  if (count === 0) return { buffer: content, count }
  chunks.push(content.subarray(cursor))
  return { buffer: Buffer.concat(chunks), count }
}

/** 对单个文件内容应用 全局规则 + 该文件专属规则；Buffer 层替换，非 UTF-8 内容不匹配即原样保留 */
export function applyReplacements(
  relPath: string,
  content: Buffer,
  config: ReplacementConfig
): { content: Buffer; count: number } {
  const extra = config.files.find((item) => item.path === relPath)?.rules ?? []
  const rules = [...config.global, ...extra]
  if (rules.length === 0) return { content, count: 0 }

  let buffer = content
  let count = 0
  for (const rule of rules) {
    const result = replaceBuffer(buffer, Buffer.from(rule.from, 'utf-8'), Buffer.from(rule.to, 'utf-8'))
    buffer = result.buffer
    count += result.count
  }
  return { content: buffer, count }
}

/** 对目录内全部文本文件原地应用替换（本地代理验证用），变更才写回 */
export async function applyReplacementsToDirectory(dir: string, config: ReplacementConfig): Promise<ReplacementStats> {
  const stats: ReplacementStats = { files: 0, count: 0, hits: [] }
  const walk = async (current: string, rel: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relPath)
      } else if (entry.isFile() && isTextPath(relPath)) {
        const file = path.join(current, entry.name)
        const result = applyReplacements(relPath, await readFile(file), config)
        if (result.count > 0) {
          await writeFile(file, result.content)
          stats.files += 1
          stats.count += result.count
          stats.hits.push({ path: relPath, count: result.count })
        }
      }
    }
  }
  await walk(dir, '')
  return stats
}
