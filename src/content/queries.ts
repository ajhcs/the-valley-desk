import type { ContentItem, EventItem } from "./schema";

export function latestNews(items: ContentItem[], n = 6) {
  return items
    .filter((i) => i.kind === "news" && i.status === "published")
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, n);
}

export function upcomingEvents(items: ContentItem[], now = new Date(), n = 6) {
  const iso = now.toISOString();
  return items
    .filter(
      (i): i is EventItem =>
        i.kind === "event" && i.status === "published" && i.startsAt >= iso,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, n);
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
