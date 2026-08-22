# The Valley Desk

Product source. Human news + agent feed. Delaware Valley / Greater Philadelphia healthcare technology.

Owner: Cole Lyons (co-founder). Engineering: Knox. Product: Reed. Brand: Mira. CEO: Vale.

## First-class paths

- `src/content/schema.ts` — Zod `ContentItem` discriminated union
- `src/content/queries.ts` — `latestNews` + `upcomingEvents`
- `src/content/store.ts` — fixture-backed `loadCatalog`
- `src/ingest/envelope.ts` — `IngestBatch` + `toReviewQueue`
- `src/ingest/events-stub.ts` — DVHIMSS stub, review unless `autoPublish`
- `src/ingest/feed-contract.ts` — `GET /feed.json` same envelope
- `src/styles/tokens.css` — the six locked Mira variables
- `fixtures/catalog.json` — one of each kind; interview stays draft and off the public feed

## Schema

One `ContentItem` envelope. Start at `src/content/schema.ts`. Do not add a second agent model.

Week-one Base stays. Reed merge adds only:

- `impactSentence` — required to publish `news` | `policy` | `ai` | `interview`
- `geo?`
- `citations?` — `{ name, url }[]`

`source.origin`, `source.url`, and `source.fetchedAt` stay primary. Citation/link is `source.url` (then `citations[0].url`). Freshness is derived in `src/content/freshness.ts`, not stored.

## Week-one jobs

1. Zod `ContentItem` discriminated union on `kind`
2. Fixture catalog + in-memory store + homepage queries
3. Two-rail homepage (news ink, events gold) from the store
4. Events ingest adapter (review unless `autoPublish` / DVHIMSS whitelist)
5. Locked Mira tokens in `src/styles/tokens.css`
6. `GET /feed.json` and `GET /feed.xml` of published + cited items

## Scripts

```bash
npm install
npm run ingest
npm run build
```
