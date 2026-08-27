import type { SnapshotCompleteness } from "./source-health";

/** Hard cap on Tribe archive pages. A truncated walk is always a partial snapshot. */
export const DVHIMSS_MAX_PAGES = 5;
export const DVHIMSS_DEFAULT_PER_PAGE = 100;
export const EVENT_TIMEZONE = "America/New_York";
export const EVENT_SOURCE_HOSTS = ["dvhimss.org", "njhimss.org", "njdvhimssevent.com"];
export const REGISTRATION_HOSTS = ["cvent.me", "web.cvent.com", ...EVENT_SOURCE_HOSTS];
export const FALL_CONFERENCE_START = "2026-10-13";
export const FALL_CONFERENCE_END = "2026-10-15";
export const GOLF_OUTING_DATE = "2026-10-13";

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
const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const DATE_TEXT = new RegExp(
  `\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}\\b`,
  "i",
);
const DATE_RANGE = new RegExp(
  `(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})(?:\\s*(?:--|–|—|through|to|-|and)\\s*)(?:(${MONTH})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(\\d{4}))?`,
  "i",
);
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const MONTH_NAME_DATE = new RegExp(
  `^(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})$`,
  "i",
);

export type TribeEventsPage = {
  events: Record<string, unknown>[];
  total?: number;
  totalPages?: number;
  nextRestUrl?: string;
  restUrl?: string;
  droppedRows: number;
  paginationInvalid: boolean;
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

function wallParts(date: Date, timeZone: string) {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

export function wallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  if (!Number.isInteger(year) || year < 1970 || year > 2100
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > 31
    || !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59
    || !Number.isInteger(second) || second < 0 || second > 59) return undefined;
  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute
    || roundTrip.getUTCSeconds() !== second) return undefined;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const seen = wallParts(guess, timeZone);
  const asUtc = Date.UTC(
    Number(seen.year),
    Number(seen.month) - 1,
    Number(seen.day),
    Number(seen.hour),
    Number(seen.minute),
    Number(seen.second),
  );
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(guess.getTime() - (asUtc - wanted)).toISOString();
}

export function civilDate(iso: string, timeZone = EVENT_TIMEZONE): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return undefined;
  const seen = wallParts(new Date(parsed), timeZone);
  return `${seen.year}-${seen.month}-${seen.day}`;
}

export function toIso(
  value: string,
  timeZone = EVENT_TIMEZONE,
  options: { assumeUtc?: boolean } = {},
) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const monthName = MONTH_NAME_DATE.exec(trimmed);
  if (monthName) {
    const month = MONTH_INDEX[monthName[1]!.toLowerCase()];
    const day = Number(monthName[2]);
    const year = Number(monthName[3]);
    if (!month || !Number.isInteger(day) || !Number.isInteger(year)) return undefined;
    if (options.assumeUtc) return new Date(Date.UTC(year, month - 1, day)).toISOString();
    return wallTimeToIso(year, month, day, 0, 0, 0, timeZone);
  }

  const iso = ISO_LIKE.exec(trimmed);
  if (!iso) {
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
    }
    return undefined;
  }

  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = Number(iso[3]);
  const hour = iso[4] === undefined ? undefined : Number(iso[4]);
  const minute = iso[5] === undefined ? undefined : Number(iso[5]);
  const second = iso[6] === undefined ? 0 : Number(iso[6]);
  const offset = iso[7];
  if (offset) {
    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (hour === undefined) {
    if (options.assumeUtc) return new Date(Date.UTC(year, month - 1, day)).toISOString();
    return wallTimeToIso(year, month, day, 0, 0, 0, timeZone);
  }
  if (options.assumeUtc) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute ?? 0, second)).toISOString();
  }
  return wallTimeToIso(year, month, day, hour, minute ?? 0, second, timeZone);
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

function paginationFieldInvalid(present: boolean, value: number | undefined, opts: { integer?: boolean; min: number }) {
  if (!present) return false;
  if (value === undefined) return true;
  if (opts.integer !== false && !Number.isInteger(value)) return true;
  return value < opts.min;
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
  const events = data.events.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  const totalPresent = Object.prototype.hasOwnProperty.call(data, "total");
  const totalPagesPresent = Object.prototype.hasOwnProperty.call(data, "total_pages");
  const total = optionalNumber(data.total);
  const totalPages = optionalNumber(data.total_pages);
  const paginationInvalid = paginationFieldInvalid(totalPresent, total, { min: 0 })
    || paginationFieldInvalid(totalPagesPresent, totalPages, { min: 1 });
  return {
    events,
    total: total !== undefined && Number.isInteger(total) && total >= 0 ? total : undefined,
    totalPages: totalPages !== undefined && Number.isInteger(totalPages) && totalPages > 0 ? totalPages : undefined,
    nextRestUrl: optionalUrl(data.next_rest_url),
    restUrl: optionalUrl(data.rest_url),
    droppedRows: data.events.length - events.length,
    paginationInvalid,
  };
}

