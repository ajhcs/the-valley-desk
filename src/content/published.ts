import type { ContentItem, ContentKind } from './schema'

export function isPublished(item: ContentItem): boolean {
  return item.status === 'published'
}

export function publishedItems(items: readonly ContentItem[]): ContentItem[] {
  return items.filter(isPublished)
}

export function listPublishedByKind<K extends ContentKind>(
  items: readonly ContentItem[],
  kind: K,
): Extract<ContentItem, { kind: K }>[] {
  return publishedItems(items).filter(
    (item): item is Extract<ContentItem, { kind: K }> => item.kind === kind,
  )
}
