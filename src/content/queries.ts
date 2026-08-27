import type { ContentItem, EventItem, NewsItem } from "./schema";
import { eventIsUpcoming } from "../lib/calendar";
import { compareNewestThenId } from "./pagination";
import { hasLiveSeedOrg } from "./seed";

let boundSeedOrgIds = new Set<string>();

/** Bind live seed org ids from fixtures/entities.json (call from catalog load). */
export function bindSeedOrgIds(ids: ReadonlySet<string>) {
  boundSeedOrgIds = new Set(ids);
}

/** Public news-family gate. Empty orgs[] does not ship. Interview off. */
export function isPublicNewsFamily(
  item: ContentItem,
  seedOrgIds: ReadonlySet<string> = boundSeedOrgIds,
): boolean {
  if (item.status !== "published") return false;
  if (item.kind !== "news" && item.kind !== "policy" && item.kind !== "ai") return false;
  if (!item.impactSentence?.trim()) return false;
  if (!hasLiveSeedOrg(item.orgs, seedOrgIds)) return false;
  return true;
}

/** Published news|policy|ai with impactSentence and at least one live seed org. Interview off. */
export function latestNews(
  items: ContentItem[],
  n = 6,
  seedOrgIds: ReadonlySet<string> = boundSeedOrgIds,
) {
  return items
    .filter((item) => isPublicNewsFamily(item, seedOrgIds) && item.featured !== true)
    .sort(compareNewestThenId)
    .slice(0, n);
}

/** /news list. All published news|policy|ai. Empty orgs[] stay. Interview off. Featured stays Lead-only. */
export function publishedNewsList(items: ContentItem[]) {
  return items
    .filter((item) => {
      if (item.status !== "published") return false;
      if (item.kind !== "news" && item.kind !== "policy" && item.kind !== "ai") return false;
      if (item.featured === true) return false;
      return true;
    })
    .sort(compareNewestThenId);
}

/** Curated product changes with a verified local health-system relationship. */
export function productWatch(items: ContentItem[], n = 8) {
  return items
    .filter((item) =>
      item.status === "published" &&
      (item.kind === "news" || item.kind === "ai") &&
      item.topics.includes("product-watch") &&
      Boolean(item.impactSentence?.trim()),
    )
    .sort(compareNewestThenId)
    .slice(0, n);
}

/** /news list after product-watch is pulled into its own rail. */
export function newsIndexItems(items: ContentItem[]) {
  const watchedIds = new Set(productWatch(items).map((item) => item.id));
  return publishedNewsList(items).filter((item) => !watchedIds.has(item.id));
}

/** Published kind=voice only. Never latestNews. Jane Doe stays draft. */
export function latestVoices(items: ContentItem[], n = 6) {
  return items
    .filter((item) => item.kind === "voice" && item.status === "published")
    .sort(compareNewestThenId)
    .slice(0, n);
}

/** Published upcoming events. Date-only/time-TBD stay up through the last civil day.
 *  Cancelled and withdrawn rows are out of the list; completed keep permalinks. */
export function upcomingEvents(items: ContentItem[], now = new Date(), n = 6) {
  return dedupeJointChapter(
    items.filter(
      (i): i is EventItem =>
        i.kind === "event" && i.status === "published" && eventIsUpcoming(i, now),
    ),
  )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, n);
}

const CHAPTER_PARTNERS = new Set(["dvhimss", "njhimss"]);

function eventHay(item: EventItem) {
  return `${item.title} ${item.slug}`.toLowerCase();
}

function isChapterConference(item: EventItem) {
  return /conference/i.test(eventHay(item));
}

/** Joint NJDVHIMSS conference or golf is one row, not a scrape plus the official calendar. */
function jointChapterKey(item: EventItem) {
  const hay = eventHay(item);
  if (!/njdv|nj\/dv|nj-dv/.test(hay)) return undefined;
  if (/golf|outing/.test(hay)) return "joint-njdv-golf";
  if (/conference/.test(hay)) return "joint-njdv-conference";
  return undefined;
}

