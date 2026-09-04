import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ResolvedConfig } from './envService'
import type { FtpClientLike } from './ftpService'
import { joinPosix } from './ftpService'
import { ServiceError } from './errors'

export const CONTROL_DIR_NAME = '.ftppublisher'

export interface ServerDeployResponse {
  releaseId: string
  files: number
  durationMs: number
}

function serverDeployConfigError(config: ResolvedConfig): ServiceError | null {
  if (!config.deployEndpoint || config.deployToken.length < 8) {
    return new ServiceError(
      'DEPLOY_CONFIG_MISSING',
      '服务端 ZIP 发布配置不完整',
      '请在 .env 中配置 DEPLOY_ENDPOINT 和至少 8 位的 DEPLOY_TOKEN'
    )
  }
  if (/\r|\n/.test(config.deployToken)) {
    return new ServiceError('DEPLOY_TOKEN_INVALID', 'DEPLOY_TOKEN 不能包含换行符')
  }
  try {
    const endpoint = new URL(config.deployEndpoint)
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error()
  } catch {
    return new ServiceError('DEPLOY_ENDPOINT_INVALID', 'DEPLOY_ENDPOINT 必须是有效的 HTTP 或 HTTPS 地址')
  }
  return null
}

export function assertServerDeployConfig(config: ResolvedConfig): void {
  const error = serverDeployConfigError(config)
  if (error) throw error
}

/** 部署接口配置是否可用；不可用时删除等增强操作自动回退 FTP 直连 */
export function serverDeployEnabled(config: ResolvedConfig): boolean {
  return serverDeployConfigError(config) === null
}

export function remoteArchivePath(config: ResolvedConfig, releaseId: string): string {
  return joinPosix(config.remoteRoot, `${CONTROL_DIR_NAME}/incoming/${releaseId}.zip`)
}

function normalizePreservePath(raw: string): string | null {
  const value = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts = value.split('/')
  if (!value || /^[A-Za-z]:/.test(value) || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /\r|\n/.test(part))) {
    return null
  }
  return parts.join('/')
}

export async function uploadDeployRuntime(
  client: FtpClientLike,
  config: ResolvedConfig,
  deployScriptPath: string,
  log?: (message: string) => void,
  preservePaths: readonly string[] = []
): Promise<void> {
  if (!existsSync(deployScriptPath)) {
    throw new ServiceError('DEPLOY_SCRIPT_MISSING', '本地服务端部署脚本不存在', deployScriptPath)
  }

  const controlDir = joinPosix(config.remoteRoot, CONTROL_DIR_NAME)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ftppub-config-'))
  const configPath = path.join(tempDir, 'config.php')
  const token = config.deployToken.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const preserved = [...new Set(preservePaths.map(normalizePreservePath).filter((name): name is string => name !== null))]
    .filter((name) => name !== CONTROL_DIR_NAME)
    .map((name) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
  writeFileSync(configPath, `<?php\nreturn ['token' => '${token}', 'preserve' => [${preserved.join(', ')}]];\n`, 'utf-8')

  try {
    await client.ensureDir(joinPosix(controlDir, 'incoming'))
    log?.('[3/4] 上传 deploy.php')
    await client.uploadFrom(deployScriptPath, joinPosix(controlDir, 'deploy.php'))
    log?.('[4/4] 上传 config.php')
    await client.uploadFrom(configPath, joinPosix(controlDir, 'config.php'))
  } catch (err) {
    throw new ServiceError(
      'DEPLOY_RUNTIME_UPLOAD_FAILED',
      '上传服务端部署脚本失败',
      err instanceof Error ? err.message : String(err)
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function postDeployApi(
  config: ResolvedConfig,
  payload: Record<string, unknown>,
  timeoutMs: number,
  failureCode: string
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(config.deployEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FtpPublisher-Token': config.deployToken
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    })
    let body: Record<string, unknown>
    try {
      body = (await response.json()) as Record<string, unknown>
    } catch {
      throw new ServiceError(
        failureCode,
        '服务端部署接口调用失败',
        response.status === 404
          ? `HTTP 404，服务器上可能还没有部署脚本，请先在本地发布页点击同步`
          : `HTTP ${response.status}，响应不是 JSON`
      )
    }
    if (!response.ok || body.ok !== true) {
      throw new ServiceError(failureCode, '服务端部署接口调用失败', String(body.message ?? `HTTP ${response.status}`))
    }
    return body
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError('SERVER_DEPLOY_REQUEST_FAILED', '无法调用服务端部署接口', err instanceof Error ? err.message : String(err))
  }
}

export async function triggerServerDeploy(config: ResolvedConfig, releaseId: string): Promise<ServerDeployResponse> {
  const body = await postDeployApi(config, { releaseId }, 15 * 60 * 1000, 'SERVER_DEPLOY_FAILED')
  return {
    releaseId: String(body.releaseId ?? releaseId),
    files: Number(body.files ?? 0),
    durationMs: Number(body.durationMs ?? 0)
  }
}

export interface ServerDeleteEntry {
  path: string
  type: 'file' | 'directory' | 'link' | null
  existed: boolean
}

export interface ServerDeleteResponse {
  entries: ServerDeleteEntry[]
  durationMs: number
}

export async function triggerServerDelete(config: ResolvedConfig, paths: string[]): Promise<ServerDeleteResponse> {
  const body = await postDeployApi(config, { action: 'delete', paths }, 30 * 1000, 'SERVER_DELETE_FAILED')
  const raw = Array.isArray(body.entries) ? body.entries : []
  return {
    entries: raw.map((entry) => {
      const item = entry as Partial<ServerDeleteEntry>
      const type =
        item.type === 'file' || item.type === 'directory' || item.type === 'link' ? item.type : null
      return { path: String(item.path ?? ''), type, existed: item.existed === true }
    }),
    durationMs: Number(body.durationMs ?? 0)
  }
}

export interface ServerClearResponse {
  removed: number
  durationMs: number
}

export async function triggerServerClear(config: ResolvedConfig, preservePaths: readonly string[] = []): Promise<ServerClearResponse> {
  const body = await postDeployApi(config, { action: 'clear', preserve: preservePaths }, 10 * 60 * 1000, 'SERVER_CLEAR_FAILED')
  return { removed: Number(body.removed ?? 0), durationMs: Number(body.durationMs ?? 0) }
}
