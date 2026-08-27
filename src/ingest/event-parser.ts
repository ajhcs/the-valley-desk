import type { SnapshotCompleteness } from "./source-health";

/** Hard cap on Tribe archive pages. A truncated walk is always a partial snapshot. */
export const DVHIMSS_MAX_PAGES = 5;
export const DVHIMSS_DEFAULT_PER_PAGE = 100;

const EVENT_TYPES = new Set([
  "event",
  "businessevent",
  "educationevent",
  "socialevent",
  "sportsevent",
  "exhibitionevent",
  "festival",
]);

const CARD_CLASS = /event-card|event-item|h-event|tribe-events-calendar-list__event/i;
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_TEXT = new RegExp(
  `\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}\\b`,
  "i",
);
const DATE_RANGE = new RegExp(
  `(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})(?:\\s*(?:--|–|—|through|to|-|and)\\s*)(?:(${MONTH})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(\\d{4}))?`,
  "i",
);

export type TribeEventsPage = {
  events: Record<string, unknown>[];
  total?: number;
  totalPages?: number;
  nextRestUrl?: string;
  restUrl?: string;
};

export type ParsedListingEvent = {
  key: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  venue?: string;
  city?: string;
  description?: string;
  url?: string;
  offersUrl?: string;
};

export function decodeHtml(value: string) {
  return value
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

export function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "event";
}

export function toIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  const asUtc = Date.parse(trimmed.replace(" ", "T") + "Z");
  if (Number.isFinite(asUtc)) return new Date(asUtc).toISOString();
  const local = Date.parse(trimmed);
  return Number.isFinite(local) ? new Date(local).toISOString() : undefined;
}

export function perPageFromUrl(url: string, fallback = DVHIMSS_DEFAULT_PER_PAGE) {
  try {
    const value = Number(new URL(url).searchParams.get("per_page"));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    /* use fallback */
  }
  return fallback;
}

function optionalNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function optionalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return decodeHtml(value.trim());
}

export function parseTribeEventsResponse(body: string): TribeEventsPage {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("DVHIMSS calendar response was not JSON");
  }
  if (!Array.isArray(data.events)) {
    throw new Error("DVHIMSS calendar response omitted events");
  }
  return {
    events: data.events.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"),
    total: optionalNumber(data.total),
    totalPages: optionalNumber(data.total_pages),
    nextRestUrl: optionalUrl(data.next_rest_url),
    restUrl: optionalUrl(data.rest_url),
  };
}

function tribeArchivePath(pathname: string) {
  return pathname.replace(/\/+$/, "").toLowerCase();
}

export function isSafeTribeNextUrl(candidate: string, originUrl: string) {
  try {
    const next = new URL(candidate);
    const origin = new URL(originUrl);
    return next.protocol === "https:"
      && next.hostname.toLowerCase() === origin.hostname.toLowerCase()
      && tribeArchivePath(next.pathname) === "/wp-json/tribe/events/v1/events";
  } catch {
    return false;
  }
}

export function withQueryPage(url: string, page: number) {
  const next = new URL(url);
  next.searchParams.set("page", String(page));
  return next.href;
}

export function tribeNextPageUrl(
  currentUrl: string,
  page: TribeEventsPage,
  pagesFetched: number,
  originUrl: string,
): string | undefined {
  if (page.nextRestUrl && isSafeTribeNextUrl(page.nextRestUrl, originUrl)) {
    return page.nextRestUrl;
  }
  if (typeof page.totalPages === "number" && pagesFetched < page.totalPages) {
    const next = withQueryPage(currentUrl, pagesFetched + 1);
    return isSafeTribeNextUrl(next, originUrl) ? next : undefined;
  }
  return undefined;
}

export function tribeSnapshotCompleteness(input: {
  rawCount: number;
  parsedCount: number;
  pagesFetched: number;
  totalPages?: number;
  hasNext: boolean;
  hitPageCap: boolean;
  laterPageFailed: boolean;
  lastPageSize: number;
  perPage: number;
}): SnapshotCompleteness {
  if (input.rawCount === 0) return "empty-unverified";
  if (input.parsedCount === 0) return "partial";
  if (input.laterPageFailed || input.hitPageCap || input.hasNext) return "partial";
  if (typeof input.totalPages === "number") {
    return input.pagesFetched >= input.totalPages ? "complete" : "partial";
  }
  if (input.lastPageSize >= input.perPage) return "partial";
  return "complete";
}

function typeNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/^schema:/i, "").split("/").pop()!.toLowerCase());
}

function isEventType(value: unknown) {
  return typeNames(value).some((name) => EVENT_TYPES.has(name));
}

