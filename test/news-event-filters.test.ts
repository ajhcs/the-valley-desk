import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILTER_TEXT_LIMIT,
  filterOptions,
  filteredNews,
  filteredUpcomingEvents,
  newsEventFilterSearch,
  newsEventListPath,
  parseNewsEventFilters,
} from "../src/content/news-event-filters.ts";
import { pageFromSearch, paginate } from "../src/content/pagination.ts";
import { leadItem, nextChapterEvent, publishedNewsList, upcomingEvents } from "../src/content/queries.ts";
import { EventItem, NewsItem, type ContentItem } from "../src/content/schema.ts";
import { parsePlainSearch, stringifyPlainSearch } from "../src/lib/plain-search.ts";

const now = new Date("2026-09-12T12:00:00.000Z");
const base = {
  title: "Regional technology update",
  dek: "A confirmed regional development.",
  body: "Body is not an unbounded search index.",
  status: "published" as const,
  publishedAt: "2026-09-11T12:00:00.000Z",
  updatedAt: "2026-09-12T12:00:00.000Z",
  topics: ["interoperability"],
  orgs: ["org-penn"],
  region: "PA" as const,
  authors: [{ name: "The Valley Desk" }],
  source: { kind: "editorial" as const, origin: "newsroom", url: "https://example.org/source" },
};
function news(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  return NewsItem.parse({ ...base, id, slug: id, kind: "news", impactSentence: "Supported impact.", relatedEventIds: [], relatedVoiceIds: [], ...overrides });
}
function event(id: string, overrides: Partial<EventItem> = {}): EventItem {
  return EventItem.parse({
    ...base, id, slug: id, kind: "event", startsAt: "2026-09-20T16:00:00.000Z",
    endsAt: "2026-09-20T18:00:00.000Z", timezone: "America/New_York", hostOrg: "org-penn",
    partner: "health-system", registrationUrl: "https://example.org/register", format: "in-person", ...overrides,
  });
}

test("filter parser accepts empty state and bounded literal text", () => {
  assert.deepEqual(parseNewsEventFilters("", "news"), { values: {}, errors: [], active: false });
  const request = parseNewsEventFilters("?q=%20ORCA%20%26%20data%20&topic=product-watch&utm_source=test", "news");
  assert.deepEqual(request.values, { q: "ORCA & data", topic: "product-watch" });
  assert.deepEqual(request.errors, []);
  assert.equal(request.active, true);
});

test("overlong and duplicate filters fail closed instead of broadening", () => {
  for (const query of [`?q=${"x".repeat(FILTER_TEXT_LIMIT + 1)}`, "?topic=ai&topic=policy", "?format=virtual&format=hybrid", "?q=a%00b"]) {
    const request = parseNewsEventFilters(query, "events");
    assert.ok(request.errors.length, query);
    assert.equal(filteredUpcomingEvents([event("one")], request, now).length, 0);
    assert.ok(Object.values(request.values).every((value) => value.length <= FILTER_TEXT_LIMIT));
  }
});

test("calendar day validation rejects impossible, ambiguous and reversed dates", () => {
  for (const query of ["?from=2026-02-29", "?to=2026-04-31", "?from=0000-01-01", "?from=2026-9-1", "?from=2026-09-12T00:00:00Z", "?from=2026-09-21&to=2026-09-20"]) {
    const request = parseNewsEventFilters(query, "news");
    assert.ok(request.errors.length, query);
    assert.deepEqual(filteredNews([news("one")], request), []);
  }
  assert.deepEqual(parseNewsEventFilters("?from=2024-02-29&to=2024-02-29", "news").errors, []);
});

test("format is a closed sourced value, not a free-form hint", () => {
  assert.ok(parseNewsEventFilters("?format=remote", "events").errors.length);
  for (const value of ["in-person", "virtual", "hybrid", "unknown"]) {
    assert.deepEqual(parseNewsEventFilters(`?format=${value}`, "events").errors, []);
  }
});

test("filter URLs round-trip, drop empty values and reset pagination on changes", () => {
  const values = { q: " C++ & health? ", organization: "org-penn", topic: "", from: "2026-09-01", host: "not-a-news-filter" };
  const path = newsEventListPath("/news", values, 2);
  assert.equal(path, "/news?q=C%2B%2B+%26+health%3F&organization=org-penn&from=2026-09-01&page=2");
  assert.deepEqual(parseNewsEventFilters(path.slice(path.indexOf("?")), "news").values, { q: "C++ & health?", organization: "org-penn", from: "2026-09-01" });
  assert.equal(newsEventFilterSearch(values, "news").page, undefined);
  assert.equal(newsEventListPath("/events", {}), "/events");
  assert.equal(newsEventListPath("/news", {}, 1), "/news");
});

