import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtureCatalog, loadEditorialCatalog } from '../src/content/fixtures'
import { buildFeed, buildFeedXml } from '../src/content/feed'
import { isCited } from '../src/content/citation'
import { overlapScore, rankByOverlap, yesterdayFivePmEastern } from '../src/content/queries'
import { ingestEvent } from '../src/ingest/events-stub'
import { resolveIngestStatus } from '../src/ingest/status'
import { latestNews, listPublishedByKind, loadCatalog, store, upcomingEvents } from '../src/content/store'
import { contentItemSchema, IMPACT_PUBLISH_KINDS, interviewItemSchema } from '../src/content/schema'

const forbidden = ['sourceName', 'sourceUrl', 'freshnessClass', 'source_name', 'ingestedAt']
const schemaText = readFileSync(
  resolve(fileURLToPath(import.meta.url), '../../src/content/schema.ts'),
  'utf8',
)
for (const name of forbidden) {
  assert.equal(schemaText.includes(name), false, `schema must not add ${name}`)
}

const items = loadCatalog()
const kinds = new Set(items.map((item) => item.kind))
for (const kind of ['news', 'event', 'voice', 'policy', 'ai', 'briefing', 'interview'] as const) {
  assert.ok(kinds.has(kind), `catalog is missing kind ${kind}`)
}

assert.ok(store.latestNews().length >= 4, 'store latestNews must fill the news rail')
assert.ok(store.upcomingEvents().length >= 2, 'store upcomingEvents must fill the events rail')
assert.deepEqual(
  store.latestNews().map((item) => item.id),
  latestNews(items).map((item) => item.id),
)

for (const item of latestNews(items)) {
  assert.equal(item.kind, 'news')
  assert.equal(item.status, 'published')
}

for (const item of upcomingEvents(items, 6, '2026-08-22T12:00:00.000Z')) {
  assert.equal(item.kind, 'event')
  assert.equal(item.status, 'published')
  assert.ok(item.startsAt >= '2026-08-22T12:00:00.000Z')
}

for (const item of items) {
  if (
    item.status === 'published' &&
    (IMPACT_PUBLISH_KINDS as readonly string[]).includes(item.kind)
  ) {
    assert.ok(item.impactSentence, `${item.id} needs impactSentence to publish`)
  }
}

const interview = items.find((item) => item.id === 'interview-cole-jefferson-cmio')
assert.ok(interview)
assert.equal(interview.status, 'draft')
assert.equal(interview.kind, 'interview')
assert.equal(interview.authors[0]?.name, 'Cole Lyons')

const feed = buildFeed(items, '2026-08-22T12:00:00.000Z')
assert.equal(feed.product, 'the-valley-desk')
assert.equal(feed.version, '1')
assert.ok(feed.items.every((item) => item.status === 'published'))
assert.ok(feed.items.every(isCited))
assert.ok(!feed.items.some((item) => item.id === interview.id))
assert.ok(!feed.items.some((item) => item.kind === 'interview'))

const xml = buildFeedXml(items, '2026-08-22T12:00:00.000Z')
assert.match(xml, /<rss version="2.0">/)
assert.match(xml, /<description>/)
assert.doesNotMatch(xml, /interview-cole-jefferson-cmio/)

const reviewEvent = ingestEvent(fixtureCatalog.eventIngestPayloads[1]!)
assert.equal(reviewEvent.status, 'review')
assert.equal(resolveIngestStatus({ kind: 'interview', autoPublish: true }), 'review')
assert.equal(resolveIngestStatus({ kind: 'event', autoPublish: true }), 'published')

assert.throws(() => {
  interviewItemSchema.parse({
    ...interview,
    source: { kind: 'ingest', origin: 'should-fail' },
  })
})

const ranked = rankByOverlap(loadEditorialCatalog().filter((item) => item.status === 'published'))
if (ranked.length >= 2) {
  const first = ranked[0]!
  const second = ranked[1]!
  const firstScore = ranked
    .filter((item) => item.id !== first.id)
    .reduce((sum, item) => sum + overlapScore(first, item), 0)
  const secondScore = ranked
    .filter((item) => item.id !== second.id)
    .reduce((sum, item) => sum + overlapScore(second, item), 0)
  assert.ok(firstScore >= secondScore, 'briefing rank must prefer overlap over recency')
}

assert.ok(yesterdayFivePmEastern() instanceof Date)
assert.ok(listPublishedByKind(items, 'news').length >= 4)

for (const item of items) {
  contentItemSchema.parse(item)
}

console.log(
  `Content checks passed: ${items.length} catalog items, ${feed.items.length} cited published in feed.`,
)
