import type { ContentItem } from "./schema";
import { hasInternalProcessLanguage, professionalizeHeadline } from "../lib/editorialCopy";
import { sourceIdentityKey } from "../ingest/identity";

function contentKey(item: ContentItem) {
  return `${item.kind}:${item.slug}`;
}

function exposesInternalProcess(item: ContentItem) {
  return [
    item.title,
    item.dek,
    item.body,
    item.impactSentence,
    item.contextSentence,
    item.kind === "event" ? item.whyAttend : undefined,
  ].some(hasInternalProcessLanguage);
}

/** A stale D1 publication may predate a stronger reader-copy policy. */
function readerSafeOverlay<T extends ContentItem>(current: T, incoming: T): T {
  const safe = <V extends string | undefined>(value: V, fallback: V) => (
    hasInternalProcessLanguage(value) ? fallback : value
  );
  return {
    ...incoming,
    title: professionalizeHeadline(safe(incoming.title, current.title)),
    dek: safe(incoming.dek, current.dek),
    body: safe(incoming.body, current.body),
    impactSentence: safe(incoming.impactSentence, current.impactSentence),
    contextSentence: safe(incoming.contextSentence, current.contextSentence),
    ...(incoming.kind === "event" && current.kind === "event" ? {
      whyAttend: safe(incoming.whyAttend, current.whyAttend),
    } : {}),
  } as T;
}

function uniqueSlugs(...groups: Array<readonly string[] | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const slug of group ?? []) {
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/** Keep the first published id/slug. Later ingest slugs become aliases. */
export function retainPublishedIdentity<T extends ContentItem>(current: T, incoming: T): T {
  const aliases = uniqueSlugs(
    current.previousSlugs,
    incoming.previousSlugs,
    incoming.slug !== current.slug ? [incoming.slug] : undefined,
  ).filter((slug) => slug !== current.slug);
  return {
    ...incoming,
    id: current.id,
    slug: current.slug,
    previousSlugs: aliases.length ? aliases : undefined,
    publishedAt: current.publishedAt ?? incoming.publishedAt,
    featured: false,
  };
}

function sameSourceIdentity(left: ContentItem, right: ContentItem) {
  if (!left.source.url || !right.source.url) return false;
  return sourceIdentityKey(left) === sourceIdentityKey(right);
}

function sameScheduledEvent(left: ContentItem, right: ContentItem) {
  if (left.kind !== "event" || right.kind !== "event" || left.startsAt !== right.startsAt) return false;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalize(left.title) === normalize(right.title)) return true;
  if (left.partner === right.partner) return true;
  const chapterPartners = new Set(["dvhimss", "njhimss"]);
  return chapterPartners.has(left.partner)
    && chapterPartners.has(right.partner)
    && left.orgs.some((org) => right.orgs.includes(org));
}

/**
 * Merge the automatic D1 overlay without allowing it to shadow signed editorial
 * content. A stable ingest ID may carry a corrected slug when the origin still
 * matches, provided the new route is not already owned by another row.
 */
export function mergePublishedOverlay(
  staticItems: ContentItem[],
  dynamicItems: ContentItem[],
  withdrawnIds: readonly string[] = [],
) {
  const withdrawn = new Set(withdrawnIds);
  const merged = staticItems.filter((item) => !(item.source.kind === "ingest" && withdrawn.has(item.id)));
  for (const item of dynamicItems) {
    if (withdrawn.has(item.id) || item.status !== "published" || item.featured === true || !item.source.url) continue;
    const idIndex = merged.findIndex((current) => current.id === item.id);
    const pathIndex = merged.findIndex((current) => contentKey(current) === contentKey(item));
    if (idIndex >= 0) {
      const current = merged[idIndex];
      const routeOwnedByAnotherRow = pathIndex >= 0 && pathIndex !== idIndex;
      if (
        !routeOwnedByAnotherRow &&
        current.source.kind === "ingest" &&
        current.source.origin === item.source.origin
      ) {
        merged[idIndex] = retainPublishedIdentity(current, readerSafeOverlay(current, { ...item, featured: false }));
      }
      continue;
    }
    const identityIndex = merged.findIndex((current) => sameSourceIdentity(current, item));
    const scheduledIndex = merged.findIndex((current) => sameScheduledEvent(current, item));
    const stableIndex = identityIndex >= 0 ? identityIndex : scheduledIndex;
    if (stableIndex >= 0) {
      if (merged[stableIndex].source.kind === "ingest") {
        const current = merged[stableIndex];
        merged[stableIndex] = retainPublishedIdentity(current, readerSafeOverlay(current, { ...item, featured: false }));
      }
      continue;
    }
    if (pathIndex < 0 && !exposesInternalProcess(item)) {
      merged.push({ ...item, title: professionalizeHeadline(item.title), featured: false });
    }
  }
  return merged;
}
