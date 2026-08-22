import { contentItemSchema, type ContentItem } from '../content/schema'
import { resolveIngestStatus } from './status'

export type IngestBatch = {
  fetchedAt: string
  sourceOrigin: string
  items: ContentItem[]
}

export function toReviewQueue(items: readonly ContentItem[]): ContentItem[] {
  return items.map((item) => {
    if (item.status === 'published' && item.kind === 'event' && item.autoPublish) {
      return contentItemSchema.parse(item)
    }
    const status = resolveIngestStatus({
      kind: item.kind,
      autoPublish: item.kind === 'event' ? item.autoPublish : false,
    })
    return contentItemSchema.parse({
      ...item,
      status,
      publishedAt: status === 'published' ? item.publishedAt : undefined,
    })
  })
}

export function mergeCatalog(
  editorial: readonly ContentItem[],
  review: readonly ContentItem[],
): ContentItem[] {
  const byId = new Map<string, ContentItem>()
  for (const item of editorial) byId.set(item.id, item)
  for (const item of review) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
}
