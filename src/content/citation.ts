import type { ContentItem } from './schema'

/** Citation/link uses existing source.url, then citations[0].url. Not a new Base field. */
export function citationUrl(item: ContentItem): string | undefined {
  return item.source.url ?? item.citations?.[0]?.url
}

export function isCited(item: ContentItem): boolean {
  return Boolean(citationUrl(item))
}

export function itemLink(item: ContentItem): string | undefined {
  return citationUrl(item)
}
