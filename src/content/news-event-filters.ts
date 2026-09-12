import type { ContentItem, EventItem } from "./schema";
import { nextChapterEvent, publishedNewsList, upcomingEvents } from "./queries";
import { listCanonicalPath, pageFromSearch, paginate, type PageWindow } from "./pagination";

export type NewsEventSection = "news" | "events";
export type NewsEventFilterKey = "q" | "organization" | "host" | "topic" | "format" | "from" | "to";
export type NewsEventFilterValues = Partial<Record<NewsEventFilterKey, string>>;
export type NewsEventFilterRequest = {
  values: NewsEventFilterValues;
  errors: string[];
  active: boolean;
};
export type FilterOption = { value: string; label: string };

export const FILTER_TEXT_LIMIT = 120;
export const EVENT_FORMAT_OPTIONS: readonly FilterOption[] = [
  { value: "in-person", label: "In person" },
  { value: "virtual", label: "Virtual" },
  { value: "hybrid", label: "Hybrid" },
  { value: "unknown", label: "Not confirmed" },
];

const KEYS: Record<NewsEventSection, readonly NewsEventFilterKey[]> = {
  news: ["q", "organization", "topic", "from", "to"],
  events: ["q", "host", "topic", "format", "from", "to"],
};
const LABELS: Record<NewsEventFilterKey, string> = {
  q: "Search", organization: "Organization", host: "Host", topic: "Topic",
  format: "Format", from: "From date", to: "To date",
};

function isCivilDay(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Invalid known filters stay an error, never silently broaden the result set. */
export function parseNewsEventFilters(search: string, section: NewsEventSection): NewsEventFilterRequest {
  const params = new URLSearchParams(search);
  const values: NewsEventFilterValues = {};
  const errors: string[] = [];
  for (const key of KEYS[section]) {
    const entries = params.getAll(key);
    if (entries.length > 1) errors.push(`${LABELS[key]} must appear only once.`);
    const raw = entries[0];
    if (raw == null || raw === "") continue;
    const value = raw.trim();
    if (!value) continue;
    values[key] = value.slice(0, FILTER_TEXT_LIMIT);
    if (value.length > FILTER_TEXT_LIMIT) {
      errors.push(`${LABELS[key]} must be ${FILTER_TEXT_LIMIT} characters or fewer.`);
    } else if (/[\u0000-\u001f\u007f]/.test(value)) {
      errors.push(`${LABELS[key]} contains unsupported characters.`);
    } else if ((key === "from" || key === "to") && !isCivilDay(value)) {
      errors.push(`${LABELS[key]} must be a valid calendar date.`);
    } else if (key === "format" && !EVENT_FORMAT_OPTIONS.some((option) => option.value === value)) {
      errors.push("Choose a supported event format.");
    }
  }
  if (values.from && values.to && isCivilDay(values.from) && isCivilDay(values.to) && values.to < values.from) {
    errors.push("To date must be on or after From date.");
  }
  return { values, errors, active: Object.keys(values).length > 0 || errors.length > 0 };
}

export function newsEventFilterSearch(values: NewsEventFilterValues, section: NewsEventSection, page = 1) {
  const search: Record<string, string> = {};
  for (const key of KEYS[section]) {
    const value = values[key]?.trim();
    if (value) search[key] = value;
  }
  if (page > 1) search.page = String(page);
  return search;
}

/** Native links and SPA navigation share exactly the same filter serialization. */
export function newsEventListPath(path: "/news" | "/events", values: NewsEventFilterValues, page = 1) {
  const query = new URLSearchParams(newsEventFilterSearch(values, path === "/news" ? "news" : "events", page));
  return query.size ? `${path}?${query.toString()}` : path;
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function matchesText(item: ContentItem, q?: string) {
  if (!q) return true;
  const haystack = normalizedText([
    item.title, item.dek, item.impactSentence ?? "", item.topics.join(" "),
    item.kind === "event" ? item.hostOrg : "",
  ].join("\n"));
  return haystack.includes(normalizedText(q));
}

function civilDay(iso: string | undefined, timeZone: string): string | undefined {
  if (!iso || !Number.isFinite(Date.parse(iso))) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(iso));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return undefined;
  }
}

function matchesDay(iso: string | undefined, timeZone: string, values: NewsEventFilterValues) {
  if (!values.from && !values.to) return true;
  const day = civilDay(iso, timeZone);
  if (!day) return false;
  return (!values.from || day >= values.from) && (!values.to || day <= values.to);
}

/** Keep the existing list gate/order. Publication date, not hydration, is the News clock. */
export function filteredNews(items: ContentItem[], request: NewsEventFilterRequest) {
  if (request.errors.length) return [];
  const values = request.values;
  return publishedNewsList(items).filter((item) =>
    (!values.organization || item.orgs.includes(values.organization)) &&
    (!values.topic || item.topics.includes(values.topic)) &&
    matchesText(item, values.q) &&
    matchesDay(item.publishedAt, "America/New_York", values),
  );
}

/** Lifecycle and joint-chapter deduplication run before filtering and display limits. */
export function filteredUpcomingEvents(items: ContentItem[], request: NewsEventFilterRequest, now = new Date()): EventItem[] {
  if (request.errors.length) return [];
  const values = request.values;
  return upcomingEvents(items, now, Number.MAX_SAFE_INTEGER).filter((item) =>
    (!values.host || item.hostOrg === values.host) &&
    (!values.topic || item.topics.includes(values.topic)) &&
    (!values.format || (item.format ?? "unknown") === values.format) &&
    matchesText(item, values.q) &&
    matchesDay(item.startsAt, item.timezone || "America/New_York", values),
  );
}

export function filterOptions(values: Iterable<string>, label: (value: string) => string = (value) => value): FilterOption[] {
  return [...new Set(values)].filter(Boolean)
    .map((value) => ({ value, label: label(value) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/** The browser, initial HTML, and document metadata use the same filtered window. */
export function filteredNewsPage(items: ContentItem[], search: string) {
  const request = parseNewsEventFilters(search, "news");
  return { request, page: paginate(filteredNews(items, request), pageFromSearch(search)) };
}

export function filteredEventsPage(items: ContentItem[], search: string, now = new Date()) {
  const request = parseNewsEventFilters(search, "events");
  const matches = filteredUpcomingEvents(items, request, now);
  const chapter = nextChapterEvent(matches, now);
  const ordered = chapter ? [chapter, ...matches.filter(item => item.id !== chapter.id)] : matches;
  return { request, chapter, page: paginate(ordered, pageFromSearch(search), 50) };
}

export function newsEventIndexState(path: "/news" | "/events", request: NewsEventFilterRequest, page: PageWindow<unknown>) {
  return {
    canonicalPath: request.active ? path : listCanonicalPath(path, page),
    noindex: request.active || !page.indexable,
    prevPath: page.prevPage == null ? undefined : newsEventListPath(path, request.values, page.prevPage),
    nextPath: page.nextPage == null ? undefined : newsEventListPath(path, request.values, page.nextPage),
  };
}
