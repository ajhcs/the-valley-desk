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

const etLead = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const etChip = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

export function formatDate(iso?: string) {
  if (!iso) return "";
  return et.format(new Date(iso));
}

export function formatWhen(iso?: string) {
  if (!iso) return "";
  return etTime.format(new Date(iso));
}

/** Lead kicker: 26 SEPTEMBER 2026. clockAt on news, else publishedAt. */
export function formatLeadDate(iso?: string) {
  if (!iso) return "";
  return etLead.format(new Date(iso)).toUpperCase();
}

function chipParts(iso: string) {
  const map: Record<string, string> = {};
  for (const part of etChip.formatToParts(new Date(iso))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    month: (map.month ?? "").replace(".", "").slice(0, 3).toUpperCase(),
    day: map.day ?? "",
  };
}

function formatChipDay(iso?: string) {
  if (!iso) return "";
  const { month, day } = chipParts(iso);
  return month && day ? `${month} ${day}` : "";
}

/** Desk/event chip: SEP 26 or OCT 13–15. Never a rank key. */
export function formatChipLabel(item: ContentItem) {
  if (item.kind === "event") {
    const event = item as EventItem;
    const start = formatChipDay(event.startsAt);
    if (!event.endsAt) return start;
    const a = chipParts(event.startsAt);
    const b = chipParts(event.endsAt);
    if (a.month === b.month && a.day === b.day) return start;
    if (a.month === b.month) return `${a.month} ${a.day}–${b.day}`;
    return `${a.month} ${a.day}–${b.month} ${b.day}`;
  }
  return formatChipDay(chipInstant(item));
}

/** Desk/rail date chip. clockAt on news; startsAt on events. */
export function chipInstant(item: ContentItem): string | undefined {
  if (item.kind === "news" && (item as NewsItem).clockAt) return (item as NewsItem).clockAt;
  if (item.kind === "event") return (item as EventItem).startsAt;
  return item.publishedAt ?? item.updatedAt;
}

export function sourceLine(item: ContentItem) {
  const origin = item.source.origin;
  return item.source.url ? origin + " · cited" : origin;
}

const COSTUME_LIST_COPY =
  /review-queued|stub path|dvhimss-events-stub|gold rail on the homepage|so the rail has two dates/i;

/** List pages: real dek or nothing. Never rewrite costume/stub language. */
export function listDek(item: Pick<ContentItem, "dek">) {
  const dek = item.dek?.trim() ?? "";
  if (!dek || COSTUME_LIST_COPY.test(dek)) return "";
  return dek;
}

export function isCostumeOrigin(origin: string) {
  return origin === "newsroom" || /stub/i.test(origin);
}

/** List-page source crumb. Costume origins (newsroom, *stub*) stay off the card. */
export function listSourceLine(item: ContentItem) {
  if (isCostumeOrigin(item.source.origin)) return "";
  return sourceLine(item);
}