test("router serialization preserves numeric, JSON-looking and quoted search text literally", () => {
  for (const q of ["100", "1e2", "true", "null", '"hello"', '{"topic":"policy"}', "[1,2]", "C++ & data"]) {
    const search = stringifyPlainSearch({ q, page: "2" });
    assert.equal(new URLSearchParams(search).get("q"), q);
    assert.equal(new URLSearchParams(search).get("page"), "2");
    assert.equal(parsePlainSearch(search).q, q);
    assert.equal(parseNewsEventFilters(search, "news").values.q, q);
    assert.equal(pageFromSearch(search).page, 2);
    assert.equal(pageFromSearch(search).invalid, false);
    assert.equal(stringifyPlainSearch(parsePlainSearch(search)), search);
  }
  assert.equal(stringifyPlainSearch({ page: 2 }), "?page=2");
  assert.equal(stringifyPlainSearch({ empty: undefined }), "");
});

test("router keeps duplicate keys visible to filter validation", () => {
  const parsed = parsePlainSearch("?q=one&q=two&topic=policy");
  assert.deepEqual(parsed.q, ["one", "two"]);
  const search = stringifyPlainSearch(parsed);
  assert.deepEqual(new URLSearchParams(search).getAll("q"), ["one", "two"]);
  assert.ok(parseNewsEventFilters(search, "news").errors.length);
});

test("plain search rejects nested serialization and does not expose prototype keys", () => {
  const parsed = parsePlainSearch("?__proto__=value&constructor=value&prototype=value&q=hello");
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.deepEqual(Object.keys(parsed), ["q"]);
  for (const value of [{ topic: "policy" }, [["nested"]], null, NaN, Infinity]) {
    assert.throws(() => stringifyPlainSearch({ q: value }), TypeError);
  }
  assert.throws(() => stringifyPlainSearch(JSON.parse('{"__proto__":"unsafe"}')), TypeError);
  assert.equal(stringifyPlainSearch({ saved: true, page: 2 }), "?saved=true&page=2");
});

test("empty News filter preserves all legacy family, ordering and featured rules", () => {
  const lead = news("lead", { featured: true });
  const ai = { ...news("ai"), kind: "ai", vendor: "Vendor", product: "Product", announcedAt: base.publishedAt } as ContentItem;
  const policy = { ...news("policy"), kind: "policy", jurisdiction: "PA", issuer: "legislature", changeType: "legislation" } as ContentItem;
  const items: ContentItem[] = [news("b"), news("a"), lead, news("review", { status: "review" }), ai, policy, event("event")];
  const before = structuredClone(items);
  assert.deepEqual(filteredNews(items, parseNewsEventFilters("", "news")), publishedNewsList(items));
  assert.equal(leadItem(items)?.id, "lead");
  assert.deepEqual(items, before);
});

test("News filters combine exact organization/topic with case-insensitive literal search", () => {
  const items = [
    news("orca", { title: "CHOP ORCA database", orgs: ["org-chop"], topics: ["product-watch"] }),
    news("other", { title: "CHOP ORCA database", orgs: ["org-penn"], topics: ["product-watch"] }),
    news("wrong-topic", { title: "CHOP ORCA database", orgs: ["org-chop"], topics: ["workforce"] }),
    news("substring", { title: "Another product", orgs: ["org-chop-child"], topics: ["product-watch"] }),
  ];
  assert.deepEqual(filteredNews(items, parseNewsEventFilters("?organization=org-chop&topic=product-watch&q=orca", "news")).map((item) => item.id), ["orca"]);
  assert.deepEqual(filteredNews(items, parseNewsEventFilters("?q=.*", "news")), []);
  assert.deepEqual(filteredNews(items, parseNewsEventFilters("?q=unbounded", "news")), []);
});

