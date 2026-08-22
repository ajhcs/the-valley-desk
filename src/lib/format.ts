import type { ContentItem, EventItem } from '../content/schema'

const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/New_York',
})

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
})

export function formatPublished(item: ContentItem): string | null {
  if (!item.publishedAt) return null
  return DATE.format(new Date(item.publishedAt))
}

export function formatEventWhen(item: EventItem): string {
  return DATE_TIME.format(new Date(item.startsAt))
}

export function formatEventPlace(item: EventItem): string | null {
  const parts = [item.city, item.venue].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