function preferJointRow(a: EventItem, b: EventItem) {
  const aOfficial = a.source.origin === "dvhimss-events" ? 1 : 0;
  const bOfficial = b.source.origin === "dvhimss-events" ? 1 : 0;
  if (aOfficial !== bOfficial) return aOfficial > bOfficial ? a : b;
  if (Boolean(a.registrationUrl) !== Boolean(b.registrationUrl)) return a.registrationUrl ? a : b;
  return a.startsAt <= b.startsAt ? a : b;
}

function dedupeJointChapter(items: EventItem[]) {
  const winners = new Map<string, EventItem>();
  for (const item of items) {
    const key = jointChapterKey(item);
    if (!key) continue;
    const prev = winners.get(key);
    winners.set(key, prev ? preferJointRow(prev, item) : item);
  }
  const used = new Set<string>();
  const out: EventItem[] = [];
  for (const item of items) {
    const key = jointChapterKey(item);
    if (!key) {
      out.push(item);
      continue;
    }
    if (used.has(key)) continue;
    used.add(key);
    out.push(winners.get(key)!);
  }
  return out;
}

/** Soonest published chapter event. Conference in window beats mixer/golf/Phillies.
 *  dvhimss|njhimss cannot publish without registrationUrl, so the pin always has Register.
 *  Joint NJDVHIMSS is one row. */
export function nextChapterEvent(items: ContentItem[], now = new Date()): EventItem | undefined {
  const chapter = dedupeJointChapter(
    items.filter(
      (i): i is EventItem =>
        i.kind === "event" &&
        i.status === "published" &&
        eventIsUpcoming(i, now) &&
        CHAPTER_PARTNERS.has(i.partner) &&
        Boolean(i.registrationUrl),
    ),
  ).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const conference = chapter.find(isChapterConference);
  return conference ?? chapter[0];
}

/** nextChapterEvent first, then the rest of upcomingEvents, no duplicate. */
export function pinnedUpcomingEvents(items: ContentItem[], now = new Date(), n = 6) {
  const chapter = nextChapterEvent(items, now);
  const rest = upcomingEvents(items, now, Number.MAX_SAFE_INTEGER).filter((item) => item.id !== chapter?.id);
  const rows = chapter ? [chapter, ...rest] : rest;
  return rows.slice(0, n);
}

export function byKind<K extends ContentItem["kind"]>(
  items: ContentItem[],
  kind: K,
) {
  return items.filter((i) => i.kind === kind && i.status === "published");
}

export function bySlug(items: ContentItem[], slug: string) {
  return items.find((i) => i.slug === slug && i.status === "published");
}

/** Published item that used to live at this slug. Canonical slug is item.slug. */
export function byPreviousSlug(items: ContentItem[], slug: string) {
  return items.find(
    (item) => item.status === "published" && item.previousSlugs?.includes(slug) && item.slug !== slug,
  );
}

export const EDITION_HOURS_ET = [6, 17] as const;

export function lastEditionAt(now = new Date()): Date {
  const today = etParts(now);
  const evening = etWallToUtc(today.year, today.month, today.day, EDITION_HOURS_ET[1]);
  if (now.getTime() >= evening.getTime()) return evening;
  const morning = etWallToUtc(today.year, today.month, today.day, EDITION_HOURS_ET[0]);
  if (now.getTime() >= morning.getTime()) return morning;
  const noon = etWallToUtc(today.year, today.month, today.day, 12);
  const yesterday = etParts(new Date(noon.getTime() - 24 * 60 * 60 * 1000));
  return etWallToUtc(yesterday.year, yesterday.month, yesterday.day, EDITION_HOURS_ET[1]);
}

export function nextEditionAt(now = new Date()): Date {
  const today = etParts(now);
  for (const hour of EDITION_HOURS_ET) {
    const check = etWallToUtc(today.year, today.month, today.day, hour);
    if (now.getTime() < check.getTime()) return check;
  }
  const noon = etWallToUtc(today.year, today.month, today.day, 12);
  const tomorrow = etParts(new Date(noon.getTime() + 24 * 60 * 60 * 1000));
  return etWallToUtc(tomorrow.year, tomorrow.month, tomorrow.day, EDITION_HOURS_ET[0]);
}

