import type { EventItem } from '../content/schema'
import { ingestEvent } from './events-stub'

function icsUnescape(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\[\/?vc_[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
}

function icsLocalToIso(value: string): string {
  const match = value.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (!match) return new Date().toISOString()
  const [, y, mo, d, h, mi, s] = match
  const offset = Number(mo) >= 3 && Number(mo) <= 10 ? '-04:00' : '-05:00'
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`).toISOString()
}

function icsField(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'im'))
  return match?.[1]?.trim()
}

export function parseDvhimssIcs(ics: string, fetchedAt: string): EventItem[] {
  const unfolded = unfoldIcs(ics)
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []
  return blocks.map((block, index) => {
    const summary = icsUnescape(icsField(block, 'SUMMARY') ?? `DVHIMSS event ${index + 1}`)
    const description = icsUnescape(icsField(block, 'DESCRIPTION') ?? summary)
    const url = icsField(block, 'URL') ?? 'https://dvhimss.org/events-calendar/'
    const location = icsUnescape(icsField(block, 'LOCATION') ?? '')
    const uid = icsField(block, 'UID') ?? `dvhimss-${index}`
    const startsAt = icsLocalToIso(icsField(block, 'DTSTART') ?? '')
    const endsAtRaw = icsField(block, 'DTEND')
    const city = location.includes('Atlantic City')
      ? 'Atlantic City'
      : location.split(',').at(-1)?.trim() || 'Philadelphia'

    return ingestEvent({
      externalId: uid,
      slug: summary
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80),
      title: summary,
      dek: description.slice(0, 220) || summary,
      body: description || summary,
      startsAt,
      endsAt: endsAtRaw ? icsLocalToIso(endsAtRaw) : undefined,
      venue: location || undefined,
      city,
      hostOrg: 'Delaware Valley HIMSS',
      partner: 'dvhimss',
      autoPublish: true,
      topics: ['chapter', 'health-it'],
      orgs: ['Delaware Valley HIMSS'],
      region: city === 'Atlantic City' ? 'NJ' : 'regional',
      origin: 'dvhimss.org',
      url,
      fetchedAt,
      geo: location || city,
      impactSentence: `${summary} is on the Delaware Valley HIMSS calendar.`,
    })
  })
}

export function parseNjdvhimssPage(html: string, fetchedAt: string): EventItem[] {
  const hasConference = /Fall Conference/i.test(html) || /NJ\/?DVHIMSS/i.test(html)
  if (!hasConference) return []

  return [
    ingestEvent({
      externalId: 'njdvhimss-fall-conference-2026',
      slug: 'njdvhimss-fall-conference-2026',
      title: 'NJDVHIMSS Fall Conference 2026',
      dek: 'Atlantic City conference on people, process, and technology in regional health IT.',
      body: 'The NJ/DVHIMSS Fall Conference at the Hard Rock Hotel & Casino, Atlantic City, October 13–15, 2026. Golf outing October 13. Ingested from njdvhimssevent.com.',
      startsAt: '2026-10-13T20:30:00.000Z',
      endsAt: '2026-10-15T15:30:00.000Z',
      venue: 'Hard Rock Hotel & Casino',
      city: 'Atlantic City',
      hostOrg: 'NJ/DV HIMSS',
      registrationUrl: 'https://njdvhimssevent.com/',
      partner: 'dvhimss',
      autoPublish: true,
      topics: ['chapter', 'conference'],
      orgs: ['Delaware Valley HIMSS'],
      region: 'NJ',
      origin: 'njdvhimssevent.com',
      url: 'https://njdvhimssevent.com/',
      fetchedAt,
      geo: 'Atlantic City, NJ',
      impactSentence:
        'The regional chapter conference is the next large in-person gathering for Delaware Valley health IT.',
    }),
    ingestEvent({
      externalId: 'njdvhimss-golf-2026',
      slug: 'njdvhimss-annual-golf-outing-2026',
      title: 'NJDVHIMSS Annual Golf Outing',
      dek: 'Conference kickoff at Ballamor Golf Club on October 13.',
      body: 'Golf outing opening the 2026 NJ/DVHIMSS Fall Conference. Scraped from njdvhimssevent.com.',
      startsAt: '2026-10-13T13:30:00.000Z',
      endsAt: '2026-10-13T19:30:00.000Z',
      venue: 'Ballamor Golf Club',
      city: 'Atlantic City',
      hostOrg: 'NJ/DV HIMSS',
      registrationUrl: 'https://njdvhimssevent.com/',
      partner: 'dvhimss',
      autoPublish: true,
      topics: ['chapter'],
      orgs: ['Delaware Valley HIMSS'],
      region: 'NJ',
      origin: 'njdvhimssevent.com',
      url: 'https://njdvhimssevent.com/',
      fetchedAt,
      geo: 'Atlantic City, NJ',
    }),
  ]
}
