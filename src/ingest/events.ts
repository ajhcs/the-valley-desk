import type { ContentItem, EventItem } from "../content/schema";
import { eventCopyMarksCancelled } from "../lib/calendar";
import { hasInternalProcessLanguage } from "../lib/editorialCopy";
import type { IngestBatch } from "./envelope";
import { toReviewQueue } from "./envelope";
import type { IngestSourceResult, SnapshotCompleteness, SourceRunNote } from "./source-health";

const UA = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";
const SOURCE_TIMEOUT_MS = 12_000;
const REGISTRATION_HOSTS = ["cvent.me", "web.cvent.com", "dvhimss.org", "njhimss.org", "njdvhimssevent.com"];

function decode(value: string) {
  return value
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "event";
}

function toIso(value: string) {
  const t = Date.parse(value.replace(" ", "T") + (value.includes("Z") || value.includes("+") ? "" : "Z"));
  if (Number.isFinite(t)) return new Date(t).toISOString();
  const local = Date.parse(value);
  return Number.isFinite(local) ? new Date(local).toISOString() : undefined;
}

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

function verifiedNjdvhimssRegistrationUrl(html: string) {
  const urls = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decode(match[1]))
    .map((value) => verifiedRegistrationUrl(value))
    .filter((value): value is string => Boolean(value));
  return urls.find((value) => {
    const host = new URL(value).hostname.toLowerCase();
    return host === "cvent.me" || host === "web.cvent.com";
  });
}