export function editionName(at: Date) {
  return etParts(at).hour < 12 ? "Morning edition" : "Evening edition";
}

export function formatEditionClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function editionStamp(now = new Date()) {
  const last = lastEditionAt(now);
  const next = nextEditionAt(now);
  return {
    last,
    next,
    currentName: editionName(last),
    nextName: editionName(next),
    lastClock: formatEditionClock(last.toISOString()),
    nextClock: formatEditionClock(next.toISOString()),
  };
}

export function isStaleLead(item: ContentItem, now = new Date()) {
  const t = Date.parse(item.publishedAt ?? item.updatedAt);
  return Number.isFinite(t) && t < lastEditionAt(now).getTime();
}

const ET = "America/New_York";

function etParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function etWallToUtc(year: number, month: number, day: number, hour: number, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const seen = etParts(guess);
  const asUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(guess.getTime() - (asUtc - wanted));
}

export function windowStartYesterday5pmET(now = new Date()): Date {
  const today = etParts(now);
  const noonToday = etWallToUtc(today.year, today.month, today.day, 12);
  const y = etParts(new Date(noonToday.getTime() - 24 * 60 * 60 * 1000));
  return etWallToUtc(y.year, y.month, y.day, 17);
}

function overlapScore(item: ContentItem, orgFreq: Map<string, number>, topicFreq: Map<string, number>) {
  let score = 0;
  for (const org of item.orgs) {
    const n = orgFreq.get(org) ?? 0;
    if (n > 1) score += n;
  }
  for (const topic of item.topics) {
    const n = topicFreq.get(topic) ?? 0;
    if (n > 1) score += n;
  }
  return score;
}

function windowKey(item: ContentItem): string {
  return item.publishedAt ?? item.updatedAt;
}

/** Go-live clock when present, else publishedAt, else updatedAt. */
function deskSortKey(item: ContentItem): string {
  if (item.kind === "news" && (item as NewsItem).clockAt) return (item as NewsItem).clockAt as string;
  return item.publishedAt ?? item.updatedAt;
}

/**
 * Desk strip. Published or review/QUEUED since yesterday 17:00 America/New_York.
 * Rank: clockAt if present else publishedAt else updatedAt.
 * Org+topic overlap is a tiebreak only. Draft off. Rails stay published-only.
 */
export function briefingSinceYesterday5pmET(items: ContentItem[], now = new Date()) {
  const start = windowStartYesterday5pmET(now).getTime();
  const end = now.getTime();
  const windowItems = items.filter((item) => {
    if (item.status !== "published" && item.status !== "review") return false;
    const t = Date.parse(windowKey(item));
    return Number.isFinite(t) && t >= start && t <= end;
  });

  const orgFreq = new Map<string, number>();
  const topicFreq = new Map<string, number>();
  for (const item of windowItems) {
    for (const org of item.orgs) orgFreq.set(org, (orgFreq.get(org) ?? 0) + 1);
    for (const topic of item.topics) topicFreq.set(topic, (topicFreq.get(topic) ?? 0) + 1);
  }

  return [...windowItems].sort((a, b) => {
    const clockDelta = deskSortKey(b).localeCompare(deskSortKey(a));
    if (clockDelta !== 0) return clockDelta;
    return overlapScore(b, orgFreq, topicFreq) - overlapScore(a, orgFreq, topicFreq);
  });
}

function isLeadNews(item: ContentItem): item is NewsItem {
  return (
    item.kind === "news" &&
    item.status === "published" &&
    item.featured === true &&
    Boolean(item.impactSentence?.trim())
  );
}

/**
 * Featured published news only. Empty if none.
 * Does not read briefingSinceYesterday5pmET. briefing[0] is never the lead.
 */
export function leadItem(items: ContentItem[]): NewsItem | undefined {
  const hits = items.filter(isLeadNews);
  if (hits.length === 0) return undefined;
  return hits.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0];
}

export const featuredLead = leadItem;
