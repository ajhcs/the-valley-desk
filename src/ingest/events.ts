import type { ContentItem, EventItem } from "../content/schema";
import { eventCopyMarksCancelled } from "../lib/calendar";
import { cleanEventSourceMarkup } from "../lib/sourceMarkup";
import { hasInternalProcessLanguage } from "../lib/editorialCopy";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import {
  DVHIMSS_MAX_PAGES,
  EVENT_SOURCE_HOSTS,
  EVENT_TIMEZONE,
  REGISTRATION_HOSTS,
  allowlistedHttps,
  decodeHtml,
  genericNjEventIdentity,
  isSafeTribeNextUrl,
  isSameListingPage,
  njSnapshotCompleteness,
  parseNjdvhimssPage,
  parseTribeEventsResponse,
  perPageFromUrl,
  publicationSlug,
  stripHtml,
  toIso,
  tribeFallbackId,
  tribeNextPageUrl,
  tribeRecordId,
  tribeSnapshotCompleteness,
  type ParsedListingEvent,
  type TribeEventsPage,
} from "./event-parser";
import { eventSourceById } from "./origins";
import {
  classifyFetchError,
  sourceBackoffNote,
  sourceIsInBackoff,
  sourceNote,
  sourceStateForItemCount,
  type IngestSourceResult,
  type SnapshotCompleteness,
  type SourceRunNote,
} from "./source-health";
import {
  EVENTS_MAX_BYTES,
  SOURCE_TIMEOUT_MS,
  SOURCE_USER_AGENT,
  UpstreamError,
  fetchUpstream,
} from "./upstream";

const UA = SOURCE_USER_AGENT;
const DVHIMSS_SOURCE = eventSourceById("dvhimss-events");
const NJHIMSS_SOURCE = eventSourceById("njhimss-events");
const DVHIMSS_FALLBACK_URL = "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=100";
const DVHIMSS_LISTING_URL = "https://dvhimss.org/events-calendar";
const NJ_LISTING_URL = "https://njdvhimssevent.com/";
const EVENT_REDIRECT_HOSTS = new Set(EVENT_SOURCE_HOSTS);

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function originBase(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return url;
  }
}

function verifiedRegistrationUrl(value: unknown, base: string) {
  if (typeof value !== "string") return undefined;
  return allowlistedHttps(value, base, REGISTRATION_HOSTS);
}

function isCventHost(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "cvent.me" || host === "web.cvent.com";
  } catch {
    return false;
  }
}

function verifiedNjdvhimssRegistrationUrl(html: string, base: string) {
  const urls = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]))
    .map((value) => verifiedRegistrationUrl(value, base))
    .filter((value): value is string => Boolean(value));
  return urls.find((value) => isCventHost(value));
}

function officialEventUrl(value: unknown, base: string, fallback: string) {
  const candidate = typeof value === "string" ? allowlistedHttps(value, base, EVENT_SOURCE_HOSTS) : undefined;
  if (candidate && !isSameListingPage(candidate, fallback)) return candidate;
  return allowlistedHttps(fallback, base, EVENT_SOURCE_HOSTS) ?? fallback;
}

