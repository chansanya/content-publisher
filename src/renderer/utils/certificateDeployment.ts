import type { CertificateApplicationAttempt, CertificateCloudResource, CertificateInstanceSummary } from '@shared/types'

export function deployedCertificateDomains(certificateId: number | undefined, resources: CertificateCloudResource[]): string[] {
  if (!certificateId) return []
  return [...new Set(resources.filter(item => item.certificateId != null && String(item.certificateId) === String(certificateId)).map(item => item.domain))]
}

export function visibleCertificateInstances(certificates: CertificateInstanceSummary[], resources: CertificateCloudResource[], resourcesKnown: boolean): CertificateInstanceSummary[] {
  if (!resourcesKnown) return certificates
  const domainKey = (domain: string): string => [...new Set(domain.toLowerCase().split(/[,，\s]+/).filter(Boolean))].sort().join(',')
  const latestDeployed = new Map<string, number>()
  for (const item of certificates) {
    if (!item.certificateId || !deployedCertificateDomains(item.certificateId, resources).length) continue
    const key = domainKey(item.domain)
    const expiry = Date.parse(item.certificateExpiresAt || '')
    if (key && Number.isFinite(expiry)) latestDeployed.set(key, Math.max(latestDeployed.get(key) ?? -Infinity, expiry))
  }
  return certificates.filter(item => {
    if (!item.certificateId || deployedCertificateDomains(item.certificateId, resources).length) return true
    const expiry = Date.parse(item.certificateExpiresAt || '')
    const deployedExpiry = latestDeployed.get(domainKey(item.domain))
    return !Number.isFinite(expiry) || deployedExpiry === undefined || expiry >= deployedExpiry
  })
}

export function certificateInstanceAction(row: CertificateInstanceSummary, attempts: CertificateApplicationAttempt[]): 'apply' | 'inspect' | 'deploy' {
  if (row.certificateId && ['issued', 'willExpire'].includes(row.certificateStatus || '')) return 'deploy'
  const phase = attempts.find(item => item.instanceId === row.instanceId)?.phase
  return row.available && (!phase || phase === 'configured' || phase === 'cleared') ? 'apply' : 'inspect'
}

export function defaultCertificateTargets(resources: CertificateCloudResource[], domain: string, savedIds: number[]): number[] {
  const primary = resources.filter(item => item.domain === domain)
  const selected = savedIds.length ? [...savedIds] : primary.length === 1 ? [primary[0].id] : []
  if (primary.length !== 1 || !primary[0].instanceId || selected.length !== 1 || selected[0] !== primary[0].id) return selected
  const pairedDomain = domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`
  const paired = resources.filter(item => item.domain === pairedDomain && item.instanceId === primary[0].instanceId && item.regionId === primary[0].regionId)
  return paired.length === 1 ? [...selected, paired[0].id] : selected
}

export function certificateConfirmation(certificateId: number, targets: string[]): string {
  return `将证书 ${certificateId} 部署到 ${targets.join('、')}？\n可能消耗云产品部署次数。`
}
