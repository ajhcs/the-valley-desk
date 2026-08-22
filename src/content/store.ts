import reviewSeed from '../../data/review.json'
import { persistDailyBriefing } from './queries'
import { latestNews, upcomingEvents } from './queries'
import { listPublishedByKind, publishedItems } from './published'
import { loadEditorialCatalog } from './fixtures'
import { mergeCatalog } from '../ingest/envelope'
import { contentItemSchema, type ContentItem, type ContentKind } from './schema'

export function loadCatalog(): ContentItem[] {
  const editorial = loadEditorialCatalog()
  const review = Array.isArray(reviewSeed)
    ? reviewSeed.map((item) => contentItemSchema.parse(item))
    : []
  const merged = mergeCatalog(editorial, review)
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
