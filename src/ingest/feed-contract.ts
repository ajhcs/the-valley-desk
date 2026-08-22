import { citationUrl, isCited } from '../content/citation'
import { publishedItems } from '../content/published'
import { feedDocumentSchema, type ContentItem, type FeedDocument } from '../content/schema'

export function citedPublished(items: readonly ContentItem[]): ContentItem[] {
  return publishedItems(items)
    .filter(isCited)
    .slice()
    .sort((a, b) =>
      (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt),
    )
}

export function buildFeedDocument(
  items: readonly ContentItem[],
  generatedAt = new Date().toISOString(),
): FeedDocument {
  return feedDocumentSchema.parse({
    product: 'the-valley-desk',
    version: '1',
    generatedAt,
    items: citedPublished(items),
  })
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function rfc822(iso?: string): string {
  const date = iso ? new Date(iso) : new Date()
  return date.toUTCString()
}

export function buildFeedXml(
  items: readonly ContentItem[],
  generatedAt = new Date().toISOString(),
): string {
  const published = citedPublished(items)
  const rows = published
    .map((item) => {
      const link = citationUrl(item) ?? `/${item.slug}`
      const description = item.impactSentence ?? item.dek
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(description)}</description>
      <pubDate>${rfc822(item.publishedAt)}</pubDate>
      <category>${escapeXml(item.kind)}</category>
    </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Valley Desk</title>
    <link>https://github.com/ajhcs/the-valley-desk</link>
    <description>Published, cited items from The Valley Desk. Same ContentItem envelope as /feed.json.</description>
    <lastBuildDate>${rfc822(generatedAt)}</lastBuildDate>
    <generator>the-valley-desk</generator>
${rows}
  </channel>
</rss>
`
}