function tribeArchivePath(pathname: string) {
  return pathname.replace(/\/+$/, "").toLowerCase();
}

export function isSafeTribeNextUrl(candidate: string, originUrl: string) {
  try {
    const next = new URL(candidate, originUrl);
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
    return new URL(page.nextRestUrl, originUrl).href;
  }
  if (typeof page.totalPages === "number" && pagesFetched < page.totalPages) {
    const next = withQueryPage(currentUrl, pagesFetched + 1);
    return isSafeTribeNextUrl(next, originUrl) ? next : undefined;
  }
  return undefined;
}

export function tribePaginationUnusable(input: {
  paginationInvalid?: boolean;
  nextRestUrl?: string;
  restUrl?: string;
  originUrl: string;
  total?: number;
  rawCount: number;
  hasNext: boolean;
  hitPageCap: boolean;
  laterPageFailed: boolean;
}) {
  if (input.paginationInvalid) return true;
  if (input.nextRestUrl && !isSafeTribeNextUrl(input.nextRestUrl, input.originUrl)) return true;
  if (input.restUrl && !isSafeTribeNextUrl(input.restUrl, input.originUrl)) return true;
  if (typeof input.total === "number" && input.total > input.rawCount && !input.hasNext && !input.hitPageCap && !input.laterPageFailed) {
    return true;
  }
  return false;
}

export function tribeSnapshotCompleteness(input: {
  rawCount: number;
  parsedCount: number;
  pagesFetched: number;
  total?: number;
  totalPages?: number;
  hasNext: boolean;
  hitPageCap: boolean;
  laterPageFailed: boolean;
  lastPageSize: number;
  perPage: number;
  malformedCount?: number;
  paginationInvalid?: boolean;
  nextRestUrl?: string;
  restUrl?: string;
  originUrl?: string;
}): SnapshotCompleteness {
  if (input.rawCount === 0 && (input.malformedCount ?? 0) === 0) return "empty-unverified";
  if (input.parsedCount === 0) return "partial";
  if ((input.malformedCount ?? 0) > 0) return "partial";
  if (input.laterPageFailed || input.hitPageCap || input.hasNext) return "partial";
  if (
    input.originUrl
    && tribePaginationUnusable({
      paginationInvalid: input.paginationInvalid,
      nextRestUrl: input.nextRestUrl,
      restUrl: input.restUrl,
      originUrl: input.originUrl,
      total: input.total,
      rawCount: input.rawCount,
      hasNext: input.hasNext,
      hitPageCap: input.hitPageCap,
      laterPageFailed: input.laterPageFailed,
    })
  ) {
    return "partial";
  }
  if (input.paginationInvalid) return "partial";
  if (typeof input.totalPages === "number") {
    return input.pagesFetched >= input.totalPages ? "complete" : "partial";
  }
  if (input.lastPageSize >= input.perPage) return "partial";
  return "complete";
}