function isRecognizedNjdvhimssPage(html: string) {
  return /<title[^>]*>\s*NJDVHIMSS\s*<\/title>/i.test(html)
    && /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/njdvhimssevent\.com\/?["']/i.test(html);
}

function stripHtml(value: string) {
  return decode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
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

function eventRow(partial: Omit<EventItem, "kind" | "status" | "authors" | "autoPublish" | "featured"> & {
  status?: EventItem["status"];
  autoPublish?: boolean;
}): EventItem {
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

async function fetchDvhimssCalendarBatch(fetchImpl: typeof fetch, fetchedAt: string): Promise<EventSnapshot> {
  const url = "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=100";
  const res = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`DVHIMSS calendar returned HTTP ${res.status}`);
  const data = (await res.json()) as { events?: Record<string, unknown>[] };
  if (!Array.isArray(data.events)) throw new Error("DVHIMSS calendar response omitted events");
  const rows: EventItem[] = [];
  for (const e of data.events) {
    const title = decode(String(e.title ?? ""));
    const page = String(e.url ?? "https://dvhimss.org/events-calendar");
    const start = toIso(String(e.utc_start_date ?? e.start_date ?? ""));
    if (!title || !start) continue;
    const end = toIso(String(e.utc_end_date ?? e.end_date ?? ""));
    const registrationUrl = verifiedRegistrationUrl(e.website);
    const venueObj = e.venue && typeof e.venue === "object" ? (e.venue as { venue?: string; city?: string }) : {};
    const venue = venueObj.venue ? decode(String(venueObj.venue)) : undefined;
    const city = venueObj.city ? decode(String(venueObj.city)) : undefined;
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
  }
  const completeness: SnapshotCompleteness = data.events.length === 0
    ? "empty-unverified"
    : rows.length === 0 || data.events.length >= 100
      ? "partial"
      : "complete";
  return { items: rows, completeness, url };
}

export async function fetchDvhimssCalendar(fetchImpl: typeof fetch = fetch, fetchedAt = new Date().toISOString()) {
  return (await fetchDvhimssCalendarBatch(fetchImpl, fetchedAt)).items;
}

async function scrapeNjdvhimssBatch(fetchImpl: typeof fetch, fetchedAt: string) {
  const urls = ["https://njdvhimssevent.com/", "https://njdvhimssevent.com"];
  let html = "";
  let used = urls[0];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
      if (res.ok) {
        html = await res.text();
        used = url;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!html) throw new Error("NJDVHIMSS page was unavailable");
  const rows: EventItem[] = [];
  const registrationUrl = verifiedNjdvhimssRegistrationUrl(html);
  const conference = /October\s+13,\s+2026[\s\S]{0,80}October\s+15,\s+2026|Tuesday,\s+October\s+13,\s+2026/i.test(html);
  if (conference) {
    rows.push(
      eventRow({
        id: "evt-njdvhimss-fall-2026",
        slug: "njdvhimss-fall-conference-2026",
        title: "NJ/DVHIMSS Fall Conference 2026",
        dek: "The joint New Jersey and Delaware Valley HIMSS fall conference brings regional health-IT leaders together in Atlantic City.",
        body: "A three-day regional health-IT conference hosted by NJ/DVHIMSS at the Hard Rock Hotel & Casino in Atlantic City.",
        updatedAt: fetchedAt,
        topics: ["chapter", "conference"],
        orgs: ["org-njhimss", "org-dvhimss"],
        region: "NJ",
        source: {
          kind: "ingest",
          origin: "njhimss-events",
          url: used,
          fetchedAt,
          externalId: "njdvhimss-fall-2026",
        },
        citations: [{ name: "NJDVHIMSS", url: used }],
        geo: "Atlantic City, NJ",
        startsAt: "2026-10-13T20:30:00.000Z",
        endsAt: "2026-10-15T15:30:00.000Z",
        timezone: "America/New_York",
        venue: "Hard Rock Hotel & Casino",
        city: "Atlantic City",
        hostOrg: "NJDVHIMSS",
        registrationUrl,
        partner: "njhimss",
        autoPublish: Boolean(registrationUrl),
        status: registrationUrl ? "published" : "review",
      }),
    );
  }
  if (/Golf/i.test(html) && /October\s+13/i.test(html)) {
    rows.push(
      eventRow({
        id: "evt-njdvhimss-golf-2026",
        slug: "njdvhimss-annual-golf-outing-2026",
        title: "NJDVHIMSS Annual Golf Outing",
        dek: "The NJ/DVHIMSS annual golf outing opens the chapter’s fall conference program in Atlantic City.",
        body: "A chapter networking event held before the NJ/DVHIMSS fall conference in Atlantic City.",
        updatedAt: fetchedAt,
        topics: ["chapter", "networking"],
        orgs: ["org-njhimss"],
        region: "NJ",
        source: {
          kind: "ingest",
          origin: "njhimss-events",
          url: used,
          fetchedAt,
          externalId: "njdvhimss-golf-2026",
        },
        citations: [{ name: "NJDVHIMSS", url: used }],
        geo: "Atlantic City, NJ",
        startsAt: "2026-10-13T13:30:00.000Z",
        endsAt: "2026-10-13T19:30:00.000Z",
        timezone: "America/New_York",
        city: "Atlantic City",
        hostOrg: "NJDVHIMSS",
        registrationUrl,
        partner: "njhimss",
        autoPublish: Boolean(registrationUrl),
        status: registrationUrl ? "published" : "review",
      }),
    );
  }
  const recognized = isRecognizedNjdvhimssPage(html);
  const completeness: SnapshotCompleteness = !recognized
    ? "partial"
    : rows.length === 0
      ? "empty-unverified"
      : "complete";
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
  const sourceNote = (
    id: string,
    origin: string,
    url: string,
    result: PromiseSettledResult<EventSnapshot>,
  ): SourceRunNote => result.status === "fulfilled" ? {
    id,
    origin,
    type: "events",
    state: "success",
    checkedAt: fetchedAt,
    itemCount: result.value.items.length,
    completeness: result.value.completeness,
    complete: result.value.completeness === "complete",
    url: result.value.url,
  } : {
    id,
    origin,
    type: "events",
    state: "error",
    checkedAt: fetchedAt,
    itemCount: 0,
    completeness: "partial",
    complete: false,
    url,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
  const batch: IngestBatch = {
    adapter: "events",
    fetchedAt,
    items: [...official, ...scraped],
  };
  return {
    items: toReviewQueue(batch),
    sources: [
      sourceNote("dvhimss-events", "dvhimss-events", "https://dvhimss.org/events-calendar", officialResult),
      sourceNote("njhimss-events", "njhimss-events", "https://njdvhimssevent.com/", scrapedResult),
    ],
  };
}

export async function ingestEvents(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<ContentItem[]> {
  return (await ingestEventsWithHealth(now, fetchImpl)).items;
}
