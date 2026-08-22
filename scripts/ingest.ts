import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNjdvhimssPage, parseDvhimssIcs } from '../src/ingest/events'
import { toReviewQueue } from '../src/ingest/envelope'
import { parseRssItems, parseWpJsonPosts, RSS_SOURCES } from '../src/ingest/rss'
import type { ContentItem } from '../src/content/schema'

const UA = 'TheValleyDesk/1.0 (+https://github.com/ajhcs/the-valley-desk)'
const BROWSER_UA =
  'Mozilla/5.0 (compatible; TheValleyDesk/1.0; +https://github.com/ajhcs/the-valley-desk)'

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept,
    },
  })
  if (!response.ok) {
    const retry = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA, accept },
    })
    if (!retry.ok) {
      throw new Error(`${url} -> ${response.status}/${retry.status}`)
    }
    return retry.text()
  }
  return response.text()
}

async function main() {
  const fetchedAt = new Date().toISOString()
  const items: ContentItem[] = []
  const report: string[] = []

  for (const source of RSS_SOURCES) {
    try {
      const xml = await fetchText(source.url, 'application/rss+xml, application/xml, text/xml, */*')
      const looksRss = /<rss[\s>]|<feed[\s>]/i.test(xml)
      if (!looksRss && source.origin === 'Technical.ly') {
        const json = await fetchText(
          'https://technical.ly/wp-json/wp/v2/posts?per_page=20',
          'application/json, */*',
        )
        const parsed = parseWpJsonPosts(json, source, fetchedAt)
        items.push(...parsed)
        report.push(
          `${source.label}: ${parsed.length} items via wp-json fallback (${source.url} returned HTML)`,
        )
        continue
      }
      if (!looksRss) {
        report.push(`${source.label}: not RSS (${source.url})`)
        continue
      }
      const parsed = parseRssItems(xml, source, fetchedAt)
      items.push(...parsed)
      report.push(`${source.label}: ${parsed.length} items from ${source.url}`)
    } catch (error) {
      report.push(`${source.label}: FAIL ${error instanceof Error ? error.message : error}`)
    }
  }

  try {
    const ics = await fetchText(
      'https://dvhimss.org/?post_type=tribe_events&ical=1',
      'text/calendar, */*',
    )
    const events = parseDvhimssIcs(ics, fetchedAt)
    items.push(...events)
    report.push(`DVHIMSS ICS: ${events.length} events`)
  } catch (error) {
    report.push(`DVHIMSS ICS: FAIL ${error instanceof Error ? error.message : error}`)
  }

  try {
    const html = await fetchText('https://njdvhimssevent.com/', 'text/html, */*')
    const events = parseNjdvhimssPage(html, fetchedAt)
    items.push(...events)
    report.push(`njdvhimssevent.com: ${events.length} events`)
  } catch (error) {
    report.push(`njdvhimssevent.com: FAIL ${error instanceof Error ? error.message : error}`)
  }

  const queued = toReviewQueue(items)
  const outFile = resolve(dirname(fileURLToPath(import.meta.url)), '../data/review.json')
  mkdirSync(dirname(outFile), { recursive: true })
  if (queued.length === 0) {
    console.log(report.join('\n'))
    console.log('Ingest produced 0 items; left data/review.json unchanged.')
    return
  }
  writeFileSync(outFile, `${JSON.stringify(queued, null, 2)}\n`)

  console.log(report.join('\n'))
  console.log(`Wrote ${queued.length} ingest items to data/review.json`)
}

await main()
