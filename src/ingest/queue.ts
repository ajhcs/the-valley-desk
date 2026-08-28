import type { ContentItem } from "../content/schema";
import { OFFICIAL_HEALTH_SYSTEM_ORIGINS } from "./editor";
import { matchingProductUses } from "./product-watch";

export const QUEUE_SLA_OVERDUE_MS = 24 * 60 * 60 * 1000;
export const QUEUE_DEADLINE_SOON_MS = 72 * 60 * 60 * 1000;
export const QUEUE_DEADLINE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ReviewQueueDoc = {
  fetchedAt?: string;
  working?: unknown;
  events?: unknown;
  social?: unknown;
  items: ContentItem[];
  [key: string]: unknown;
};

/** Merge incoming ingest rows by id. Never clobber a published row. */
export function mergeReviewQueue(
  existing: ContentItem[],
  incoming: ContentItem[],
  publishedIds: ReadonlySet<string> = new Set(),
): ContentItem[] {
  const byId = new Map<string, ContentItem>();
  for (const item of existing) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id) continue;
    if (publishedIds.has(item.id)) continue;
    const prev = byId.get(item.id);
    if (prev?.status === "published") continue;
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function queueItemIds(doc: ReviewQueueDoc | ContentItem[] | undefined): ContentItem[] {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;
  return Array.isArray(doc.items) ? doc.items : [];
}

export type PriorityWorkItem<T> = {
  item: T;
  id: string;
  origin: string;
  orgs: readonly string[];
  firstSeenAt?: string | null;
  contentChangedAt?: string | null;
  publishedAt?: string;
  startsAt?: string;
  official: boolean;
  material: boolean;
  // freshness-first extension
  ageMs: number;
  materialityRank: number;
  firstPartyRank: number;
  eventChangeRank: number;
};

export type QueueSlaMetrics = {
  eligibleCount: number;
  selectedCount: number;
  oldestEligibleAgeMs: number | null;
  medianEligibleAgeMs: number | null;
  overdueCount: number;
  selectedOriginCounts: Record<string, number>;
};

/**
 * Calculate queue age from the item's source freshness, not from the time it
 * happened to be hydrated into the durable queue. A first hydration can set
 * contentChangedAt to now even when the source article is years old, so a
 * valid publishedAt must take precedence. Invalid or missing dates fall back
 * in order to a genuine content change and then first-seen time.
 */
export function queueAgeMs(
  firstSeenAt: string | null | undefined,
  now: Date,
  contentChangedAt?: string | null,
  publishedAt?: string | null,
) {
  const first = firstSeenAt ? Date.parse(firstSeenAt) : Number.NaN;
  const changed = contentChangedAt ? Date.parse(contentChangedAt) : Number.NaN;
  const published = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const seen = Number.isFinite(published)
    ? published
    : Number.isFinite(changed)
      ? changed
      : first;
  if (!Number.isFinite(seen)) return 0;
  return Math.max(0, now.getTime() - seen);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _orgFrequency(items: Array<{ orgs: readonly string[] }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const org of item.orgs) counts.set(org, (counts.get(org) ?? 0) + 1);
  }
  return counts;
}
void _orgFrequency;

export function freshnessPriorityRank(row: PriorityWorkItem<unknown>) {
  const age = row.ageMs;
  const isFresh24 = age < 24 * 60 * 60 * 1000;
  const isFresh72 = age < 72 * 60 * 60 * 1000;
  return {
    critical: row.materialityRank === 0 ? 0 : 1,
    firstParty: row.firstPartyRank,
    fresh24: isFresh24 ? 0 : 1,
    fresh72: isFresh72 ? 0 : 1,
    eventChange: row.eventChangeRank,
    secondary: row.firstPartyRank === 1 ? 0 : 1,
    backlog: isFresh72 ? 0 : 1,
    ageMs: row.ageMs,
  };
}

function comparePriority(a: PriorityWorkItem<unknown>, b: PriorityWorkItem<unknown>) {
  const ra = freshnessPriorityRank(a);
  const rb = freshnessPriorityRank(b);
  if (ra.critical !== rb.critical) return ra.critical - rb.critical;
  if (ra.firstParty !== rb.firstParty) return ra.firstParty - rb.firstParty;
  if (ra.fresh24 !== rb.fresh24) return ra.fresh24 - rb.fresh24;
  if (ra.fresh72 !== rb.fresh72) return ra.fresh72 - rb.fresh72;
  if (ra.eventChange !== rb.eventChange) return ra.eventChange - rb.eventChange;
  if (ra.secondary !== rb.secondary) return ra.secondary - rb.secondary;
  if (ra.backlog !== rb.backlog) return ra.backlog - rb.backlog;
  if (a.ageMs !== b.ageMs) return b.ageMs - a.ageMs;
  return a.id.localeCompare(b.id);
}

