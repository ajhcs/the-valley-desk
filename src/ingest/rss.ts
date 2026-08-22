import { newsItemSchema, type NewsItem } from '../content/schema'
import { resolveIngestStatus } from './status'

export type RssSource = {
  origin: string
  label: string
  url: string
  region: NewsItem['region']
  topics: string[]
}

export const RSS_SOURCES: RssSource[] = [
  {
    origin: 'The Philadelphia Inquirer',
    label: 'Inquirer health',
    url: 'https://www.inquirer.com/arc/outboundfeeds/rss/category/health/?outputType=xml',
    region: 'PA',
    topics: ['health'],
  },
  {
    origin: 'The Philadelphia Inquirer',
    label: 'Inquirer business',
    url: 'https://www.inquirer.com/arc/outboundfeeds/rss/category/business/?outputType=xml',
    region: 'PA',
    topics: ['business'],
  },
  {
    origin: 'WHYY',
    label: 'WHYY',
    url: 'https://whyy.org/feed/',
    region: 'regional',
    topics: ['local'],
  },
  {
    origin: 'Technical.ly',
    label: 'Technical.ly',
    url: 'https://technical.ly/feed/',
    region: 'regional',
    topics: ['technology'],
  },
]

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return match?.[1] ? decode(match[1]) : undefined
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function toIso(pubDate?: string, fallback?: string): string {
  if (pubDate) {
    const parsed = new Date(pubDate)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback ?? new Date().toISOString()
}

export function parseRssItems(xml: string, source: RssSource, fetchedAt: string): NewsItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  return blocks.flatMap((block) => {
    const title = tag(block, 'title')
    const link = tag(block, 'link')
    if (!title || !link) return []
    const dek = tag(block, 'description') ?? title
    const body = tag(block, 'content:encoded') ?? dek
    const pubDate = tag(block, 'pubDate')
    const creator = tag(block, 'dc:creator')
    const publishedAt = toIso(pubDate, fetchedAt)

    return [
      toIngestedNews({
        title,
        link,
        dek,
        body,
        creator,
        publishedAt,
        fetchedAt,
        source,
      }),
    ]
  })
}

function toIngestedNews(input: {
  title: string
  link: string
  dek: string
  body: string
  creator?: string
  publishedAt: string
  fetchedAt: string
  source: RssSource
}): NewsItem {
  const id = `ingest-news-${slugify(input.link)}`
  return newsItemSchema.parse({
        id,
        slug: slugify(input.title),
        kind: 'news',
        title: input.title,
        dek: input.dek,
        body: input.body,
        status: resolveIngestStatus({ kind: 'news' }),
        updatedAt: input.fetchedAt,
        topics: input.source.topics,
        orgs: [input.source.origin],
        region: input.source.region,
        authors: [{ name: input.creator || input.source.origin, org: input.source.origin }],
        source: {
          kind: 'ingest',
          origin: input.source.origin,
          url: input.link,
          fetchedAt: input.fetchedAt,
          externalId: input.link,
        },
        relatedEventIds: [],
        relatedVoiceIds: [],
        impactSentence: input.dek,
        citations: [{ name: input.source.origin, url: input.link }],
      })
}

export function parseWpJsonPosts(json: string, source: RssSource, fetchedAt: string): NewsItem[] {
  const posts = JSON.parse(json) as Array<{
    title?: { rendered?: string }
    link?: string
    excerpt?: { rendered?: string }
    content?: { rendered?: string }
    date_gmt?: string
    date?: string
  }>
  if (!Array.isArray(posts)) return []
  return posts.flatMap((post) => {
    const title = decode(post.title?.rendered ?? '')
    const link = post.link
    if (!title || !link) return []
    const dek = decode(post.excerpt?.rendered ?? title)
    const body = decode(post.content?.rendered ?? dek)
    return [
      toIngestedNews({
        title,
        link,
        dek,
        body,
        publishedAt: toIso(post.date_gmt ?? post.date, fetchedAt),
        fetchedAt,
        source,
      }),
    ]
  })
}
