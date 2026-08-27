import type { ContentItem, EventItem } from "../content/schema";
import { eventCopyMarksCancelled } from "../lib/calendar";
import { hasInternalProcessLanguage } from "../lib/editorialCopy";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import {
  DVHIMSS_MAX_PAGES,
  decodeHtml,
  njSnapshotCompleteness,
  parseNjdvhimssPage,
  parseTribeEventsResponse,
  perPageFromUrl,
  slugify,
  stripHtml,
  toIso,
  tribeNextPageUrl,
  tribeSnapshotCompleteness,
  type ParsedListingEvent,
  type TribeEventsPage,
} from "./event-parser";
import { eventSourceById } from "./origins";
import {
  classifyFetchError,
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
const REGISTRATION_HOSTS = ["cvent.me", "web.cvent.com", "dvhimss.org", "njhimss.org", "njdvhimssevent.com"];
const DVHIMSS_SOURCE = eventSourceById("dvhimss-events");
const NJHIMSS_SOURCE = eventSourceById("njhimss-events");
const DVHIMSS_FALLBACK_URL = "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=100";

function verifiedRegistrationUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && REGISTRATION_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function isCventHost(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "cvent.me" || host === "web.cvent.com";
  } catch {
    return false;
  }
}

function verifiedNjdvhimssRegistrationUrl(html: string) {
  const urls = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]))
    .map((value) => verifiedRegistrationUrl(value))
    .filter((value): value is string => Boolean(value));
  return urls.find((value) => isCventHost(value));
}

