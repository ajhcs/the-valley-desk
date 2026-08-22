import type { ContentItem } from "../content/schema";

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

export function sourceLine(item: ContentItem) {
  const origin = item.source.origin;
  return item.source.url ? origin + " · cited" : origin;
}
