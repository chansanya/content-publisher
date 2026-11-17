import tls from 'node:tls'
import type { CertificateSnapshot } from '@shared/types'
import { ServiceError } from './errors'
import { normalizeCertificateDomain } from './certificatePolicy'

function formatDistinguishedName(value: Record<string, string> | undefined): string {
  if (!value) return ''
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join(', ')
}

/** 读取网站实际对外提供的 TLS 证书；线上握手结果是部署是否真正生效的最终依据。 */
export function checkWebsiteCertificate(domain: string, timeoutMs = 15_000): Promise<CertificateSnapshot> {
  const normalized = normalizeCertificateDomain(domain)

  return new Promise((resolve, reject) => {
    let settled = false
    const socket = tls.connect({
      host: normalized,
      port: 443,
      servername: normalized,
      rejectUnauthorized: false
    })

    const finishError = (err: unknown): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(
        new ServiceError(
          'CERT_TLS_CHECK_FAILED',
          `读取 ${normalized} 的网站证书失败`,
          err instanceof Error ? err.message : String(err)
        )
      )
    }

    socket.setTimeout(timeoutMs, () => finishError(new Error(`连接超时（${timeoutMs}ms）`)))
    socket.once('error', finishError)
    socket.once('secureConnect', () => {
      if (settled) return
      try {
        const cert = socket.getPeerCertificate()
        if (!cert || !cert.valid_to) throw new Error('服务器未返回有效证书')
        const hostnameError = tls.checkServerIdentity(normalized, cert)
        if (hostnameError) throw hostnameError
        const validFrom = new Date(cert.valid_from)
        const validTo = new Date(cert.valid_to)
        if (Number.isNaN(validTo.getTime())) throw new Error(`无法解析证书到期时间: ${cert.valid_to}`)
        settled = true
        socket.end()
        resolve({
          domain: normalized,
          subject: formatDistinguishedName(cert.subject as Record<string, string> | undefined),
          issuer: formatDistinguishedName(cert.issuer as Record<string, string> | undefined),
          serialNumber: cert.serialNumber ?? '',
          fingerprint256: cert.fingerprint256 ?? '',
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          remainingDays: Math.ceil((validTo.getTime() - Date.now()) / 86_400_000),
          checkedAt: new Date().toISOString()
        })
      } catch (err) {
        finishError(err)
      }
    })
  })
}