export function hostAllowed(hostname: string, hosts: string[]) {
  const host = hostname.toLowerCase();
  return hosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function resolveAgainst(value: string | undefined, base: string): URL | undefined {
  if (!value || !value.trim()) return undefined;
  const trimmed = decodeHtml(value.trim());
  try {
    if (/^https:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      return url.protocol === "https:" ? url : undefined;
    }
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      const url = new URL(trimmed, base);
      return url.protocol === "https:" ? url : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function allowlistedHttps(value: string | undefined, base: string, hosts = EVENT_SOURCE_HOSTS): string | undefined {
  const url = resolveAgainst(value, base);
  if (!url || !hostAllowed(url.hostname, hosts)) return undefined;
  return url.href;
}

export function isSameListingPage(eventUrl: string, listingUrl: string) {
  try {
    const event = new URL(eventUrl);
    const listing = new URL(listingUrl);
    const path = (value: string) => value.replace(/\/+$/, "") || "/";
    return event.protocol === listing.protocol
      && event.hostname.toLowerCase() === listing.hostname.toLowerCase()
      && path(event.pathname) === path(listing.pathname);
  } catch {
    return false;
  }
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

function isCanonicalGolfTitle(normalized: string) {
  if (!/(?:nj\s*\/\s*dvhimss|njdvhimss|nj\s+himss)/.test(normalized)) return false;
  if (!/\bgolf\b/.test(normalized)) return false;
  if (/committee|meeting|planning|preview|volunteer/.test(normalized)) return false;
  if (/outing|annual|tournament/.test(normalized)) return true;
  return /^((the|njdvhimss|nj himss|nj\/dvhimss)\s+)*golf$/.test(normalized);
}

function isCanonicalFallConferenceTitle(normalized: string) {
  if (!/(?:nj\s*\/\s*dvhimss|njdvhimss|nj\s+himss)/.test(normalized)) return false;
  if (/committee|planning|preview|webinar|volunteer|mixer/.test(normalized)) return false;
  if (/fall conference/.test(normalized)) return true;
  return (/nj\s*\/\s*dvhimss|njdvhimss/.test(normalized)) && /conference/.test(normalized);
}

function isFallConferenceDay(day?: string) {
  return Boolean(day && day >= FALL_CONFERENCE_START && day <= FALL_CONFERENCE_END);
}

export function classifyNjEventKey(title: string, startsAt?: string) {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  const day = startsAt ? civilDate(startsAt) : undefined;
  if (isCanonicalGolfTitle(normalized) && day === GOLF_OUTING_DATE) return "golf";
  if (isCanonicalFallConferenceTitle(normalized) && isFallConferenceDay(day)) return "fall-conference";
  return `generic:${slugify(title)}${day ? `:${day}` : ""}`;
}

function listingEvent(partial: Omit<ParsedListingEvent, "key"> & { key?: string }): ParsedListingEvent | undefined {
  const title = stripHtml(partial.title);
  const startsAt = toIso(partial.startsAt);
  if (!title || !startsAt) return undefined;
  return {
    key: partial.key ?? classifyNjEventKey(title, startsAt),
    title,
    startsAt,
    endsAt: partial.endsAt ? toIso(partial.endsAt) : undefined,
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
  const cardStarts = [...html.matchAll(open)].filter((match) => CARD_CLASS.test(match[2] ?? ""));
  for (let cardIndex = 0; cardIndex < cardStarts.length; cardIndex += 1) {
    const match = cardStarts[cardIndex];
    const attrs = match[2] ?? "";
    if (!CARD_CLASS.test(attrs)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const nextCard = cardStarts[cardIndex + 1]?.index ?? html.length;
    const windowHtml = html.slice(start, Math.min(nextCard, start + 3500));
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
    const href = heading[1]?.startsWith("http") || heading[1]?.startsWith("/") ? heading[1] : firstHref(lookbehind);
    const parsed = listingEvent({ title, startsAt: iso, url: href, offersUrl: href });
    if (parsed && !events.some((event) => event.key === parsed.key)) events.push(parsed);
  }
  return { events, malformed };
}

export function matchKnownNjdvhimssEvents(html: string): ParsedListingEvent[] {
  const events: ParsedListingEvent[] = [];
  const conference = /October\s+13,\s+2026[\s\S]{0,80}October\s+15,\s+2026|Tuesday,\s+October\s+13,\s+2026/i.test(html)
    || (/fall conference/i.test(html) && /October\s+13,\s+2026/i.test(html) && /October\s+15,\s+2026/i.test(html));
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
  if (
    /October\s+13,\s+2026/i.test(html)
    && (/<h[1-6][^>]*>\s*Golf\s*<\/h[1-6]>/i.test(html) || /annual golf outing/i.test(html))
  ) {
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
  cardMalformed?: number;
}): SnapshotCompleteness {
  if (!input.recognized) return "partial";
  if (input.jsonLdMalformed > 0 || (input.cardMalformed ?? 0) > 0) return "partial";
  if (input.itemCount === 0) return "empty-unverified";
  if (input.jsonLdEventCount > 0) return "complete";
  return input.itemCount < 2 ? "partial" : "complete";
}

export function tribeRecordId(row: Record<string, unknown>): string | undefined {
  const raw = row.id;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return String(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
  }
  return undefined;
}

export function tribeFallbackId(title: string, startsAt: string, url?: string): string | undefined {
  const day = civilDate(startsAt);
  if (!title || !day) return undefined;
  const path = url ? (() => {
    try {
      return new URL(url).pathname.replace(/\/+$/, "");
    } catch {
      return "";
    }
  })() : "";
  return `fallback-${slugify(`${title}-${day}-${path}`)}`;
}
