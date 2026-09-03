import { parse as parseEnvText } from 'dotenv'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_FTP_PORT, DEFAULT_RECORD_DIR_NAME, REQUIRED_ENV_KEYS } from '@shared/constants'
import type { ApiResult, AppError, FtpConfigView } from '@shared/types'

export interface ResolvedConfig {
  host: string
  port: number
  user: string
  password: string
  remoteRoot: string
  secure: boolean
  tlsRejectUnauthorized: boolean
  recordDir: string
  envPath: string
  deployEndpoint: string
  deployToken: string
}

export type EnvLoadResult = ApiResult<ResolvedConfig>

function parseFlag(raw: string | undefined, defaultTrue: boolean): boolean {
  if (raw === undefined) return defaultTrue
  return raw.trim().toLowerCase() !== 'false'
}

function parsePort(raw: string | undefined): number | AppError {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_FTP_PORT
  if (!/^\d+$/.test(value)) {
    return { code: 'ENV_PORT_INVALID', message: `FTP_PORT 非法: ${value}，必须是 1-65535 的整数` }
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { code: 'ENV_PORT_INVALID', message: `FTP_PORT 非法: ${value}，必须是 1-65535 的整数` }
  }
  return port
}

/** 校验远程根路径：拒绝空路径、相对路径、`.`、`..`、`/` 及归一化后逃逸到根的路径 */
export function validateRemoteRoot(raw: string): AppError | null {
  const value = raw.trim()
  if (value === '') {
    return { code: 'ENV_REMOTE_ROOT_INVALID', message: 'FTP_REMOTE_ROOT 不能为空' }
  }
  if (!value.startsWith('/')) {
    return { code: 'ENV_REMOTE_ROOT_INVALID', message: `FTP_REMOTE_ROOT 必须是绝对路径，当前值: ${value}` }
  }
  if (value.split('/').includes('..')) {
    return { code: 'ENV_REMOTE_ROOT_INVALID', message: `FTP_REMOTE_ROOT 包含越界片段，拒绝执行: ${value}` }
  }
  const normalized = path.posix.normalize(value)
  if (normalized === '/' || normalized === '.' || normalized === '') {
    return { code: 'ENV_REMOTE_ROOT_INVALID', message: `FTP_REMOTE_ROOT 指向根目录，拒绝执行: ${value}` }
  }
  return null
}

/** 纯函数：从 .env 键值解析并校验完整配置 */
export function parseEnvFields(raw: Record<string, string>, baseDir: string): EnvLoadResult {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !(raw[key] ?? '').trim())
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'ENV_FIELDS_MISSING',
        message: `配置字段不完整，缺少: ${missing.join('、')}`,
        detail: `请在 .env 中补全以下字段: ${missing.join(', ')}`
      }
    }
  }

  const port = parsePort(raw.FTP_PORT)
  if (typeof port !== 'number') return { ok: false, error: port }

  const rootError = validateRemoteRoot(raw.FTP_REMOTE_ROOT)
  if (rootError) return { ok: false, error: rootError }

  const recordDirRaw = (raw.PUBLISH_RECORD_DIR ?? '').trim()
  const recordDir = recordDirRaw
    ? path.resolve(baseDir, recordDirRaw)
    : path.join(baseDir, DEFAULT_RECORD_DIR_NAME)

  return {
    ok: true,
    data: {
      host: raw.FTP_HOST!.trim(),
      port,
      user: raw.FTP_USER!.trim(),
      password: raw.FTP_PASSWORD!,
      remoteRoot: path.posix.normalize(raw.FTP_REMOTE_ROOT!.trim()),
      // 安全默认：只有明确设为 false 才使用普通 FTP / 关闭证书校验
      secure: parseFlag(raw.FTP_SECURE, true),
      tlsRejectUnauthorized: parseFlag(raw.FTP_TLS_REJECT_UNAUTHORIZED, true),
      recordDir,
      envPath: path.join(baseDir, '.env'),
      deployEndpoint: (raw.DEPLOY_ENDPOINT ?? '').trim(),
      deployToken: raw.DEPLOY_TOKEN ?? ''
    }
  }
}

/** 只读加载 .env（不污染 process.env），缺失或非法时返回带具体字段的错误 */
export function loadEnvConfig(baseDir: string): EnvLoadResult {
  const envPath = path.join(baseDir, '.env')
  let text: string
  try {
    text = readFileSync(envPath, 'utf-8')
  } catch {
    return {
      ok: false,
      error: {
        code: 'ENV_FILE_MISSING',
        message: `未找到配置文件: ${envPath}`,
        detail: '开发环境读取项目根目录 .env，打包后读取可执行文件同级 .env。可参考 .env.example 创建。'
      }
    }
  }
  return parseEnvFields(parseEnvText(text), baseDir)
}

/** 脱敏视图：密码只以 *** 形式越过 IPC */
export function toConfigView(config: ResolvedConfig): FtpConfigView {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    passwordMasked: '***',
    remoteRoot: config.remoteRoot,
    secure: config.secure,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    recordDir: config.recordDir,
    envPath: config.envPath,
    deployEndpoint: config.deployEndpoint,
    deployTokenConfigured: config.deployToken.length >= 8
  }
}

/** 兜底清洗：任何即将输出到日志 / 错误 / 记录的文本都必须先移除密码 */
export function scrubSecrets(text: string, password: string): string {
  if (!password) return text
  return text.split(password).join('***')
}
