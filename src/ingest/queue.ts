import type { ContentItem } from "../content/schema";

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
