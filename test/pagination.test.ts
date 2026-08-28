import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareNewestThenId,
  LIST_PAGE_SIZE,
  listCanonicalPath,
  listPagePath,
  pageFromSearch,
  paginate,
  parsePageQuery,
} from "../src/content/pagination.ts";
import { latestNews, latestVoices, newsIndexItems, productWatch, publishedNewsList } from "../src/content/queries.ts";
import { NewsItem, VoiceItem, type ContentItem } from "../src/content/schema.ts";
import { decorateHtml, primaryNoscript, routeHead } from "../src/lib/crawler-html.ts";
import { DEFAULT_PUBLIC_ORIGIN } from "../src/lib/canonical.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const base = {
  dek: "dek",
  body: "body",
  updatedAt: "2026-08-22T12:00:00.000Z",
  topics: [] as string[],
  orgs: [] as string[],
  region: "PA" as const,
  authors: [{ name: "Valley Desk" }],
  source: { kind: "editorial" as const, origin: "newsroom" },
  featured: false,
};

function news(partial: Partial<NewsItem> & Pick<NewsItem, "id" | "slug" | "title">): NewsItem {
  return NewsItem.parse({
    ...base,
    kind: "news",
    status: "published",
    publishedAt: "2026-08-22T12:00:00.000Z",
    relatedEventIds: [],
    relatedVoiceIds: [],
    impactSentence: "Impact.",
    orgs: ["org-penn"],
    ...partial,
  });
}

function voice(partial: Partial<VoiceItem> & Pick<VoiceItem, "id" | "slug" | "title" | "person">): VoiceItem {
  return VoiceItem.parse({
    ...base,
    kind: "voice",
    status: "published",
    publishedAt: "2026-08-22T12:00:00.000Z",
    person: partial.person,
    platform: "site",
    originalUrl: "https://example.org/voice",
    ...partial,
  });
}

function manyNews(count: number, publishedAt = "2026-08-22T12:00:00.000Z") {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index).padStart(2, "0");
    return news({
      id: `n-${n}`,
      slug: `story-${n}`,
      title: `Story ${n}`,
      publishedAt,
    });
  });
}

const shell = `<!doctype html><html><head><title>The Valley Desk</title></head><body><noscript id="tvd-primary">fallback</noscript></body></html>`;

test("equal timestamps sort by id and never overlap across pages", () => {
  const items = [
    news({ id: "n-c", slug: "c", title: "C", publishedAt: "2026-08-22T12:00:00.000Z" }),
    news({ id: "n-a", slug: "a", title: "A", publishedAt: "2026-08-22T12:00:00.000Z" }),
    news({ id: "n-b", slug: "b", title: "B", publishedAt: "2026-08-22T12:00:00.000Z" }),
    news({ id: "n-newer", slug: "newer", title: "Newer", publishedAt: "2026-08-23T12:00:00.000Z" }),
  ];
  const ordered = publishedNewsList(items);
  assert.deepEqual(ordered.map((item) => item.id), ["n-newer", "n-a", "n-b", "n-c"]);
  assert.equal(compareNewestThenId(ordered[1]!, ordered[2]!) < 0, true);

  const page1 = paginate(ordered, parsePageQuery(null), 2);
  const page2 = paginate(ordered, parsePageQuery("2"), 2);
  const ids1 = page1.items.map((item) => item.id);
  const ids2 = page2.items.map((item) => item.id);
  assert.deepEqual(ids1, ["n-newer", "n-a"]);
  assert.deepEqual(ids2, ["n-b", "n-c"]);
  assert.equal(ids1.some((id) => ids2.includes(id)), false);
  assert.deepEqual([...ids1, ...ids2].sort(), [...ordered.map((item) => item.id)].sort());
});

test("invalid and out-of-range pages stay empty and do not fall back to page 1", () => {
  const ordered = publishedNewsList(manyNews(5));
  const page1 = paginate(ordered, parsePageQuery(null), 2);
  const invalid = paginate(ordered, pageFromSearch("?page=foo"), 2);
  const empty = paginate(ordered, pageFromSearch("?page="), 2);
  const zero = paginate(ordered, pageFromSearch("?page=0"), 2);
  const padded = paginate(ordered, pageFromSearch("?page=02"), 2);
  const oob = paginate(ordered, pageFromSearch("?page=99"), 2);

  assert.equal(page1.indexable, true);
  assert.equal(page1.items.length, 2);
  assert.equal(invalid.invalid, true);
  assert.equal(invalid.indexable, false);
  assert.deepEqual(invalid.items, []);
  assert.equal(empty.invalid, true);
  assert.deepEqual(empty.items, []);
  assert.equal(zero.invalid, true);
  assert.deepEqual(zero.items, []);
  assert.equal(padded.invalid, true);
  assert.deepEqual(padded.items, []);
  assert.equal(oob.outOfRange, true);
  assert.equal(oob.indexable, false);
  assert.deepEqual(oob.items, []);
  assert.equal(oob.prevPage, page1.totalPages);
  assert.equal(invalid.prevPage, 1);
  assert.equal(page1.items[0]?.id === invalid.items[0]?.id, false);
});

