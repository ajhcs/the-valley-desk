import type { ContentKind, ContentStatus } from '../content/schema'

export function resolveIngestStatus(input: {
  kind: ContentKind
  autoPublish?: boolean
}): ContentStatus {
  if (input.kind === 'interview') return 'review'
  if (input.kind === 'event' && input.autoPublish === true) return 'published'
  return 'review'
}

export function isDvhimssAutopublish(input: {
  partner?: string
  origin?: string
}): boolean {
  const partner = input.partner?.toLowerCase()
  const origin = input.origin?.toLowerCase() ?? ''
  return partner === 'dvhimss' || origin.includes('dvhimss')
}
