import type { PublishRecord } from '@shared/types'

export function canApplyToProxy(record: PublishRecord): boolean {
  return record.status === 'succeeded'
}

export function isLastAppliedArtifact(record: PublishRecord, artifactId?: string): boolean {
  return Boolean(artifactId && record.artifactId === artifactId)
}