test("home rails stay newest-bounded and do not paginate", () => {
  const items = manyNews(20);
  const homeNews = latestNews(items, 7, new Set(["org-penn"]));
  const homeVoices = latestVoices(
    items.map((item, index) => voice({
      id: `v-${index}`,
      slug: `voice-${index}`,
      title: `Voice ${index}`,
      person: `Person ${index}`,
      publishedAt: item.publishedAt,
    })),
    6,
  );
  assert.equal(homeNews.length, 7);
  assert.equal(homeVoices.length, 6);
  assert.ok(homeNews.length < items.length);

  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  assert.ok(home.includes("latestNews(catalog, 7)"));
  assert.ok(home.includes("latestVoices(catalog)"));
  assert.ok(!home.includes("paginate("));
  assert.ok(!home.includes("pageFromSearch"));
  assert.ok(!home.includes("?page="));

  const noscript = primaryNoscript("/", DEFAULT_PUBLIC_ORIGIN, items);
  assert.ok(noscript.includes("Latest news") || noscript.includes("News"));
  assert.ok(!noscript.includes('rel="next"'));
});

test("product-watch items participate in normal news pagination", () => {
  const watched = Array.from({ length: 3 }, (_, index) => news({
    id: `watch-${index}`,
    slug: `watch-${index}`,
    title: `Watch ${index}`,
    topics: ["product-watch"],
    publishedAt: "2026-08-24T12:00:00.000Z",
  }));
  const rest = manyNews(4, "2026-08-20T12:00:00.000Z");
  const items = [...watched, ...rest];
  assert.equal(productWatch(items).length, 3);
  const index = newsIndexItems(items);
  assert.equal(index.filter((item) => item.id.startsWith("watch-")).length, 3);
  assert.equal(index.length, 7);
  const page1 = paginate(index, parsePageQuery(null), 2);
  assert.equal(page1.items.every((item) => item.topics.includes("product-watch")), true);
});

test("query-aware crawler HTML does not show page 1 for page 2", () => {
  const items = manyNews(LIST_PAGE_SIZE + 3);
  const ordered = newsIndexItems(items);
  const page1Ids = paginate(ordered, parsePageQuery(null)).items.map((item) => item.id);
  const page2Ids = paginate(ordered, parsePageQuery("2")).items.map((item) => item.id);
  assert.ok(page1Ids.length > 0);
  assert.ok(page2Ids.length > 0);

  const page1 = decorateHtml({
    html: shell,
    path: "/news",
    origin: DEFAULT_PUBLIC_ORIGIN,
    nonce: "n1",
    items,
  });
  const page2 = decorateHtml({
    html: shell,
    path: "/news",
    search: "?page=2",
    origin: DEFAULT_PUBLIC_ORIGIN,
    nonce: "n1",
    items,
  });
  const noscript1 = primaryNoscript("/news", DEFAULT_PUBLIC_ORIGIN, items);
  const noscript2 = primaryNoscript("/news", DEFAULT_PUBLIC_ORIGIN, items, undefined, "?page=2");

  for (const id of page1Ids) {
    const title = ordered.find((item) => item.id === id)!.title;
    assert.ok(noscript1.includes(title), title);
    assert.equal(noscript2.includes(title), false, title);
  }
  for (const id of page2Ids) {
    const title = ordered.find((item) => item.id === id)!.title;
    assert.ok(noscript2.includes(title), title);
    assert.equal(noscript1.includes(title), false, title);
  }
  assert.ok(page2.includes('rel="canonical" href="https://thevalleydesk.org/news?page=2"'));
  assert.ok(page1.includes('rel="canonical" href="https://thevalleydesk.org/news"'));
  assert.ok(!page1.includes("news?page=1"));
  assert.ok(page2.includes("Page 2"));
  assert.ok(page2.includes('rel="prev"'));
  assert.ok(page1.includes('rel="next"'));
  assert.ok(noscript2.includes('aria-label="News pagination"'));
  assert.ok(noscript2.includes('rel="prev"'));
  assert.equal(page2.includes('name="robots"'), false);

  const invalid = decorateHtml({
    html: shell,
    path: "/news",
    search: "?page=nope",
    origin: DEFAULT_PUBLIC_ORIGIN,
    nonce: "n1",
    items,
  });
  const invalidNoscript = primaryNoscript("/news", DEFAULT_PUBLIC_ORIGIN, items, undefined, "?page=nope");
  assert.ok(invalid.includes('name="robots" content="noindex"'));
  for (const title of page1Ids.map((id) => ordered.find((item) => item.id === id)!.title)) {
    assert.equal(invalidNoscript.includes(title), false, title);
  }
  assert.ok(invalidNoscript.includes("This page is not in the list."));
});