export function priorityScore(row: PriorityWorkItem<unknown>, _now: Date, _orgCounts: Map<string, number>, _medianOrgCount: number) {
  const rank = freshnessPriorityRank(row);
  let score = 1000;
  score -= rank.critical * 500;
  score -= rank.firstParty * 200;
  score -= rank.fresh24 * 100;
  score -= rank.fresh72 * 80;
  score -= rank.eventChange * 60;
  score -= rank.secondary * 30;
  score -= rank.backlog * 20;
  score += Math.min(row.ageMs / 3_600_000, 72);
  return score;
}

export function summarizeQueueSla<T>(
  eligible: Array<PriorityWorkItem<T>>,
  selected: Array<PriorityWorkItem<T>>,
  now: Date,
): QueueSlaMetrics {
  const ages = eligible.map((row) => queueAgeMs(row.firstSeenAt, now, row.contentChangedAt, row.publishedAt));
  const selectedOriginCounts: Record<string, number> = {};
  for (const row of selected) {
    selectedOriginCounts[row.origin] = (selectedOriginCounts[row.origin] ?? 0) + 1;
  }
  return {
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    oldestEligibleAgeMs: ages.length ? Math.max(...ages) : null,
    medianEligibleAgeMs: median(ages),
    overdueCount: ages.filter((age) => age >= QUEUE_SLA_OVERDUE_MS).length,
    selectedOriginCounts,
  };
}

export function contentPriorityFields(item: ContentItem, firstSeenAt?: string | null, now: Date = new Date(), contentChangedAt?: string | null): PriorityWorkItem<ContentItem> {
  const ageMs = queueAgeMs(firstSeenAt, now, contentChangedAt, item.publishedAt);
  const isEvent = item.kind === "event";
  const hasExecutiveChange = /executive|leadership|CEO|CFO|CMIO|chief|appoint|hire|resign|depart/i.test([item.title, item.dek, item.body].join(" "));
  const materialityRank = matchingProductUses(item).length > 0 ? 0 : 1;
  const firstParty = OFFICIAL_HEALTH_SYSTEM_ORIGINS.has(item.source.origin) ? 0 : 1;
  const eventChangeRank = isEvent || hasExecutiveChange ? 0 : 1;
  return {
    item,
    id: item.id,
    origin: item.source.origin,
    orgs: item.orgs,
    firstSeenAt,
    contentChangedAt,
    publishedAt: item.publishedAt,
    startsAt: item.kind === "event" ? item.startsAt : undefined,
    official: OFFICIAL_HEALTH_SYSTEM_ORIGINS.has(item.source.origin),
    material: matchingProductUses(item).length > 0,
    ageMs,
    materialityRank,
    firstPartyRank: firstParty,
    eventChangeRank,
  };
}

export function selectPriorityWork<T>(
  candidates: Array<PriorityWorkItem<T>>,
  budget: number,
  now: Date,
): { selected: T[]; metrics: QueueSlaMetrics } {
  const limit = Math.max(0, Math.trunc(budget) || 0);
  if (limit === 0 || candidates.length === 0) {
    return { selected: [], metrics: summarizeQueueSla(candidates, [], now) };
  }
  for (const c of candidates) {
    c.ageMs = queueAgeMs(c.firstSeenAt, now, c.contentChangedAt, c.publishedAt);
  }
  const sorted = [...candidates].sort(comparePriority);
  const uniqueOrigins = new Set(candidates.map((row) => row.origin)).size;
  const maxPerOrigin = Math.max(1, Math.ceil(limit / Math.max(1, uniqueOrigins)));
  const originCount = new Map<string, number>();
  const picked: Array<PriorityWorkItem<T>> = [];
  const remaining: Array<PriorityWorkItem<T>> = [];
  for (const cand of sorted) {
    const cnt = originCount.get(cand.origin) ?? 0;
    if (picked.length < limit && cnt < maxPerOrigin) {
      picked.push(cand);
      originCount.set(cand.origin, cnt + 1);
    } else {
      remaining.push(cand);
    }
  }
  if (picked.length < limit) {
    remaining.sort(comparePriority);
    for (const cand of remaining) {
      if (picked.length >= limit) break;
      picked.push(cand);
    }
  }
  const FRESH_72_MS = 72 * 60 * 60 * 1000;
  if (picked.length === limit && remaining.length) {
    const pickedSorted = [...picked].sort(comparePriority);
    const worstPicked = pickedSorted[pickedSorted.length - 1];
    const freshRemaining = remaining.filter((r) => r.ageMs < FRESH_72_MS).sort(comparePriority);
    if (freshRemaining.length && worstPicked.ageMs >= FRESH_72_MS) {
      const bestFresh = freshRemaining[0];
      // A fresh item must get a slot even when an older first-party item has
      // a stronger editorial rank. This prevents the durable backlog from
      // starving current developments indefinitely.
      const idx = picked.indexOf(worstPicked);
      picked[idx] = bestFresh;
    }
  }
  return {
    selected: picked.map((row) => row.item),
    metrics: summarizeQueueSla(candidates, picked, now),
  };
}