function jsonLdString(value: unknown): string {
  if (typeof value === "string") return decodeHtml(value);
  if (Array.isArray(value)) return jsonLdString(value[0]);
  if (value && typeof value === "object" && "@value" in value) {
    return jsonLdString((value as { "@value": unknown })["@value"]);
  }
  return "";
}

function placeFromJsonLd(location: unknown): { venue?: string; city?: string } {
  if (Array.isArray(location)) return placeFromJsonLd(location[0]);
  if (typeof location === "string") {
    const parts = stripHtml(location).split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { venue: parts[0], city: parts[parts.length - 1] };
    return { city: parts[0] };
  }
  if (!location || typeof location !== "object") return {};
  const loc = location as Record<string, unknown>;
  const venue = jsonLdString(loc.name) || undefined;
  const address = loc.address;
  let city: string | undefined;
  if (typeof address === "string") {
    const parts = stripHtml(address).split(",").map((part) => part.trim()).filter(Boolean);
    city = parts[0];
  } else if (address && typeof address === "object") {
    const addr = address as Record<string, unknown>;
    city = jsonLdString(addr.addressLocality) || jsonLdString(addr.addressRegion) || undefined;
  }
  return { venue, city };
}

function offersUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = offersUrl(entry);
      if (url) return url;
    }
    return undefined;
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : undefined;
  }
  return undefined;
}

export function classifyNjEventKey(title: string) {
  const normalized = title.toLowerCase();
  if (/\bgolf\b/.test(normalized)) return "golf";
  if (/fall conference/.test(normalized) || (/nj\s*\/\s*dvhimss/.test(normalized) && /conference/.test(normalized))) {
    return "fall-conference";
  }
  return `generic:${slugify(title)}`;
}

function listingEvent(partial: Omit<ParsedListingEvent, "key"> & { key?: string }): ParsedListingEvent | undefined {
  const title = stripHtml(partial.title);
  const startsAt = toIso(partial.startsAt) ?? (partial.startsAt.includes("T") ? partial.startsAt : undefined);
  if (!title || !startsAt) return undefined;
  return {
    key: partial.key ?? classifyNjEventKey(title),
    title,
    startsAt,
    endsAt: partial.endsAt ? toIso(partial.endsAt) ?? partial.endsAt : undefined,
    venue: partial.venue,
    city: partial.city,
    description: partial.description ? stripHtml(partial.description) : undefined,
    url: partial.url,
    offersUrl: partial.offersUrl,
  };
}

function eventFromJsonLd(node: Record<string, unknown>): ParsedListingEvent | undefined {
  const title = jsonLdString(node.name || node.headline);
  const startsAt = jsonLdString(node.startDate);
  if (!title || !startsAt) return undefined;
  const place = placeFromJsonLd(node.location);
  return listingEvent({
    title,
    startsAt,
    endsAt: jsonLdString(node.endDate) || undefined,
    venue: place.venue,
    city: place.city,
    description: jsonLdString(node.description) || undefined,
    url: jsonLdString(node.url) || undefined,
    offersUrl: offersUrl(node.offers),
  });
}

function parseJsonLdDocument(raw: string): unknown {
  const trimmed = raw.trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(decodeHtml(trimmed));
    } catch {
      return undefined;
    }
  }
}

export function parseJsonLdEvents(html: string): {
  events: ParsedListingEvent[];
  nodeCount: number;
  malformed: number;
} {
  const events: ParsedListingEvent[] = [];
  const stats = { nodeCount: 0, malformed: 0 };
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj["@graph"]) walk(obj["@graph"]);
    if (obj.itemListElement) walk(obj.itemListElement);
    if (obj.item) walk(obj.item);
    if (obj.subEvent) walk(obj.subEvent);
    if (obj.subEvents) walk(obj.subEvents);
    if (isEventType(obj["@type"])) {
      stats.nodeCount += 1;
      const parsed = eventFromJsonLd(obj);
      if (parsed) events.push(parsed);
      else stats.malformed += 1;
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1] ?? "";
    const doc = parseJsonLdDocument(raw);
    if (doc === undefined) {
      if (/"@type"\s*:\s*"[^"]*Event/i.test(raw)) {
        stats.nodeCount += 1;
        stats.malformed += 1;
      }
      continue;
    }
    walk(doc);
  }
  return { events, nodeCount: stats.nodeCount, malformed: stats.malformed };
}

function firstHref(html: string): string | undefined {
  const match = /href=["']([^"']+)["']/i.exec(html);
  return match ? decodeHtml(match[1]) : undefined;
}

function firstHeading(html: string): string {
  const match = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(html)
    || /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  return match ? stripHtml(match[1]) : "";
}

