import type { ContentItem } from './schema'

export type Freshness = 'breaking' | 'today' | 'week' | 'background'

/** Derived from publishedAt/updatedAt. Not a schema field. */
export function deriveFreshness(item: ContentItem, now = new Date()): Freshness {
  const stamp = item.publishedAt ?? item.updatedAt
  const ageMs = now.getTime() - new Date(stamp).getTime()
  if (ageMs <= 4 * 60 * 60 * 1000) return 'breaking'
  if (ageMs <= 24 * 60 * 60 * 1000) return 'today'
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'week'
  return 'background'
}