test("News date range uses publication date in the displayed Eastern timezone, never hydration", () => {
  const items = [
    news("in", { publishedAt: "2026-09-12T00:30:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" }),
    news("old", { publishedAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-11T12:00:00.000Z" }),
    news("missing", { publishedAt: undefined, updatedAt: "2026-09-11T12:00:00.000Z" }),
  ];
  assert.deepEqual(filteredNews(items, parseNewsEventFilters("?from=2026-09-11&to=2026-09-11", "news")).map((item) => item.id), ["in"]);
});

test("date filtering follows Eastern civil days across both DST transitions", () => {
  for (const [day, inside, after] of [
    ["2026-03-08", "2026-03-09T03:59:00.000Z", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01", "2026-11-02T04:59:00.000Z", "2026-11-02T05:00:00.000Z"],
  ]) {
    const items = [news("inside", { publishedAt: inside }), news("after", { publishedAt: after })];
    assert.deepEqual(filteredNews(items, parseNewsEventFilters(`?from=${day}&to=${day}`, "news")).map((item) => item.id), ["inside"]);
  }
});

test("upcoming filtering retains cancellation, withdrawal, completion and draft safeguards", () => {
  const items = [
    event("valid"), event("cancelled", { cancelled: true }), event("copy-cancelled", { title: "Canceled event" }),
    event("withdrawn", { status: "unpublished" }), event("draft", { status: "draft" }),
    event("completed", { startsAt: "2026-09-01T12:00:00.000Z", endsAt: "2026-09-01T13:00:00.000Z" }),
  ];
  const request = parseNewsEventFilters("", "events");
  assert.deepEqual(filteredUpcomingEvents(items, request, now), upcomingEvents(items, now, Number.MAX_SAFE_INTEGER));
  assert.deepEqual(filteredUpcomingEvents(items, request, now).map((item) => item.id), ["valid"]);
  assert.equal(items.find((item) => item.id === "cancelled")?.slug, "cancelled");
});

test("format filters never infer attendance format from a venue or virtual-looking title", () => {
  const items = [
    event("virtual", { format: "virtual" }), event("hybrid", { format: "hybrid" }),
    event("unknown", { format: undefined, title: "Virtual technology forum", venue: "Regional campus" }),
    event("explicit-unknown", { format: "unknown" }),
  ];
  assert.deepEqual(filteredUpcomingEvents(items, parseNewsEventFilters("?format=virtual", "events"), now).map((item) => item.id), ["virtual"]);
  assert.deepEqual(filteredUpcomingEvents(items, parseNewsEventFilters("?format=unknown", "events"), now).map((item) => item.id), ["unknown", "explicit-unknown"]);
});

test("event filter uses host/topic/start day in sourced timezone and retains ongoing events", () => {
  const items = [
    event("late", { startsAt: "2026-09-21T01:00:00.000Z", endsAt: "2026-09-21T02:00:00.000Z", timezone: "America/Los_Angeles" }),
    event("ongoing", { startsAt: "2026-09-20T12:00:00.000Z", endsAt: "2026-09-22T12:00:00.000Z" }),
    event("wrong-host", { hostOrg: "org-chop" }),
  ];
  const request = parseNewsEventFilters("?host=org-penn&topic=interoperability&from=2026-09-20&to=2026-09-20", "events");
  assert.deepEqual(filteredUpcomingEvents(items, request, now).map((item) => item.id), ["ongoing", "late"]);
  assert.ok(filteredUpcomingEvents(items, request, new Date("2026-09-21T12:00:00.000Z")).some((item) => item.id === "ongoing"));
});

test("filtering precedes display bounds so a later matching event remains findable", () => {
  const items = Array.from({ length: 60 }, (_, index) => event(`event-${index}`, { hostOrg: index === 59 ? "org-chop" : "org-penn" }));
  const result = filteredUpcomingEvents(items, parseNewsEventFilters("?host=org-chop", "events"), now);
  assert.deepEqual(result.map((item) => item.id), ["event-59"]);
});

test("chapter choice is made within matching results and official joint duplicate wins", () => {
  const source = { ...base.source, origin: "dvhimss-events" };
  const items = [
    event("mixer", { partner: "dvhimss", hostOrg: "DVHIMSS", startsAt: "2026-09-15T12:00:00.000Z", title: "Chapter mixer" }),
    event("copy", { partner: "njhimss", hostOrg: "NJDVHIMSS", title: "NJDV conference", format: "virtual" }),
    event("official", { partner: "dvhimss", hostOrg: "NJDVHIMSS", title: "NJDV conference", source }),
  ];
  const all = filteredUpcomingEvents(items, parseNewsEventFilters("", "events"), now);
  assert.equal(nextChapterEvent(all, now)?.id, "official");
  assert.equal(all.some((item) => item.id === "copy"), false);
  assert.deepEqual(filteredUpcomingEvents(items, parseNewsEventFilters("?format=virtual", "events"), now), []);
  const mixer = filteredUpcomingEvents(items, parseNewsEventFilters("?host=DVHIMSS", "events"), now);
  assert.equal(nextChapterEvent(mixer, now)?.id, "mixer");
});

test("unknown current facet stays a valid empty query instead of widening", () => {
  const request = parseNewsEventFilters("?organization=retired-org", "news");
  assert.deepEqual(request.errors, []);
  assert.deepEqual(filteredNews([news("one")], request), []);
  assert.deepEqual(filterOptions(["b", "a", "a"], (id) => id === "a" ? "Zebra" : "Alpha"), [
    { value: "b", label: "Alpha" }, { value: "a", label: "Zebra" },
  ]);
});

test("filtered pagination stays deterministic and invalid pages never replay page one", () => {
  const items = Array.from({ length: 15 }, (_, index) => news(`news-${String(index).padStart(2, "0")}`));
  const request = parseNewsEventFilters("?organization=org-penn", "news");
  const result = filteredNews(items.reverse(), request);
  const first = paginate(result, pageFromSearch(""));
  const second = paginate(result, pageFromSearch("?page=2"));
  assert.equal(first.items.length, 12);
  assert.equal(second.items.length, 3);
  assert.equal(first.items.some((item) => second.items.some((next) => next.id === item.id)), false);
  assert.deepEqual(paginate(result, pageFromSearch("?page=wrong")).items, []);
  assert.deepEqual(paginate(result, pageFromSearch("?page=99")).items, []);
});