function datetimeFrom(html: string): { start?: string; end?: string } {
  const time = /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i.exec(html);
  if (time?.[1]) return { start: time[1] };
  const range = DATE_RANGE.exec(html);
  if (range) {
    const start = `${range[1]} ${range[2]}, ${range[3]}`;
    const endMonth = range[4] || range[1];
    const endYear = range[6] || range[3];
    return { start, end: `${endMonth} ${range[5]}, ${endYear}` };
  }
  const single = DATE_TEXT.exec(html);
  return single ? { start: single[0] } : {};
}

function parseEventWindow(windowHtml: string): ParsedListingEvent | undefined {
  const title = firstHeading(windowHtml);
  const dates = datetimeFrom(windowHtml);
  const href = firstHref(windowHtml);
  return listingEvent({
    title,
    startsAt: dates.start ?? "",
    endsAt: dates.end,
    url: href,
    offersUrl: href,
  });
}

export function parseVisibleEventCards(html: string): {
  events: ParsedListingEvent[];
  malformed: number;
} {
  const events: ParsedListingEvent[] = [];
  let malformed = 0;
  const open = /<(article|div|li|section)\b([^>]*class=["'][^"']*["'][^>]*)>/gi;
  for (const match of html.matchAll(open)) {
    const attrs = match[2] ?? "";
    if (!CARD_CLASS.test(attrs)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const windowHtml = html.slice(start, start + 3500);
    const parsed = parseEventWindow(windowHtml);
    if (parsed) events.push(parsed);
    else malformed += 1;
  }
  const timeRe = /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(timeRe)) {
    const iso = match[1] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) continue;
    const index = match.index ?? 0;
    const lookbehind = html.slice(Math.max(0, index - 800), index + 400);
    if (CARD_CLASS.test(lookbehind)) continue;
    const heading = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(lookbehind)
      || /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(lookbehind);
    if (!heading) continue;
    const title = stripHtml(heading[2] ?? heading[1] ?? "");
    const href = heading[1]?.startsWith("http") ? heading[1] : firstHref(lookbehind);
    const parsed = listingEvent({ title, startsAt: iso, url: href, offersUrl: href });
    if (parsed && !events.some((event) => event.key === parsed.key)) events.push(parsed);
  }
  return { events, malformed };
}

export function matchKnownNjdvhimssEvents(html: string): ParsedListingEvent[] {
  const events: ParsedListingEvent[] = [];
  const conference = /October\s+13,\s+2026[\s\S]{0,80}October\s+15,\s+2026|Tuesday,\s+October\s+13,\s+2026/i.test(html)
    || (/fall conference/i.test(html) && /October\s+13/i.test(html) && /October\s+15/i.test(html));
  if (conference) {
    events.push({
      key: "fall-conference",
      title: "NJ/DVHIMSS Fall Conference 2026",
      startsAt: "2026-10-13T20:30:00.000Z",
      endsAt: "2026-10-15T15:30:00.000Z",
      venue: "Hard Rock Hotel & Casino",
      city: "Atlantic City",
    });
  }
  if (/Golf/i.test(html) && /October\s+13/i.test(html)) {
    events.push({
      key: "golf",
      title: "NJDVHIMSS Annual Golf Outing",
      startsAt: "2026-10-13T13:30:00.000Z",
      endsAt: "2026-10-13T19:30:00.000Z",
      city: "Atlantic City",
    });
  }
  return events;
}

export function mergeListingEvents(preferred: ParsedListingEvent[], fallback: ParsedListingEvent[]) {
  const byKey = new Map<string, ParsedListingEvent>();
  for (const event of [...preferred, ...fallback]) {
    if (!byKey.has(event.key)) byKey.set(event.key, event);
  }
  return [...byKey.values()];
}

export function parseNjdvhimssPage(html: string): {
  events: ParsedListingEvent[];
  jsonLdEventCount: number;
  jsonLdMalformed: number;
  cardMalformed: number;
} {
  const jsonLd = parseJsonLdEvents(html);
  const cards = parseVisibleEventCards(html);
  const known = matchKnownNjdvhimssEvents(html);
  return {
    events: mergeListingEvents([...jsonLd.events, ...cards.events], known),
    jsonLdEventCount: jsonLd.nodeCount,
    jsonLdMalformed: jsonLd.malformed,
    cardMalformed: cards.malformed,
  };
}

export function njSnapshotCompleteness(input: {
  recognized: boolean;
  itemCount: number;
  jsonLdEventCount: number;
  jsonLdMalformed: number;
}): SnapshotCompleteness {
  if (!input.recognized) return "partial";
  if (input.jsonLdEventCount > 0 && input.jsonLdMalformed > 0) return "partial";
  if (input.itemCount === 0) return "empty-unverified";
  if (input.jsonLdEventCount > 0) return "complete";
  return input.itemCount < 2 ? "partial" : "complete";
}
