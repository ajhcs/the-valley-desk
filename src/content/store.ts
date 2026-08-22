import catalog from '../../fixtures/catalog.json'
import reviewSeed from '../../data/review.json'
import { persistDailyBriefing } from './queries'
import { latestNews, upcomingEvents } from './queries'
import { listPublishedByKind, publishedItems } from './published'
import { ingestEvent } from '../ingest/events-stub'
import { mergeCatalog } from '../ingest/envelope'
import { contentItemSchema, type ContentItem, type ContentKind } from './schema'
import { eventIngestPayloads } from './fixtures'

function parseList(raw: unknown): ContentItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => contentItemSchema.parse(item))
}

/** Fixture-backed catalog. `fixtures/catalog.json` is first-class. */
export function loadCatalog(): ContentItem[] {
  const fixtures = parseList(catalog)
  const stubEvents = eventIngestPayloads.map((payload) => ingestEvent(payload))
  const review = parseList(reviewSeed)
  const merged = mergeCatalog(mergeCatalog(fixtures, stubEvents), review)
  const briefing = persistDailyBriefing(merged)
  return mergeCatalog(merged, [briefing])
}

export function createStore(seed: ContentItem[] = loadCatalog()) {
  const items = [...seed]

  return {
    all: () => items,
    published: () => publishedItems(items),
    byKind: <K extends ContentKind>(kind: K, publishedOnly = true) => {
      const pool = publishedOnly ? publishedItems(items) : items
      return pool.filter(
        (item): item is Extract<ContentItem, { kind: K }> => item.kind === kind,
      )
    },
    latestNews: (limit = 6) => latestNews(items, limit),
    upcomingEvents: (limit = 6, nowIso?: string) =>
      upcomingEvents(items, limit, nowIso ?? new Date().toISOString()),
    getById: (id: string) => items.find((item) => item.id === id),
  }
}

export const store = createStore()

export { latestNews, upcomingEvents, listPublishedByKind, publishedItems }
