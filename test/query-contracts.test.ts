import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  briefingSinceYesterday5pmET,
  featuredLead,
  latestNews,
  leadItem,
  upcomingEvents,
} from "../src/content/queries.ts";
import {
  ContentCatalog,
  ContentItem,
  EventItem,
  NewsItem,
  setFeaturedNews,
} from "../src/content/schema.ts";
import { toReviewQueue } from "../src/ingest/envelope.ts";
import { rssItemToContent } from "../src/ingest/rss.ts";
import { CLOSED_LIVE_SEED_IDS, hasLiveSeedOrg, liveSeedOrgIds } from "../src/content/seed.ts";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entities = require("../fixtures/entities.json") as { id: string }[];
const catalog = ContentCatalog.parse(JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8")));
const seedIds = liveSeedOrgIds(entities);

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

test("leadItem is featured published news only and never briefing[0]", () => {
  const briefingTop = news({
    id: "n-brief-top",
    slug: "brief-top",
    title: "Briefing top",
    publishedAt: "2026-08-22T18:00:00.000Z",
    featured: false,
  });
  const featured = news({
    id: "n-lead",
    slug: "lead",
    title: "Lead",
    publishedAt: "2026-08-21T12:00:00.000Z",
    featured: true,
  });
  const items = [briefingTop, featured];
  const desk = briefingSinceYesterday5pmET(items, new Date("2026-08-22T20:00:00.000Z"));
  assert.equal(desk[0]?.id, "n-brief-top");
  assert.equal(leadItem(items)?.id, "n-lead");
  assert.equal(featuredLead(items)?.id, "n-lead");
  assert.notEqual(leadItem(items)?.id, desk[0]?.id);
});

test("leadItem is undefined when no featured news — does not fall back", () => {
  const items = [
    news({ id: "n1", slug: "n1", title: "One", featured: false }),
    news({ id: "n2", slug: "n2", title: "Two", featured: false }),
  ];
  const desk = briefingSinceYesterday5pmET(items, new Date("2026-08-22T20:00:00.000Z"));
  assert.ok(desk.length > 0);
  assert.equal(leadItem(items), undefined);
  assert.equal(featuredLead(items), undefined);
});

test("leadItem ignores featured events, policy, and news without impactSentence", () => {
  const event = EventItem.parse({
    ...base,
    kind: "event",
    status: "published",
    publishedAt: "2026-08-22T12:00:00.000Z",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    featured: true,
    orgs: ["org-dvhimss"],
  });
  const policy = ContentItem.parse({
    ...base,
    kind: "policy",
    status: "published",
    publishedAt: "2026-08-22T12:00:00.000Z",
    jurisdiction: "PA",
    issuer: "PA-DOH",
    changeType: "guidance",
    impactSentence: "Policy impact.",
    featured: true,
    orgs: ["org-pa-doh"],
  });
  const noImpact = {
    ...news({ id: "n-empty", slug: "n-empty", title: "Empty", featured: true }),
    impactSentence: "",
  };
  assert.equal(leadItem([event, policy, noImpact]), undefined);
});

test("setFeaturedNews clears the previous featured news", () => {
  const a = news({ id: "a", slug: "a", title: "A", featured: true });
  const b = news({ id: "b", slug: "b", title: "B", featured: false });
  const next = setFeaturedNews([a, b], "b");
  assert.equal(next.find((i) => i.id === "a")?.featured, false);
  assert.equal(next.find((i) => i.id === "b")?.featured, true);
  ContentCatalog.parse(next);
});

test("catalog refine rejects two featured published news", () => {
  const a = news({ id: "a", slug: "a", title: "A", featured: true });
  const b = news({ id: "b", slug: "b", title: "B", featured: true });
  assert.throws(() => ContentCatalog.parse([a, b]));
});

test("latestNews is published news|policy|ai with impactSentence and a live seed org", () => {
  const rows = latestNews(catalog, 20, seedIds);
  assert.ok(rows.every((i) => i.status === "published"));
  assert.ok(rows.every((i) => i.kind === "news" || i.kind === "policy" || i.kind === "ai"));
  assert.ok(rows.every((i) => i.impactSentence?.trim()));
  assert.ok(rows.every((i) => hasLiveSeedOrg(i.orgs, seedIds)));
  assert.ok(rows.every((i) => i.kind !== "interview"));
  const ids = rows.map((i) => i.id);
  assert.ok(ids.includes("news-01"));
  assert.ok(ids.includes("policy-01"));
  assert.ok(ids.includes("news-jefferson-einstein-mychart"));
  assert.ok(ids.includes("news-christianacare-epic"));
  assert.ok(!ids.includes("ai-01"));
  assert.ok(!ids.includes("int-01"));
  assert.ok(!ids.includes("evt-01"));
  for (let i = 1; i < rows.length; i++) {
    assert.ok((rows[i - 1].publishedAt ?? "") >= (rows[i].publishedAt ?? ""));
  }
});

test("latestNews bounces empty orgs, review, interview, and Crozer-only orgs", () => {
  const nationalAi = ContentItem.parse({
    ...base,
    kind: "ai",
    status: "published",
    publishedAt: "2026-08-22T15:00:00.000Z",
    vendor: "Epic",
    product: "Ambient",
    announcedAt: "2026-08-22T15:00:00.000Z",
    impactSentence: "National release with no Valley system named.",
    orgs: [],
  });
  const crozerOnly = news({
    id: "n-crozer",
    slug: "n-crozer",
    title: "Crozer",
    orgs: ["org-crozer"],
  });
  const reviewNews = news({
    id: "n-review",
    slug: "n-review",
    title: "Review",
    status: "review",
  });
  const interview = ContentItem.parse({
    ...base,
    kind: "interview",
    status: "published",
    publishedAt: "2026-08-22T16:00:00.000Z",
    exclusive: true,
    guest: "Cole",
    guestOrg: "The Valley Desk",
    impactSentence: "Interview impact.",
    orgs: ["org-dvhimss"],
  });
  const seeds = liveSeedOrgIds([...entities, { id: "org-crozer" }]);
  assert.ok(CLOSED_LIVE_SEED_IDS.has("org-crozer"));
  assert.ok(!seeds.has("org-crozer"));
  const rows = latestNews([nationalAi, crozerOnly, reviewNews, interview], 10, seeds);
  assert.deepEqual(rows.map((i) => i.id), []);
});

test("upcomingEvents is published events with startsAt >= now and never reads clockAt", () => {
  const now = new Date("2026-08-22T20:00:00.000Z");
  const past = EventItem.parse({
    ...base,
    kind: "event",
    status: "published",
    startsAt: "2026-08-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
  });
  const queued = EventItem.parse({
    ...base,
    kind: "event",
    status: "review",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
  });
  const clockNews = news({
    id: "clock",
    slug: "clock",
    title: "Clock",
    clockAt: "2026-09-26T04:00:00.000Z",
  });
  const future = EventItem.parse({
    ...base,
    kind: "event",
    status: "published",
    startsAt: "2026-09-17T21:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
  });
  const rows = upcomingEvents([past, queued, clockNews, future], now, 10);
  assert.deepEqual(rows.map((i) => i.id), [future.id]);
  assert.ok(rows.every((i) => i.kind === "event"));
  assert.ok(!("clockAt" in (rows[0] ?? {})));
});

test("briefingSinceYesterday5pmET includes review, sorts clockAt else publishedAt, overlap ties", () => {
  const now = new Date("2026-08-22T20:00:00.000Z");
  const clock = news({
    id: "clock",
    slug: "clock",
    title: "Clock",
    publishedAt: "2026-08-21T22:00:00.000Z",
    clockAt: "2026-10-03T04:00:00.000Z",
    orgs: ["org-jefferson"],
    topics: ["EHR"],
  });
  const sharedA = news({
    id: "shared-a",
    slug: "shared-a",
    title: "Shared A",
    publishedAt: "2026-08-22T10:00:00.000Z",
    orgs: ["org-penn"],
    topics: ["AI"],
  });
  const sharedReview = news({
    id: "shared-review",
    slug: "shared-review",
    title: "Shared review",
    status: "review",
    publishedAt: undefined,
    updatedAt: "2026-08-22T12:00:00.000Z",
    orgs: ["org-penn"],
    topics: ["AI"],
  });
  const draft = news({
    id: "draft",
    slug: "draft",
    title: "Draft",
    status: "draft",
    publishedAt: "2026-08-22T19:00:00.000Z",
  });
  const desk = briefingSinceYesterday5pmET([clock, sharedA, sharedReview, draft], now);
  assert.deepEqual(
    desk.map((i) => i.id),
    ["clock", "shared-review", "shared-a"],
  );
  assert.ok(!desk.some((i) => i.id === "draft"));
  assert.ok(desk.some((i) => i.status === "review"));
});

test("clockAt is NewsItem-only; EventItem parse strips it", () => {
  const parsed = EventItem.parse({
    ...base,
    kind: "event",
    status: "published",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    clockAt: "2026-09-26T04:00:00.000Z",
  });
  assert.equal("clockAt" in parsed, false);
});

test("annotations are only valid on briefing rows and the featured lead", () => {
  const lead = news({
    id: "lead",
    slug: "lead",
    title: "Lead",
    featured: true,
    annotations: [{ type: "ask", text: "Who owns the cutover?" }],
  });
  ContentItem.parse(lead);
  const ordinary = news({
    id: "ord",
    slug: "ord",
    title: "Ordinary",
    featured: false,
    annotations: [{ type: "spill", text: "No" }],
  });
  assert.throws(() => ContentItem.parse(ordinary));
});

test("ingest never sets featured=true or keeps clockAt/annotations", () => {
  const raw = rssItemToContent(
    {
      title: "Ingested",
      link: "https://example.com/a",
      description: "desc",
      pubDate: "Fri, 22 Aug 2026 12:00:00 GMT",
      guid: "https://example.com/a",
    },
    "Inquirer Health",
    "2026-08-22T20:00:00.000Z",
    0,
  );
  assert.equal(raw.featured, false);
  const sneak = news({
    id: "sneak",
    slug: "sneak",
    title: "Sneak",
    featured: true,
    clockAt: "2026-09-26T04:00:00.000Z",
    annotations: [{ type: "ask", text: "nope" }],
    source: { kind: "ingest", origin: "rss", url: "https://example.com/a" },
  });
  const [queued] = toReviewQueue({
    adapter: "rss",
    fetchedAt: "2026-08-22T20:00:00.000Z",
    items: [sneak],
  });
  assert.equal(queued.featured, false);
  assert.equal(queued.kind === "news" ? queued.clockAt : "missing", undefined);
  assert.equal(queued.annotations, undefined);
});

test("fixture catalog has news clocks, no Crozer, no featured lead", () => {
  assert.equal(leadItem(catalog), undefined);
  const jefferson = catalog.find((i) => i.id === "news-jefferson-einstein-mychart");
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic");
  assert.equal(jefferson?.kind, "news");
  assert.equal(christiana?.kind, "news");
  assert.equal(jefferson && jefferson.kind === "news" ? jefferson.clockAt : undefined, "2026-09-26T04:00:00.000Z");
  assert.equal(christiana && christiana.kind === "news" ? christiana.clockAt : undefined, "2026-10-03T04:00:00.000Z");
  assert.ok(!JSON.stringify(catalog).includes("Crozer"));
  assert.ok(!JSON.stringify(entities).includes("Crozer"));
});

test("leadItem source does not call briefingSinceYesterday5pmET", () => {
  const src = readFileSync(join(root, "src/content/queries.ts"), "utf8");
  const leadFn = src.slice(src.indexOf("export function leadItem"), src.indexOf("export const featuredLead"));
  assert.ok(!leadFn.includes("briefingSinceYesterday5pmET"));
  assert.ok(!leadFn.includes("briefing[0]"));
  assert.ok(!src.includes("deskClocks"));
});
