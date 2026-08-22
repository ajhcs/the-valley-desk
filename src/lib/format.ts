import type { ContentItem, EventItem, NewsItem } from "../content/schema";

const et = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const etTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatDate(iso?: string) {
  if (!iso) return "";
  return et.format(new Date(iso));
}

export function formatWhen(iso?: string) {
  if (!iso) return "";
  return etTime.format(new Date(iso));
}

/** Desk/rail date chip. clockAt on news; startsAt on events. Never a rank key. */
export function chipInstant(item: ContentItem): string | undefined {
  if (item.kind === "news" && (item as NewsItem).clockAt) return (item as NewsItem).clockAt;
  if (item.kind === "event") return (item as EventItem).startsAt;
  return item.publishedAt;
}

export function sourceLine(item: ContentItem) {
  const origin = item.source.origin;
  return item.source.url ? origin + " · cited" : origin;
}
