import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editorialFixtures } from '../src/content/fixtures'
import { buildFeed, buildFeedXml } from '../src/content/feed'
import { loadCatalog } from '../src/content/store'

const generatedAt = new Date().toISOString()
const items = loadCatalog()
const feed = buildFeed(items, generatedAt)
const xml = buildFeedXml(items, generatedAt)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'public'), { recursive: true })
mkdirSync(resolve(root, 'fixtures'), { recursive: true })
writeFileSync(resolve(root, 'public/feed.json'), `${JSON.stringify(feed, null, 2)}\n`)
writeFileSync(resolve(root, 'public/feed.xml'), xml.endsWith('\n') ? xml : `${xml}\n`)
writeFileSync(
  resolve(root, 'fixtures/catalog.json'),
  `${JSON.stringify(editorialFixtures, null, 2)}\n`,
)

console.log(
  `Wrote ${feed.items.length} cited published items to public/feed.json and public/feed.xml`,
)
