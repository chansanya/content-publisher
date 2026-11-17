import { parse } from 'dotenv'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export function readEnvFile(dir: string): Record<string, string> {
  const file = path.join(dir, '.env')
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : {}
}

export function migrateEnvFile(baseDir: string, dataDir: string): boolean {
  const source = path.join(baseDir, '.env')
  const target = path.join(dataDir, '.env')
  if (path.resolve(source) === path.resolve(target) || !existsSync(source) || existsSync(target)) return false
  mkdirSync(dataDir, { recursive: true })
  copyFileSync(source, target, constants.COPYFILE_EXCL)
  return true
}

export function updateEnvFile(dir: string, changes: Record<string, string>): void {
  const file = path.join(dir, '.env')
  const original = readFileSync(file, 'utf8')
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const values = new Map(Object.entries(changes))
  const lines = original.split(/\r?\n/).filter(line => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]/.exec(line)
    return !match || !values.has(match[1])
  })
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  for (const [key, value] of values) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error('配置值格式无效')
    const literal = !value.includes("'") ? `'${value}'` : `"${value}"`
    if (parse(`${key}=${literal}`)[key] !== value) throw new Error('配置值包含不支持的字符')
    lines.push(`${key}=${literal}`)
  }
  const temporary = path.join(dir, `.env.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${lines.join(newline)}${newline}`, { flag: 'wx', mode: statSync(file).mode & 0o777 })
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}
