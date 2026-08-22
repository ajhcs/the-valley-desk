import { eventItemSchema, type EventItem, type EventPartner, type Region } from '../content/schema'
import { isDvhimssAutopublish, resolveIngestStatus } from './status'

const DEFAULT_CLOCK = '2026-08-22T12:00:00.000Z'
const DEFAULT_TIMEZONE = 'America/New_York'

export type EventIngestPayload = {
  externalId: string
  id?: string
  slug: string
  title: string
  dek: string
  body: string
  startsAt: string
  endsAt?: string
  timezone?: string
  venue?: string
  city?: string
  hostOrg: string
  registrationUrl?: string
  partner: EventPartner
  autoPublish?: boolean
  topics?: string[]
  orgs?: string[]
  region?: Region
  authors?: EventItem['authors']
  origin: string
  url?: string
  fetchedAt?: string
  geo?: string
  impactSentence?: string
}

/** Writes the same ContentItem envelope. Review unless autoPublish / DVHIMSS whitelist. */
export function ingestEvent(payload: EventIngestPayload): EventItem {
  const clock = payload.fetchedAt ?? DEFAULT_CLOCK
  const autoPublish =
    payload.autoPublish === true ||
    isDvhimssAutopublish({ partner: payload.partner, origin: payload.origin })
  const status = resolveIngestStatus({ kind: 'event', autoPublish })

  return eventItemSchema.parse({
    id: payload.id ?? `ingest-event-${payload.externalId}`,
    slug: payload.slug,
    kind: 'event',
    title: payload.title,
    dek: payload.dek,
    body: payload.body,
    status,
    publishedAt: status === 'published' ? clock : undefined,
    updatedAt: clock,
    topics: payload.topics ?? [],
    orgs: payload.orgs ?? [payload.hostOrg],
    region: payload.region ?? 'regional',
    authors: payload.authors ?? [{ name: payload.hostOrg }],
    source: {
      kind: 'ingest',
      origin: payload.origin,
      url: payload.url,
      fetchedAt: clock,
      externalId: payload.externalId,
    },
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    timezone: payload.timezone ?? DEFAULT_TIMEZONE,
    venue: payload.venue,
    city: payload.city,
    hostOrg: payload.hostOrg,
    registrationUrl: payload.registrationUrl,
    partner: payload.partner,
    autoPublish,
    geo: payload.geo ?? payload.city,
    impactSentence: payload.impactSentence,
    citations: payload.url
      ? [{ name: payload.origin, url: payload.url }]
      : undefined,
  })
}
