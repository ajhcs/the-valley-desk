import type { BriefingItem, ContentItem, EventItem, NewsItem } from './schema'
import { briefingItemSchema } from './schema'
import { listPublishedByKind, publishedItems } from './published'

const DESK = 'The Valley Desk'

export function latestNews(items: readonly ContentItem[], limit = 6): NewsItem[] {
  return listPublishedByKind(items, 'news')
    .slice()
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit)
}

export function upcomingEvents(
  items: readonly ContentItem[],
  limit = 6,
  nowIso = new Date().toISOString(),
): EventItem[] {
  return listPublishedByKind(items, 'event')
    .filter((item) => item.startsAt >= nowIso)
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit)
}

function etOffset(at: Date): string {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = name?.match(/GMT([+-]\d+)/)
  const hours = match ? Number(match[1]) : -4
  const sign = hours >= 0 ? '+' : '-'
  return `${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`
}

export function yesterdayFivePmEastern(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  const todayNoon = new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00${etOffset(now)}`,
  )
  const yesterday = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000)
  const yParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(yesterday)
  const y = Number(yParts.find((part) => part.type === 'year')?.value)
  const m = Number(yParts.find((part) => part.type === 'month')?.value)
  const d = Number(yParts.find((part) => part.type === 'day')?.value)
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T17:00:00${etOffset(yesterday)}`
  return new Date(iso)
}

function tokenSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))
}

export function overlapScore(a: ContentItem, b: ContentItem): number {
  const orgsA = tokenSet(a.orgs)
  const orgsB = tokenSet(b.orgs)
  const topicsA = tokenSet(a.topics)
  const topicsB = tokenSet(b.topics)
  let score = 0
  for (const org of orgsA) if (orgsB.has(org)) score += 1
  for (const topic of topicsA) if (topicsB.has(topic)) score += 1
  return score
}

export function briefingWindowItems(
  items: readonly ContentItem[],
  now = new Date(),
): ContentItem[] {
  const start = yesterdayFivePmEastern(now)
  return publishedItems(items).filter((item) => {
    const stamp = item.publishedAt ?? item.updatedAt
    return new Date(stamp) >= start
  })
}

export function rankByOverlap(items: readonly ContentItem[]): ContentItem[] {
  return items
    .map((item) => ({
      item,
      score: items
        .filter((other) => other.id !== item.id)
        .reduce((sum, other) => sum + overlapScore(item, other), 0),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (b.item.publishedAt ?? b.item.updatedAt).localeCompare(
        a.item.publishedAt ?? a.item.updatedAt,
      )
    })
    .map((entry) => entry.item)
}

export function persistDailyBriefing(
  items: readonly ContentItem[],
  now = new Date(),
): BriefingItem {
  const windowItems = briefingWindowItems(items, now)
  const ranked = rankByOverlap(windowItems)
  const start = yesterdayFivePmEastern(now)
  const generatedAt = now.toISOString()
  const dateStamp = generatedAt.slice(0, 10)

  return briefingItemSchema.parse({
    id: `briefing-daily-${dateStamp}`,
    slug: `briefing-${dateStamp}`,
    kind: 'briefing',
    title: `Briefing since yesterday 5:00 p.m. ET`,
    dek: 'Ranked by shared orgs and topics in the window, not recency alone.',
    body: ranked.length
      ? `Window opened ${start.toISOString()}. Ranked ${ranked.length} published items by org+topic overlap.`
      : `Window opened ${start.toISOString()}. No published items in the window.`,
    status: 'published',
    publishedAt: generatedAt,
    updatedAt: generatedAt,
    topics: ['briefing', 'overlap'],
    orgs: [DESK],
    region: 'regional',
    authors: [{ name: DESK }],
    source: { kind: 'editorial', origin: DESK },
    windowStart: start.toISOString(),
    windowEnd: generatedAt,
    itemIds: ranked.map((item) => item.id),
    geo: 'Delaware Valley',
  })
}
