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
  publishedAt?: string;
  startsAt?: string;
  official: boolean;
  material: boolean;
};

export type QueueSlaMetrics = {
  eligibleCount: number;
  selectedCount: number;
  oldestEligibleAgeMs: number | null;
  medianEligibleAgeMs: number | null;
  overdueCount: number;
  selectedOriginCounts: Record<string, number>;
};

export function queueAgeMs(firstSeenAt: string | null | undefined, now: Date) {
  const seen = firstSeenAt ? Date.parse(firstSeenAt) : now.getTime();
  if (!Number.isFinite(seen)) return 0;
  return Math.max(0, now.getTime() - seen);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function orgFrequency(items: Array<{ orgs: readonly string[] }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const org of item.orgs) counts.set(org, (counts.get(org) ?? 0) + 1);
  }
  return counts;
}

export function priorityScore(row: PriorityWorkItem<unknown>, now: Date, orgCounts: Map<string, number>, medianOrgCount: number) {
  const ageMs = queueAgeMs(row.firstSeenAt, now);
  let score = (ageMs / 3_600_000) * 10;
  if (row.publishedAt) {
    const published = Date.parse(row.publishedAt);
    if (Number.isFinite(published)) {
      const recency = now.getTime() - published;
      if (recency >= 0 && recency <= 48 * 60 * 60 * 1000) score += 25;
      else if (recency >= 0 && recency <= QUEUE_DEADLINE_WEEK_MS) score += 10;
    }
  }
  if (row.official) score += 20;
  if (row.material) score += 15;
  if (row.orgs.some((org) => (orgCounts.get(org) ?? 0) < medianOrgCount)) score += 12;
  if (row.startsAt) {
    const starts = Date.parse(row.startsAt);
    if (Number.isFinite(starts)) {
      const until = starts - now.getTime();
      if (until > 0 && until <= QUEUE_DEADLINE_SOON_MS) score += 30;
      else if (until > 0 && until <= QUEUE_DEADLINE_WEEK_MS) score += 15;
    }
  }
  return score;
}

export function summarizeQueueSla<T>(
  eligible: Array<PriorityWorkItem<T>>,
  selected: Array<PriorityWorkItem<T>>,
  now: Date,
): QueueSlaMetrics {
  const ages = eligible.map((row) => queueAgeMs(row.firstSeenAt, now));
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

export function contentPriorityFields(item: ContentItem, firstSeenAt?: string | null): PriorityWorkItem<ContentItem> {
  return {
    item,
    id: item.id,
    origin: item.source.origin,
    orgs: item.orgs,
    firstSeenAt,
    publishedAt: item.publishedAt,
    startsAt: item.kind === "event" ? item.startsAt : undefined,
    official: OFFICIAL_HEALTH_SYSTEM_ORIGINS.has(item.source.origin),
    material: matchingProductUses(item).length > 0,
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
  const orgCounts = orgFrequency(candidates);
  const medianOrgCount = median([...orgCounts.values()]) ?? 0;
  const scored = candidates.map((row) => ({
    row,
    score: priorityScore(row, now, orgCounts, medianOrgCount),
  }));
  const byPriority = (a: typeof scored[number], b: typeof scored[number]) => {
    if (a.score !== b.score) return b.score - a.score;
    const ageA = queueAgeMs(a.row.firstSeenAt, now);
    const ageB = queueAgeMs(b.row.firstSeenAt, now);
    if (ageA !== ageB) return ageB - ageA;
    return a.row.id.localeCompare(b.row.id);
  };
  const remaining = [...scored];
  const picked: typeof scored = [];
  const originCount = new Map<string, number>();
  const uniqueOrigins = new Set(candidates.map((row) => row.origin)).size;
  const maxPerOrigin = Math.max(1, Math.ceil(limit / Math.max(1, uniqueOrigins)));

  const take = (cap: number) => {
    remaining.sort(byPriority);
    for (let index = 0; index < remaining.length && picked.length < limit; index += 1) {
      const candidate = remaining[index];
      const count = originCount.get(candidate.row.origin) ?? 0;
      if (count >= cap) continue;
      picked.push(candidate);
      originCount.set(candidate.row.origin, count + 1);
      remaining.splice(index, 1);
      index -= 1;
    }
  };
  take(maxPerOrigin);
  if (picked.length < limit) take(limit);
  return {
    selected: picked.map((row) => row.row.item),
    metrics: summarizeQueueSla(candidates, picked.map((row) => row.row), now),
  };
}