function isRecognizedNjdvhimssPage(html: string) {
  return /<title[^>]*>\s*NJDVHIMSS\s*<\/title>/i.test(html)
    && /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/njdvhimssevent\.com\/?["']/i.test(html);
}

function textField(value: unknown): string {
  if (typeof value === "string") return stripHtml(cleanEventSourceMarkup(value));
  if (value && typeof value === "object" && "rendered" in value) {
    const rendered = (value as { rendered?: unknown }).rendered;
    if (typeof rendered === "string") return stripHtml(cleanEventSourceMarkup(rendered));
  }
  return "";
}

function readerSafeText(value: string) {
  const text = cleanEventSourceMarkup(value);
  if (!text || hasInternalProcessLanguage(text)) return "";
  return text;
}

function officialEventBody(title: string, venue?: string, city?: string, description?: string) {
  const fromSource = description ? readerSafeText(description) : "";
  if (fromSource) return fromSource;
  const place = [venue, city].filter(Boolean).join(", ");
  if (place) return `${title} is an official chapter event at ${place}.`;
  return `${title} is an official chapter event.`;
}

type EventSnapshot = {
  items: EventItem[];
  completeness: SnapshotCompleteness;
  url: string;
};

type EventRowInput = Omit<EventItem, "kind" | "status" | "authors" | "autoPublish" | "featured"> & {
  status?: EventItem["status"];
  autoPublish?: boolean;
};

function eventRow(partial: EventRowInput): EventItem {
  const cancelled = eventCopyMarksCancelled({
    title: partial.title,
    dek: partial.dek,
    body: partial.body,
    cancelled: partial.cancelled,
  });
  const autoPublish = cancelled ? false : (partial.autoPublish ?? false);
  return {
    ...partial,
    kind: "event",
    status: cancelled ? "review" : (partial.status ?? "review"),
    authors: [],
    autoPublish,
    featured: false,
    cancelled: cancelled || undefined,
  };
}

async function readTribePage(url: string, fetchImpl: typeof fetch): Promise<TribeEventsPage> {
  const response = await fetchUpstream({
    url,
    fetchImpl,
    maxBytes: EVENTS_MAX_BYTES,
    timeoutMs: SOURCE_TIMEOUT_MS,
    headers: { "user-agent": UA },
    allowedRedirectHosts: EVENT_REDIRECT_HOSTS,
  });
  try {
    return parseTribeEventsResponse(response.body);
  } catch (error) {
    throw new UpstreamError(
      "parser-failed",
      error instanceof Error ? error.message : "DVHIMSS calendar response was not JSON",
    );
  }
}

async function fetchDvhimssCalendarBatch(fetchImpl: typeof fetch, fetchedAt: string): Promise<EventSnapshot> {
  if (DVHIMSS_SOURCE && DVHIMSS_SOURCE.status !== "enabled") {
    throw new UpstreamError(
      DVHIMSS_SOURCE.status,
      DVHIMSS_SOURCE.reason ?? `DVHIMSS source is ${DVHIMSS_SOURCE.status}`,
    );
  }
  const startUrl = DVHIMSS_SOURCE?.url ?? DVHIMSS_FALLBACK_URL;
  const listingBase = originBase(startUrl);
  const perPage = perPageFromUrl(startUrl);
  const collected: Record<string, unknown>[] = [];
  const seenUrls = new Set<string>();
  let url = startUrl;
  let pagesFetched = 0;
  let total: number | undefined;
  let totalPages: number | undefined;
  let lastPageSize = 0;
  let hitPageCap = false;
  let laterPageFailed = false;
  let hasNext = false;
  let droppedRows = 0;
  let paginationInvalid = false;
  let lastNextRestUrl: string | undefined;
  let lastRestUrl: string | undefined;

  while (url && pagesFetched < DVHIMSS_MAX_PAGES) {
    if (seenUrls.has(url)) break;
    seenUrls.add(url);
    let page: TribeEventsPage;
    try {
      page = await readTribePage(url, fetchImpl);
    } catch (error) {
      if (pagesFetched === 0) throw error;
      laterPageFailed = true;
      break;
    }
    lastPageSize = page.events.length;
    collected.push(...page.events);
    droppedRows += page.droppedRows;
    paginationInvalid = paginationInvalid || page.paginationInvalid;
    if (page.nextRestUrl && !isSafeTribeNextUrl(page.nextRestUrl, startUrl)) paginationInvalid = true;
    if (page.restUrl && !isSafeTribeNextUrl(page.restUrl, startUrl)) paginationInvalid = true;
    lastNextRestUrl = page.nextRestUrl;
    lastRestUrl = page.restUrl;
    pagesFetched += 1;
    if (typeof page.total === "number") total = page.total;
    if (typeof page.totalPages === "number") totalPages = page.totalPages;
    const next = tribeNextPageUrl(url, page, pagesFetched, startUrl);
    if (!next) {
      hasNext = false;
      break;
    }
    hasNext = true;
    if (pagesFetched >= DVHIMSS_MAX_PAGES) {
      hitPageCap = true;
      break;
    }
    url = next;
  }

  const rows: EventItem[] = [];
  const seenIds = new Set<string>();
  let malformedCount = droppedRows;
  for (const e of collected) {
    try {
      const title = textField(e.title) || decodeHtml(String(e.title ?? ""));
      const timezone = validTimeZone(e.timezone) ? e.timezone : EVENT_TIMEZONE;
      const utcStart = typeof e.utc_start_date === "string" ? e.utc_start_date : "";
      const localStart = typeof e.start_date === "string" ? e.start_date : "";
      const start = utcStart
        ? toIso(utcStart, timezone, { assumeUtc: true })
        : toIso(localStart, timezone);
      if (!title || !start) {
        malformedCount += 1;
        continue;
      }
      const utcEnd = typeof e.utc_end_date === "string" ? e.utc_end_date : "";
      const localEnd = typeof e.end_date === "string" ? e.end_date : "";
      const end = utcEnd
        ? toIso(utcEnd, timezone, { assumeUtc: true })
        : toIso(localEnd, timezone);
      const sourceUrl = officialEventUrl(e.url, listingBase, DVHIMSS_LISTING_URL);
      const externalId = tribeRecordId(e) ?? tribeFallbackId(title, start, sourceUrl);
      if (!externalId) {
        malformedCount += 1;
        continue;
      }
      if (seenIds.has(externalId)) continue;
      seenIds.add(externalId);
      const registrationUrl = verifiedRegistrationUrl(e.website, listingBase);
      const venueObj = e.venue && typeof e.venue === "object" ? (e.venue as { venue?: string; city?: string }) : {};
      const venue = venueObj.venue ? decodeHtml(String(venueObj.venue)) : undefined;
      const city = venueObj.city ? decodeHtml(String(venueObj.city)) : undefined;
      rows.push(
        eventRow({
          id: `evt-dvhimss-${externalId}`,
          slug: publicationSlug(title),
          title,
          dek: "Official DVHIMSS chapter calendar.",
          body: officialEventBody(title, venue, city, textField(e.description ?? e.excerpt)),
          publishedAt: fetchedAt,
          updatedAt: fetchedAt,
          topics: ["chapter", "events"],
          orgs: ["org-dvhimss"],
          region: "regional",
          source: {
            kind: "ingest",
            origin: "dvhimss-events",
            url: sourceUrl,
            fetchedAt,
            externalId,
          },
          citations: [{ name: "DVHIMSS", url: sourceUrl }],
          geo: venue,
          startsAt: start,
          endsAt: end,
          timezone,
          venue,
          city,
          hostOrg: "DVHIMSS",
          registrationUrl,
          partner: "dvhimss",
          autoPublish: Boolean(registrationUrl),
          status: registrationUrl ? "published" : "review",
        }),
      );
    } catch {
      malformedCount += 1;
    }
  }
  const completeness = tribeSnapshotCompleteness({
    rawCount: collected.length,
    parsedCount: rows.length,
    pagesFetched,
    total,
    totalPages,
    hasNext,
    hitPageCap,
    laterPageFailed,
    lastPageSize,
    perPage,
    malformedCount,
    paginationInvalid,
    nextRestUrl: lastNextRestUrl,
    restUrl: lastRestUrl,
    originUrl: startUrl,
  });
  return { items: rows, completeness, url: startUrl };
}

export async function fetchDvhimssCalendar(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  return (await fetchDvhimssCalendarBatch(fetchImpl, fetchedAt)).items;
}

function njRegistrationUrl(
  event: ParsedListingEvent,
  used: string,
  pageRegistrationUrl?: string,
) {
  const eventOffers = event.offersUrl ? verifiedRegistrationUrl(event.offersUrl, used) : undefined;
  if (eventOffers && !isSameListingPage(eventOffers, used)) return eventOffers;
  if (event.key === "fall-conference" || event.key === "golf") return pageRegistrationUrl;
  return undefined;
}

function njSourceUrl(event: ParsedListingEvent, used: string) {
  const resolved = event.url ? allowlistedHttps(event.url, used, EVENT_SOURCE_HOSTS) : undefined;
  if (resolved && !isSameListingPage(resolved, used)) return resolved;
  return allowlistedHttps(used, used, EVENT_SOURCE_HOSTS) ?? NJ_LISTING_URL;
}

function njEventFields(event: ParsedListingEvent, fetchedAt: string, used: string, pageRegistrationUrl?: string): EventRowInput {
  const registrationUrl = njRegistrationUrl(event, used, pageRegistrationUrl);
  const sourceUrl = njSourceUrl(event, used);
  const listingUrl = allowlistedHttps(used, used, EVENT_SOURCE_HOSTS) ?? NJ_LISTING_URL;
  if (event.key === "fall-conference") {
    return {
      id: "evt-njdvhimss-fall-2026",
      slug: "njdvhimss-fall-conference-2026",
      title: "NJ/DVHIMSS Fall Conference 2026",
      dek: "The joint New Jersey and Delaware Valley HIMSS fall conference brings regional health-IT leaders together in Atlantic City.",
      body: readerSafeText(event.description ?? "")
        || "A three-day regional health-IT conference hosted by NJ/DVHIMSS at the Hard Rock Hotel & Casino in Atlantic City.",
      updatedAt: fetchedAt,
      topics: ["chapter", "conference"],
      orgs: ["org-njhimss", "org-dvhimss"],
      region: "NJ",
      source: { kind: "ingest", origin: "njhimss-events", url: listingUrl, fetchedAt, externalId: "njdvhimss-fall-2026" },
      citations: [{ name: "NJDVHIMSS", url: listingUrl }],
      geo: "Atlantic City, NJ",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: "America/New_York",
      venue: event.venue ?? "Hard Rock Hotel & Casino",
      city: event.city ?? "Atlantic City",
      hostOrg: "NJDVHIMSS",
      registrationUrl,
      partner: "njhimss",
    };
  }
  if (event.key === "golf") {
    return {
      id: "evt-njdvhimss-golf-2026",
      slug: "njdvhimss-annual-golf-outing-2026",
      title: "NJDVHIMSS Annual Golf Outing",
      dek: "The NJ/DVHIMSS annual golf outing opens the chapter’s fall conference program in Atlantic City.",
      body: readerSafeText(event.description ?? "")
        || "A chapter networking event held before the NJ/DVHIMSS fall conference in Atlantic City.",
      updatedAt: fetchedAt,
      topics: ["chapter", "networking"],
      orgs: ["org-njhimss"],
      region: "NJ",
      source: { kind: "ingest" as const, origin: "njhimss-events", url: listingUrl, fetchedAt, externalId: "njdvhimss-golf-2026" },
      citations: [{ name: "NJDVHIMSS", url: listingUrl }],
      geo: "Atlantic City, NJ",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: "America/New_York",
      city: event.city ?? "Atlantic City",
      hostOrg: "NJDVHIMSS",
      registrationUrl,
      partner: "njhimss",
    };
  }
  const identity = genericNjEventIdentity(event);
  return {
    id: `evt-njdvhimss-${identity}`,
    slug: publicationSlug(identity),
    title: event.title,
    dek: "Official NJ/DVHIMSS chapter event.",
    body: officialEventBody(event.title, event.venue, event.city, event.description),
    updatedAt: fetchedAt,
    topics: ["chapter", "events"],
    orgs: ["org-njhimss"],
    region: "NJ",
    source: { kind: "ingest" as const, origin: "njhimss-events", url: sourceUrl, fetchedAt, externalId: identity },
    citations: [{ name: "NJDVHIMSS", url: sourceUrl }],
    geo: [event.venue, event.city].filter(Boolean).join(", ") || undefined,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: "America/New_York",
    venue: event.venue,
    city: event.city,
    hostOrg: "NJDVHIMSS",
    registrationUrl,
    partner: "njhimss",
  };
}

async function scrapeNjdvhimssBatch(fetchImpl: typeof fetch, fetchedAt: string) {
  if (NJHIMSS_SOURCE && NJHIMSS_SOURCE.status !== "enabled") {
    throw new UpstreamError(
      NJHIMSS_SOURCE.status,
      NJHIMSS_SOURCE.reason ?? `NJDVHIMSS source is ${NJHIMSS_SOURCE.status}`,
    );
  }
  const primary = NJHIMSS_SOURCE?.url ?? "https://njdvhimssevent.com/";
  const urls = [...new Set([primary, "https://njdvhimssevent.com/", "https://njdvhimssevent.com"])];
  let html = "";
  let used = urls[0];
  let lastError: UpstreamError | undefined;
  for (const url of urls) {
    try {
      const response = await fetchUpstream({
        url,
        fetchImpl,
        maxBytes: EVENTS_MAX_BYTES,
        timeoutMs: SOURCE_TIMEOUT_MS,
        headers: { "user-agent": UA },
        allowedRedirectHosts: EVENT_REDIRECT_HOSTS,
      });
      html = response.body;
      used = url;
      break;
    } catch (error) {
      lastError = error instanceof UpstreamError
        ? error
        : new UpstreamError("upstream-failed", error instanceof Error ? error.message : String(error));
    }
  }
  if (!html) throw lastError ?? new UpstreamError("upstream-failed", "NJDVHIMSS page was unavailable");
  const parsed = parseNjdvhimssPage(html);
  const pageRegistrationUrl = verifiedNjdvhimssRegistrationUrl(html, used);
  const rows: EventItem[] = [];
  for (const event of parsed.events) {
    try {
      const fields = njEventFields(event, fetchedAt, used, pageRegistrationUrl);
      const registrationUrl = fields.registrationUrl;
      rows.push(eventRow({
        ...fields,
        source: { ...fields.source, origin: "njhimss-events" },
        autoPublish: Boolean(registrationUrl),
        status: registrationUrl ? "published" : "review",
      }));
    } catch {
      /* one malformed page event must not discard valid siblings */
    }
  }
  const recognized = isRecognizedNjdvhimssPage(html);
  const completeness = njSnapshotCompleteness({
    recognized,
    itemCount: rows.length,
    jsonLdEventCount: parsed.jsonLdEventCount,
    jsonLdMalformed: parsed.jsonLdMalformed,
    jsonLdTruncated: parsed.jsonLdTruncated,
    cardMalformed: parsed.cardMalformed,
  });
  return { items: rows, completeness, url: used };
}

export async function scrapeNjdvhimss(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  return (await scrapeNjdvhimssBatch(fetchImpl, fetchedAt)).items;
}

export async function ingestEventsWithHealth(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  sourceHealth?: ReadonlyMap<string, import("./source-health").PersistedSourceHealth>,
): Promise<IngestSourceResult<ContentItem>> {
  const fetchedAt = now.toISOString();
  const officialBackoff = sourceIsInBackoff(sourceHealth?.get("dvhimss-events"), now);
  const scrapedBackoff = sourceIsInBackoff(sourceHealth?.get("njhimss-events"), now);
  const [officialResult, scrapedResult] = await Promise.allSettled([
    officialBackoff ? Promise.resolve(undefined) : fetchDvhimssCalendarBatch(fetchImpl, fetchedAt),
    scrapedBackoff ? Promise.resolve(undefined) : scrapeNjdvhimssBatch(fetchImpl, fetchedAt),
  ]);
  const official = officialResult.status === "fulfilled" && officialResult.value ? officialResult.value.items : [];
  const scraped = scrapedResult.status === "fulfilled" && scrapedResult.value ? scrapedResult.value.items : [];
  const toNote = (
    id: string,
    origin: string,
    url: string,
    result: PromiseSettledResult<EventSnapshot | undefined>,
    prior?: import("./source-health").PersistedSourceHealth,
  ): SourceRunNote => {
    // `undefined` is the explicit result of a durable backoff skip. A rejected
    // fetch must still be classified as a real failure so the next retry and
    // alert state are advanced instead of being silently mislabeled as a
    // second backoff.
    if (result.status === "fulfilled") {
      const snapshot = result.value;
      if (!snapshot) return sourceBackoffNote(id, origin, "events", fetchedAt, prior, url);
      return sourceNote({
        id,
        origin,
        type: "events",
        state: sourceStateForItemCount(snapshot.items.length),
        checkedAt: fetchedAt,
        itemCount: snapshot.items.length,
        completeness: snapshot.completeness,
        complete: snapshot.completeness === "complete",
        url: snapshot.url,
      });
    }
    const reason = result.reason;
    const state = reason instanceof UpstreamError ? reason.code : classifyFetchError(reason);
    return sourceNote({
      id,
      origin,
      type: "events",
      state,
      checkedAt: fetchedAt,
      url,
      error: reason instanceof Error ? reason.message : String(reason),
      ...(reason instanceof UpstreamError && reason.httpStatus !== undefined ? { httpStatus: reason.httpStatus } : {}),
      consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
      lastSuccessAt: prior?.lastSuccessAt ?? null,
    });
  };
  const batch: IngestBatch = {
    adapter: "events",
    fetchedAt,
    items: [...official, ...scraped],
  };
  return {
    items: toReviewQueue(batch),
    sources: [
      toNote("dvhimss-events", "dvhimss-events", DVHIMSS_SOURCE?.url ?? "https://dvhimss.org/events-calendar", officialResult, sourceHealth?.get("dvhimss-events")),
      toNote("njhimss-events", "njhimss-events", NJHIMSS_SOURCE?.url ?? "https://njdvhimssevent.com/", scrapedResult, sourceHealth?.get("njhimss-events")),
    ],
  };
}

export async function ingestEvents(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  return (await ingestEventsWithHealth(now, fetchImpl)).items;
}