function isRecognizedNjdvhimssPage(html: string) {
  return /<title[^>]*>\s*NJDVHIMSS\s*<\/title>/i.test(html)
    && /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/njdvhimssevent\.com\/?["']/i.test(html);
}

function textField(value: unknown): string {
  if (typeof value === "string") return stripHtml(value);
  if (value && typeof value === "object" && "rendered" in value) {
    const rendered = (value as { rendered?: unknown }).rendered;
    if (typeof rendered === "string") return stripHtml(rendered);
  }
  return "";
}

function readerSafeText(value: string) {
  const text = value.trim();
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
  const perPage = perPageFromUrl(startUrl);
  const collected: Record<string, unknown>[] = [];
  const seenUrls = new Set<string>();
  let url = startUrl;
  let pagesFetched = 0;
  let totalPages: number | undefined;
  let lastPageSize = 0;
  let hitPageCap = false;
  let laterPageFailed = false;
  let hasNext = false;

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
    pagesFetched += 1;
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
  for (const e of collected) {
    try {
      const externalId = String(e.id ?? "");
      if (externalId) {
        if (seenIds.has(externalId)) continue;
        seenIds.add(externalId);
      }
      const title = decodeHtml(String(e.title ?? ""));
      const page = String(e.url ?? "https://dvhimss.org/events-calendar");
      const start = toIso(String(e.utc_start_date ?? e.start_date ?? ""));
      if (!title || !start) continue;
      const end = toIso(String(e.utc_end_date ?? e.end_date ?? ""));
      const registrationUrl = verifiedRegistrationUrl(e.website);
      const venueObj = e.venue && typeof e.venue === "object" ? (e.venue as { venue?: string; city?: string }) : {};
      const venue = venueObj.venue ? decodeHtml(String(venueObj.venue)) : undefined;
      const city = venueObj.city ? decodeHtml(String(venueObj.city)) : undefined;
      rows.push(
        eventRow({
          id: `evt-dvhimss-${e.id}`,
          slug: slugify(title),
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
            url: page,
            fetchedAt,
            externalId: String(e.id),
          },
          citations: [{ name: "DVHIMSS", url: page }],
          geo: venue,
          startsAt: start,
          endsAt: end,
          timezone: String(e.timezone ?? "America/New_York"),
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
      /* one malformed calendar row must not discard valid siblings */
    }
  }
  const completeness = tribeSnapshotCompleteness({
    rawCount: collected.length,
    parsedCount: rows.length,
    pagesFetched,
    totalPages,
    hasNext,
    hitPageCap,
    laterPageFailed,
    lastPageSize,
    perPage,
  });
  return { items: rows, completeness, url: startUrl };
}

export async function fetchDvhimssCalendar(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  return (await fetchDvhimssCalendarBatch(fetchImpl, fetchedAt)).items;
}

function njRegistrationUrl(event: ParsedListingEvent, pageRegistrationUrl?: string) {
  const fromEvent = event.offersUrl ? verifiedRegistrationUrl(event.offersUrl) : undefined;
  if (fromEvent && isCventHost(fromEvent)) return fromEvent;
  return pageRegistrationUrl;
}

function njEventFields(event: ParsedListingEvent, fetchedAt: string, used: string, pageRegistrationUrl?: string): EventRowInput {
  const registrationUrl = njRegistrationUrl(event, pageRegistrationUrl);
  const sourceUrl = event.url && event.url.startsWith("https://") ? event.url : used;
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
      source: { kind: "ingest", origin: "njhimss-events", url: used, fetchedAt, externalId: "njdvhimss-fall-2026" },
      citations: [{ name: "NJDVHIMSS", url: used }],
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
      source: { kind: "ingest" as const, origin: "njhimss-events", url: used, fetchedAt, externalId: "njdvhimss-golf-2026" },
      citations: [{ name: "NJDVHIMSS", url: used }],
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
  return {
    id: `evt-njdvhimss-${slugify(event.title)}-${event.startsAt.slice(0, 10)}`,
    slug: slugify(event.title),
    title: event.title,
    dek: "Official NJ/DVHIMSS chapter event.",
    body: officialEventBody(event.title, event.venue, event.city, event.description),
    updatedAt: fetchedAt,
    topics: ["chapter", "events"],
    orgs: ["org-njhimss"],
    region: "NJ",
    source: { kind: "ingest" as const, origin: "njhimss-events", url: sourceUrl, fetchedAt, externalId: slugify(event.title) },
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
  const pageRegistrationUrl = verifiedNjdvhimssRegistrationUrl(html);
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
  });
  return { items: rows, completeness, url: used };
}

export async function scrapeNjdvhimss(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  return (await scrapeNjdvhimssBatch(fetchImpl, fetchedAt)).items;
}

export async function ingestEventsWithHealth(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<IngestSourceResult<ContentItem>> {
  const fetchedAt = now.toISOString();
  const [officialResult, scrapedResult] = await Promise.allSettled([
    fetchDvhimssCalendarBatch(fetchImpl, fetchedAt),
    scrapeNjdvhimssBatch(fetchImpl, fetchedAt),
  ]);
  const official = officialResult.status === "fulfilled" ? officialResult.value.items : [];
  const scraped = scrapedResult.status === "fulfilled" ? scrapedResult.value.items : [];
  const toNote = (
    id: string,
    origin: string,
    url: string,
    result: PromiseSettledResult<EventSnapshot>,
  ): SourceRunNote => {
    if (result.status === "fulfilled") {
      return sourceNote({
        id,
        origin,
        type: "events",
        state: sourceStateForItemCount(result.value.items.length),
        checkedAt: fetchedAt,
        itemCount: result.value.items.length,
        completeness: result.value.completeness,
        complete: result.value.completeness === "complete",
        url: result.value.url,
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
      toNote("dvhimss-events", "dvhimss-events", DVHIMSS_SOURCE?.url ?? "https://dvhimss.org/events-calendar", officialResult),
      toNote("njhimss-events", "njhimss-events", NJHIMSS_SOURCE?.url ?? "https://njdvhimssevent.com/", scrapedResult),
    ],
  };
}

export async function ingestEvents(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  return (await ingestEventsWithHealth(now, fetchImpl)).items;
}
