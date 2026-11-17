import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import type { AppError, CertificateApplicationAttempt, CertificateAutomationRecord } from '@shared/types'
import { ServiceError, toAppError } from './errors'

export function assertCertificateTaskRunning(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ServiceError('CERT_TASK_STOPPED', '本地证书任务已中止')
}

export function mergeApplicationAttempts(saved: Record<string, CertificateApplicationAttempt>, history: { endedAt: string; automation: CertificateAutomationRecord }[]): CertificateApplicationAttempt[] {
  const attempts = new Map(Object.entries(saved))
  for (const entry of history) {
    const task = entry.automation
    if (task.mode === 'renewal' && task.instanceId && !attempts.has(task.instanceId)) {
      attempts.set(task.instanceId, { instanceId: task.instanceId, domain: task.domain || '', phase: 'uncertain', updatedAt: entry.endedAt })
    }
  }
  return [...attempts.values()]
}

export function normalizeCertificateDomain(raw: string): string {
  const value = raw.trim()
  let hostname: string
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error()
    if (url.pathname !== '/' || url.search || url.hash) throw new Error()
    hostname = domainToASCII(url.hostname.replace(/\.$/, '')).toLowerCase()
  } catch {
    throw new ServiceError('CERT_DOMAIN_INVALID', '请输入不含端口、路径和通配符的网站域名')
  }
  if (
    isIP(hostname) || hostname.length > 253 || !hostname.includes('.') ||
    hostname.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  ) throw new ServiceError('CERT_DOMAIN_INVALID', '请输入有效的公网域名，不支持 IP 或通配符')
  return hostname
}

export function nextCertificateCheck(hour: number, now = new Date()): Date {
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next
}

export function certificateCoversDomain(names: string[], domain: string): boolean {
  return names.some((raw) => {
    const name = raw.trim().toLowerCase().replace(/\.$/, '')
    const target = domain.toLowerCase()
    return name === target || (name.startsWith('*.') && target.split('.').length === name.split('.').length && target.endsWith(name.slice(1)))
  })
}

export function certificateSerial(value: string): string {
  return value.replace(/:/g, '').toUpperCase().replace(/^0+/, '')
}

export function validateDeploymentResourceIds(value: unknown, required = false): number[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || (required && !value.length) || value.length > 100 || value.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length) {
    throw new ServiceError('PARAM_INVALID', '请选择有效的云虚拟主机资源（最多 100 个，不可重复）')
  }
  return [...value]
}


export function safeCertificateError(err: unknown, secrets: string[] = []): AppError {
  const original = toAppError(err)
  const sanitize = (text: string): string => {
    let value = text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    for (const secret of secrets.filter(Boolean)) value = value.split(secret).join('***')
    return value.slice(0, 1600)
  }
  return { code: original.code, message: sanitize(original.message), detail: original.detail ? sanitize(original.detail) : undefined }
}
