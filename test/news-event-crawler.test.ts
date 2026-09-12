import assert from "node:assert/strict";
import test from "node:test";
import { NewsItem, EventItem, type ContentItem } from "../src/content/schema";
import { filteredNewsPage, filteredEventsPage, newsEventIndexState } from "../src/content/news-event-filters";
import { pageFromSearch } from "../src/content/pagination";
import { decorateHtml, primaryNoscript, routeJsonLd } from "../src/lib/crawler-html";

const origin = "https://thevalleydesk.org";
const now = new Date("2026-09-12T12:00:00.000Z");
const base = { dek: "Synthetic fixture", body: "Synthetic fixture", status: "published", authors: [{ name: "Synthetic editor" }],
  publishedAt: "2026-09-11T12:00:00.000Z", updatedAt: "2026-09-11T12:00:00.000Z",
  topics: ["interoperability"], orgs: ["org-penn"], region: "PA", source: { kind: "editorial", origin: "newsroom" } };
function news(id: string, title: string, extra: Record<string, unknown> = {}) {
  return NewsItem.parse({ ...base, id, slug: id, kind: "news", title, impactSentence: "Synthetic impact", relatedEventIds: [], relatedVoiceIds: [], ...extra });
}
function event(id: string, extra: Record<string, unknown> = {}) {
  return EventItem.parse({ ...base, id, slug: id, kind: "event", title: `Synthetic ${id}`, startsAt: "2026-09-20T16:00:00.000Z",
    endsAt: "2026-09-20T18:00:00.000Z", timezone: "America/New_York", hostOrg: "org-penn",
    partner: "health-system", registrationUrl: "https://example.org/register", format: "virtual", ...extra });
}
function html(path: string, items: ContentItem[], search = "") {
  return decorateHtml({ html: '<html><head><title>The Valley Desk</title></head><body><noscript id="tvd-primary"></noscript></body></html>',
    path, origin, nonce: "synthetic-nonce", items, search });
}
function noscript(document: string) { return /<noscript id="tvd-primary">([\s\S]*?)<\/noscript>/.exec(document)![1]!; }

test("filtered News crawler results and canonical metadata match the browser window", () => {
  const items = Array.from({ length: 14 }, (_, n) => news(`matching-${String(n).padStart(2, "0")}`, `Matched research ${n}`));
  items.push(news("unmatched", "Unrelated title"));
  const search = "?q=Matched&page=2";
  const view = filteredNewsPage(items, search);
  assert.equal(view.page.total, 14); assert.equal(view.page.items.length, 2);
  const result = html("/news", items, search), body = noscript(result);
  for (const item of view.page.items) assert.ok(body.includes(item.title));
  assert.ok(!body.includes("Unrelated title"));
  assert.match(result, /<link rel="canonical" href="https:\/\/thevalleydesk.org\/news"/);
  assert.match(result, /<meta name="robots" content="noindex"/);
  assert.match(body, /href="https:\/\/thevalleydesk.org\/news\?q=Matched"/);
  assert.equal(newsEventIndexState("/news", view.request, view.page).prevPath, "/news?q=Matched");
  const graph = routeJsonLd("/news", origin, items, undefined, [], search) as Array<{ url?: string }>;
  assert.equal(graph[1]!.url, `${origin}/news`);
});

test("unfiltered News pages retain indexable canonical pagination and published gates", () => {
  const items = Array.from({ length: 13 }, (_, n) => news(`n-${n}`, `Story ${n}`));
  items.push(news("review", "Not accepted", { status: "review" }));
  const result = html("/news", items, "?page=2&utm_source=mail");
  assert.match(result, /<link rel="canonical" href="https:\/\/thevalleydesk.org\/news\?page=2"/);
  assert.doesNotMatch(result, /<meta name="robots"/);
  assert.ok(!noscript(result).includes("Not accepted"));
});

test("invalid filters fail closed in initial HTML, with an error instead of all stories", () => {
  for (const search of ["?q=one&q=two", "?from=2026-02-29", "?to=2026-04-31"]) {
    const result = html("/news", [news("hidden", "Must not be broadened")], search);
    assert.match(noscript(result), /role="alert"/);
    assert.ok(!noscript(result).includes("Must not be broadened"));
    assert.match(result, /<meta name="robots" content="noindex"/);
  }
});

test("Events HTML uses the same chapter-first ordering and 50-item page as the browser", t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const items = Array.from({ length: 51 }, (_, n) => event(`event-${String(n).padStart(2, "0")}`));
  items.push(event("chapter", { partner: "dvhimss" }));
  const first = filteredEventsPage(items, "", now);
  assert.equal(first.page.items.length, 50);
  assert.equal(first.chapter?.id, "chapter");
  assert.equal(first.page.items[0]!.id, "chapter");
  const result = html("/events", items), body = noscript(result);
  const ids = [...body.matchAll(/href="https:\/\/thevalleydesk.org\/events\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, first.page.items.map(item => item.slug));
  assert.match(result, /<link rel="next" href="https:\/\/thevalleydesk.org\/events\?page=2"/);
  const second = filteredEventsPage(items, "?page=2", now);
  assert.equal(second.page.items.length, 2);
  assert.ok(!primaryNoscript("/events", origin, items, undefined, "?page=2").includes(">Synthetic chapter<"));
});

test("filtered Events preserve filters in pagination and canonicalize to their main directory", t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const items = Array.from({ length: 51 }, (_, n) => event(`v-${n}`));
  items.push(event("physical", { format: "in-person" }));
  const result = html("/events", items, "?format=virtual&page=2");
  assert.match(result, /<meta name="robots" content="noindex"/);
  assert.match(result, /<link rel="canonical" href="https:\/\/thevalleydesk.org\/events"/);
  assert.match(result, /<link rel="prev" href="https:\/\/thevalleydesk.org\/events\?format=virtual"/);
  assert.ok(!noscript(result).includes("Synthetic physical"));
});

test("duplicate page keys are ambiguous and invalid across browser and crawler", () => {
  assert.equal(pageFromSearch("?page=1&page=2").invalid, true);
  const result = html("/news", [news("one", "Synthetic title")], "?page=1&page=2");
  assert.match(result, /<meta name="robots" content="noindex"/);
  assert.ok(!noscript(result).includes("Synthetic title"));
});