test("canonical URLs strip page 1 and keep later pages", () => {
  const items = manyNews(LIST_PAGE_SIZE + 1);
  const window1 = paginate(newsIndexItems(items), pageFromSearch(""));
  const windowExplicit = paginate(newsIndexItems(items), pageFromSearch("?page=1"));
  const window2 = paginate(newsIndexItems(items), pageFromSearch("?page=2"));
  assert.equal(listCanonicalPath("/news", window1), "/news");
  assert.equal(listCanonicalPath("/news", windowExplicit), "/news");
  assert.equal(listCanonicalPath("/news", window2), "/news?page=2");
  assert.equal(listPagePath("/voices", 1), "/voices");
  assert.equal(listPagePath("/voices", 3), "/voices?page=3");

  const head1 = routeHead("/news", DEFAULT_PUBLIC_ORIGIN, undefined, {
    path: "/news",
    name: "News",
    window: window1,
  });
  const head2 = routeHead("/news", DEFAULT_PUBLIC_ORIGIN, undefined, {
    path: "/news",
    name: "News",
    window: window2,
  });
  assert.equal(head1.url, `${DEFAULT_PUBLIC_ORIGIN}/news`);
  assert.equal(head2.url, `${DEFAULT_PUBLIC_ORIGIN}/news?page=2`);
  assert.equal(head2.title.includes("Page 2"), true);

  const voices = Array.from({ length: LIST_PAGE_SIZE + 2 }, (_, index) => voice({
    id: `voice-${String(index).padStart(2, "0")}`,
    slug: `voice-${index}`,
    title: `Voice ${index}`,
    person: `Person ${index}`,
  }));
  const html2 = decorateHtml({
    html: shell,
    path: "/voices",
    search: "?page=2",
    origin: DEFAULT_PUBLIC_ORIGIN,
    nonce: "n1",
    items: voices,
  });
  assert.ok(html2.includes('rel="canonical" href="https://thevalleydesk.org/voices?page=2"'));
  const noscript2 = primaryNoscript("/voices", DEFAULT_PUBLIC_ORIGIN, voices, undefined, "?page=2");
  const first = paginate(latestVoices(voices, Number.MAX_SAFE_INTEGER), parsePageQuery(null)).items[0]!;
  assert.equal(noscript2.includes(first.title), false);
});

test("KindListPage and Worker stay query-aware without a second Worker", () => {
  const page = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const head = readFileSync(join(root, "src/ui/DocumentHead.tsx"), "utf8");
  const crawler = readFileSync(join(root, "src/lib/crawler-html.ts"), "utf8");

  assert.ok(page.includes("publishedNewsList(catalog)"));
  assert.ok(page.includes("latestVoices(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(!page.includes("productWatch(catalog)"));
  assert.ok(page.includes("pageFromSearch"));
  assert.ok(page.includes('rel="prev"'));
  assert.ok(page.includes('rel="next"'));
  assert.ok(page.includes("aria-label"));
  assert.ok(worker.includes("search: url.search"));
  assert.ok(head.includes("searchStr"));
  assert.ok(head.includes("listCanonicalPath"));
  assert.ok(crawler.includes("pageFromSearch"));
  assert.ok(!wrangler.includes("the-valley-desk-staging"));
  assert.equal((wrangler.match(/"name": "the-valley-desk"/g) ?? []).length, 1);
});

test("pagination helpers accept ContentItem lists", () => {
  const mixed: ContentItem[] = [
    ...manyNews(2),
    voice({ id: "v-1", slug: "v-1", title: "Voice", person: "Pat" }),
  ];
  const voices = latestVoices(mixed, Number.MAX_SAFE_INTEGER);
  assert.equal(voices.length, 1);
  const paged = paginate(voices, parsePageQuery("1"));
  assert.equal(paged.indexable, true);
  assert.equal(paged.items[0]?.id, "v-1");
});
