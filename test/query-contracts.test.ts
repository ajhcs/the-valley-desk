import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  briefingSinceYesterday5pmET,
  featuredLead,
  isPublicNewsFamily,
  bySlug,
  latestNews,
  latestVoices,
  publishedNewsList,
  leadItem,
  nextChapterEvent,
  pinnedUpcomingEvents,
  upcomingEvents,
} from "../src/content/queries.ts";
import {
  ContentCatalog,
  ContentItem,
  EventItem,
  NewsItem,
  setFeaturedNews,
  canPublish,
  itemCitations,
} from "../src/content/schema.ts";
import { toReviewQueue } from "../src/ingest/envelope.ts";
import { rssItemToContent } from "../src/ingest/rss.ts";
import { ingestLinkedIn } from "../src/ingest/linkedin.ts";
import { ingestX } from "../src/ingest/x.ts";
import { mergeReviewQueue } from "../src/ingest/queue.ts";
import { firstWaveOrigins, isHeldHandle, isLiveSocialKey, liveLinkedInOrigins, liveXOrigins } from "../src/ingest/origins.ts";
import { CLOSED_LIVE_SEED_IDS, hasLiveSeedOrg, liveSeedOrgIds } from "../src/content/seed.ts";
import { eventRegisterUrl } from "../src/lib/register.ts";
import { eventJsonLd, itemJsonLd } from "../src/content/jsonld.ts";
import { toFeed } from "../src/ingest/feed-contract.ts";
import { canonicalUrl, canonicalPath } from "../src/lib/canonical.ts";
import { eventPlace, formatChipLabel, formatDate, formatLeadDate, listDek, listSourceLine } from "../src/lib/format.ts";
import { KIND_CHIP, chipKind, kindChip } from "../src/lib/kind.ts";
import { Entity } from "../src/content/entity.ts";
import { citableFacts, factBearingEntities, findFirstMentions, itemSignedFacts } from "../src/lib/entityFacts.ts";
import { placeOrgChip } from "../src/lib/placeOrgChip.ts";
import { itemByline, newsByline } from "../src/lib/byline.ts";
import { navSection } from "../src/lib/nav.ts";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entities = require("../fixtures/entities.json") as { id: string }[];
const entityRows = Entity.array().parse(JSON.parse(readFileSync(join(root, "fixtures/entities.json"), "utf8")));
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
    id: "evt-featured",
    slug: "evt-featured",
    title: "Featured event",
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
    id: "pol-featured",
    slug: "pol-featured",
    title: "Featured policy",
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
  const slugs = rows.map((i) => i.slug).sort();
  assert.deepEqual(slugs, [
    "chop-orca-cds",
    "hap-cms-0057-f-enforce-rfi",
    "jefferson-einstein-mychart-2026-09-26",
    "jefferson-fy2026-operating-loss",
    "penn-in-house-ai-scribe",
    "temple-chestnut-hill-jhp-2026-09-30",
    "temple-dragon-copilot-400",
    "tower-ai-tax",
  ]);
  assert.ok(!slugs.includes("christianacare-epic-go-live"));
  assert.ok(!slugs.includes("de-340b-hs1-hb383-2024"));
  assert.ok(rows.every((i) => i.featured !== true));
  assert.ok(!ids.includes("news-01"));
  assert.ok(!ids.includes("policy-01"));
  assert.ok(!ids.includes("news-jefferson-einstein-mychart"));
  assert.ok(!ids.includes("ai-01"));
  assert.ok(!ids.includes("int-01"));
  assert.ok(!ids.includes("evt-01"));
  assert.ok(!ids.includes("voice-mlh-cloud-analytics"));
  assert.ok(!ids.includes("voice-temple-honor-roll-2026"));
  assert.ok(rows.every((i) => i.kind !== "voice"));
  for (let i = 1; i < rows.length; i++) {
    assert.ok((rows[i - 1].publishedAt ?? "") >= (rows[i].publishedAt ?? ""));
  }
});

test("latestNews bounces empty orgs, review, interview, and Crozer-only orgs", () => {
  const nationalAi = ContentItem.parse({
    ...base,
    id: "ai-national",
    slug: "ai-national",
    title: "National AI",
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
    id: "int-published",
    slug: "int-published",
    title: "Interview",
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

test("kind chip is item.kind, never topics[0]; Jefferson loss is HIT", () => {
  const loss = catalog.find((i) => i.id === "news-jefferson-fy2026-loss");
  assert.ok(loss);
  assert.equal(loss.kind, "news");
  assert.equal(loss.topics[0], "finance");
  assert.equal(kindChip(loss), "HIT");
  assert.notEqual(kindChip(loss), loss.topics[0]);
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe");
  assert.ok(penn);
  assert.equal(penn.kind, "news");
  assert.equal(penn.topics[0], "AI");
  assert.equal(kindChip(penn), "AI");
  assert.equal(chipKind(penn), "ai");
  const hap = catalog.find((i) => i.slug === "hap-cms-0057-f-enforce-rfi");
  assert.ok(hap);
  assert.equal(hap.kind, "news");
  assert.equal(kindChip(hap), "POLICY");
  assert.notEqual(kindChip(hap), "HIT");
  const policy = catalog.find((i) => i.kind === "policy");
  assert.ok(policy);
  assert.equal(kindChip(policy), "POLICY");
  const ai = catalog.find((i) => i.id === "ai-01");
  assert.ok(ai);
  assert.equal(kindChip(ai), "AI");
  const chapter = catalog.find((i) => i.kind === "event");
  assert.ok(chapter);
  assert.equal(kindChip(chapter), "CHAPTER");
  assert.equal(KIND_CHIP.news, "HIT");
  assert.equal(KIND_CHIP.event, "CHAPTER");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const card = readFileSync(join(root, "src/ui/ItemCard.tsx"), "utf8");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(!rail.includes("topics[0]"));
  assert.ok(!card.includes("topics[0]"));
  assert.ok(!itemPage.includes("topics[0]"));
  assert.ok(rail.includes("kindChip"));
  assert.ok(card.includes("kindChip"));
  assert.ok(itemPage.includes("kindChip"));
  assert.ok(itemPage.includes("GroupChip"));
  assert.ok(!itemPage.includes("StatusChip"));
});

test("kind chip paint is mute/rule, ink, or admiral — never sky, never gold except QUEUED", () => {
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const kindNews = css.slice(css.indexOf('.GroupChip[data-kind="news"]'), css.indexOf('.GroupChip[data-kind="policy"]'));
  const kindPolicy = css.slice(css.indexOf('.GroupChip[data-kind="policy"]'), css.indexOf('.GroupChip[data-kind="ai"]'));
  const kindAi = css.slice(css.indexOf('.GroupChip[data-kind="ai"]'), css.indexOf('.StatusChip[data-status="review"]'));
  const queued = css.slice(css.indexOf('.StatusChip[data-status="review"]'));
  assert.ok(kindNews.includes("var(--mute)"));
  assert.ok(kindNews.includes("var(--rule)"));
  assert.ok(kindNews.includes('[data-kind="event"]'));
  assert.ok(!kindNews.includes("var(--sky)"));
  assert.ok(!kindNews.includes("var(--event)"));
  assert.ok(!kindNews.includes("var(--events)"));
  assert.ok(kindPolicy.includes("var(--ink)"));
  assert.ok(!kindPolicy.includes("var(--sky)"));
  assert.ok(!kindPolicy.includes("var(--event)"));
  assert.ok(kindAi.includes("var(--admiral)"));
  assert.ok(!kindAi.includes("var(--sky)"));
  assert.ok(!kindAi.includes("var(--event)"));
  assert.ok(queued.includes("var(--event)"));
  assert.ok(queued.includes("data-queued"));
});

test("KindListPage /news uses publishedNewsList; ai-01 stays out", () => {
  const page = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  assert.ok(page.includes("publishedNewsList(catalog)"));
  assert.ok(!page.includes("latestNews(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(page.includes("Rail"));
  assert.ok(page.includes("NEWS · LATEST"));
  assert.ok(page.includes("EVENTS · NEXT"));
  assert.ok(page.includes("VOICES · LATEST"));
  assert.ok(page.includes("latestVoices(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(!page.includes("ItemCard"));
  assert.ok(!page.includes("newsFamily"));
  assert.ok(home.includes("latestNews(catalog)"));
  const ai = catalog.find((i) => i.id === "ai-01");
  assert.ok(ai);
  assert.deepEqual(ai.orgs, []);
  assert.ok(ai.impactSentence?.trim());
  assert.equal(ai.status, "draft");
  assert.ok(!isPublicNewsFamily(ai, seedIds));
  const newsPage = publishedNewsList(catalog);
  assert.ok(!newsPage.some((i) => i.id === "ai-01"));
  assert.ok(newsPage.some((i) => i.id === "news-jefferson-fy2026-loss"));
  assert.ok(newsPage.some((i) => i.slug === "de-340b-hs1-hb383-2024"));
  assert.ok(!newsPage.some((i) => i.slug === "christianacare-epic-go-live"));
  assert.ok(newsPage.every((i) => i.status === "published"));
  assert.ok(newsPage.every((i) => i.kind === "news" || i.kind === "policy" || i.kind === "ai"));
});

test("upcomingEvents is published events with startsAt >= now and never reads clockAt", () => {
  const now = new Date("2026-08-22T20:00:00.000Z");
  const past = EventItem.parse({
    ...base,
    id: "evt-past",
    slug: "evt-past",
    title: "Past",
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
    id: "evt-queued",
    slug: "evt-queued",
    title: "Queued",
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
    id: "evt-future",
    slug: "evt-future",
    title: "Future",
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

test("briefingSinceYesterday5pmET sorts by clockAt else publishedAt; overlap is tiebreak only; includes review", () => {
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
  const sharedOlder = news({
    id: "shared-older",
    slug: "shared-older",
    title: "Shared older",
    publishedAt: "2026-08-22T10:00:00.000Z",
    orgs: ["org-penn"],
    topics: ["AI"],
  });
  const sharedNewer = news({
    id: "shared-newer",
    slug: "shared-newer",
    title: "Shared newer",
    publishedAt: "2026-08-22T14:00:00.000Z",
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
  const desk = briefingSinceYesterday5pmET([clock, sharedOlder, sharedNewer, sharedReview, draft], now);
  assert.deepEqual(
    desk.map((i) => i.id),
    ["clock", "shared-newer", "shared-review", "shared-older"],
  );
  assert.ok(desk.some((i) => i.status === "review"));
  assert.ok(!desk.some((i) => i.id === "draft"));
  const tiedA = news({
    id: "tied-a",
    slug: "tied-a",
    title: "Tied A",
    publishedAt: "2026-08-22T11:00:00.000Z",
    orgs: ["org-penn"],
    topics: ["AI"],
  });
  const tiedB = news({
    id: "tied-b",
    slug: "tied-b",
    title: "Tied B",
    publishedAt: "2026-08-22T11:00:00.000Z",
    orgs: ["org-solo"],
    topics: ["alone"],
  });
  const tiedC = news({
    id: "tied-c",
    slug: "tied-c",
    title: "Tied C",
    publishedAt: "2026-08-22T11:00:00.000Z",
    orgs: ["org-penn"],
    topics: ["AI"],
  });
  const tied = briefingSinceYesterday5pmET([tiedB, tiedA, tiedC], now);
  assert.equal(tied[tied.length - 1]?.id, "tied-b");
  const src = readFileSync(join(root, "src/content/queries.ts"), "utf8");
  const deskFn = src.slice(
    src.indexOf("export function briefingSinceYesterday5pmET"),
    src.indexOf("function isLeadNews"),
  );
  assert.ok(deskFn.includes("deskSortKey"));
  assert.ok(src.includes("clockAt if present"));
  assert.ok(src.includes('item.status !== "review"'));
});

test("clockAt is NewsItem-only; EventItem parse strips it", () => {
  const parsed = EventItem.parse({
    ...base,
    id: "evt-clock",
    slug: "evt-clock",
    title: "Not a clock",
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

test("annotations are allowed on published desk rows and the featured lead", () => {
  const lead = news({
    id: "lead",
    slug: "lead",
    title: "Lead",
    featured: true,
    annotations: [{ type: "ask", text: "Who owns the cutover?" }],
  });
  ContentItem.parse(lead);
  const clockSpill = news({
    id: "clock-spill",
    slug: "clock-spill",
    title: "Clock spill",
    featured: false,
    clockAt: "2026-09-26T04:00:00.000Z",
    annotations: [{ type: "spill", text: "Einstein MyChart, not an event." }],
  });
  ContentItem.parse(clockSpill);
  const queued = news({
    id: "queued-ann",
    slug: "queued-ann",
    title: "Queued",
    status: "review",
    annotations: [{ type: "spill", text: "No" }],
  });
  assert.throws(() => ContentItem.parse(queued));
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

test("fixture catalog has news clocks, no Crozer, ChristianaCare Epic featured lead", () => {
  assert.equal(leadItem(catalog)?.id, "news-christianacare-epic");
  const jefferson = catalog.find((i) => i.id === "news-jefferson-einstein-mychart");
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic");
  assert.equal(jefferson?.kind, "news");
  assert.equal(christiana?.kind, "news");
  assert.equal(christiana?.featured, true);
  assert.equal(jefferson && jefferson.kind === "news" ? jefferson.clockAt : undefined, "2026-09-26T04:00:00.000Z");
  assert.equal(christiana && christiana.kind === "news" ? christiana.clockAt : undefined, "2026-10-03T04:00:00.000Z");
  assert.ok(!JSON.stringify(catalog).includes("Crozer"));
  assert.ok(!JSON.stringify(entities).includes("Crozer"));
});

test("Sloan four: published, ChristianaCare featured, source publishedAt, Penn and Temple stay separate", () => {
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic");
  const loss = catalog.find((i) => i.id === "news-jefferson-fy2026-loss");
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe");
  const temple = catalog.find((i) => i.id === "news-temple-dragon-copilot");
  assert.ok(christiana && loss && penn && temple);
  assert.equal(christiana.featured, true);
  for (const item of [loss, penn, temple]) {
    assert.equal(item.status, "published");
    assert.equal(item.featured, false);
    assert.equal(item.kind, "news");
  }
  assert.equal(christiana.status, "published");
  assert.equal(christiana.kind, "news");
  assert.equal(christiana.title, "ChristianaCare Epic go-live, official July 2026 update");
  assert.equal(christiana.kind === "news" ? christiana.clockAt : undefined, "2026-10-03T04:00:00.000Z");
  assert.equal(christiana.publishedAt, "2026-07-01T16:00:00.000Z");
  assert.deepEqual(christiana.orgs, ["org-christianacare"]);
  assert.equal(christiana.citations?.length, 2);
  assert.equal(christiana.source.url, christiana.citations?.[0]?.url);
  assert.equal(
    christiana.citations?.[0]?.url,
    "https://news.christianacare.org/2026/07/christianacare-advances-epic-electronic-health-record-implementation-for-oct-3-go-live/",
  );
  assert.ok(christiana.citations?.some((c) => c.url.includes("beckershospitalreview.com")));
  assert.ok(!christiana.citations?.some((c) => c.url.includes("app.fac.gov")));
  assert.ok(!christiana.body.includes("49.364"));
  assert.ok(!christiana.body.includes("FAC Note 18"));
  assert.ok(christiana.body.endsWith("That clip is not an Epic dollar."));
  assert.equal(loss.title, "Jefferson FY2026 operating loss and Fitch liquidity");
  assert.equal(loss.kind === "news" ? loss.clockAt : "none", undefined);
  assert.equal(loss.publishedAt, "2026-08-14T16:00:00.000Z");
  assert.deepEqual(loss.orgs, ["org-jefferson"]);
  assert.equal(loss.citations?.length, 2);
  assert.equal(loss.source.url, loss.citations?.[0]?.url);
  assert.ok(loss.body.includes("Independence Blue Cross"));
  assert.ok(loss.body.includes("Aetna"));
  assert.ok(!loss.body.includes("This desk has not opened the EMMA year-end PDF."));
  assert.ok(loss.body.includes("Those nine-month figures are not a substitute for the June 30 year-end loss."));
  assert.equal(penn.title, "Penn in-house scribe headcount and 2024 JAMA pilot table");
  assert.equal(penn.kind === "news" ? penn.clockAt : "none", undefined);
  assert.equal(penn.publishedAt, "2025-11-10T16:00:00.000Z");
  assert.deepEqual(penn.orgs, ["org-penn"]);
  assert.equal(penn.citations?.length, 3);
  assert.equal(penn.source.url, penn.citations?.[0]?.url);
  const pennLead = `${penn.title}\n${penn.dek}\n${penn.impactSentence}`;
  assert.ok(pennLead.includes("1,200"));
  assert.ok(penn.body.endsWith("Temple Dragon counts are not this count."));
  assert.ok(!/slovis/i.test(`${penn.title} ${penn.dek} ${penn.body}`));
  assert.ok(!/does not name a commercial vendor|no vendor/i.test(`${penn.title} ${penn.dek} ${penn.body}`));
  assert.equal(temple.title, "Temple Dragon Copilot user count and TUHS cash days");
  assert.equal(temple.slug, "temple-dragon-copilot-400");
  assert.equal(temple.kind === "news" ? temple.clockAt : "none", undefined);
  assert.equal(temple.publishedAt, "2026-08-01T16:00:00.000Z");
  assert.deepEqual(temple.orgs, ["org-temple", "org-temple-tuh-main"]);
  assert.equal(temple.citations?.length, 4);
  assert.equal(temple.source.url, temple.citations?.[0]?.url);
  assert.ok(temple.body.includes("chief medical information officer at Philadelphia-based Temple Health"));
  assert.ok(temple.body.includes("Chief Medical Information Officer for Temple University Hospital"));
  assert.ok(temple.body.endsWith("That line is not a Copilot, user, or after-hours metric. Penn 1,200 and JAMA 46 are not this count."));
  assert.ok(!temple.body.includes("Do not fuse those two sentences."));
  assert.ok(!/honor.?roll|epic-names-temple|july 16/i.test(JSON.stringify(temple)));
  assert.ok(!/capalongo/i.test(`${temple.title} ${temple.dek} ${temple.body}`));
  assert.ok(temple.citations?.some((c) => c.name === "PBJ April 1 (sponsored)" && c.url.includes("bizjournals.com")));
  const blob = JSON.stringify(catalog);
  assert.ok(!blob.includes("org-ibc"));
  assert.ok(!blob.includes("org-aetna"));
  assert.ok(!blob.includes("org-microsoft"));
  assert.ok(
    !catalog.some(
      (i) => i.id.startsWith("news-") && i.id !== "news-chop-orca-cds" && /chop/i.test(`${i.id} ${i.title}`),
    ),
  );
  assert.equal(catalog.filter((i) => i.id.startsWith("news-") && i.featured).length, 1);
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.id).join(), "news-christianacare-epic");
});

test("CHOP ORCA and Tower AI tax fixtures: published, not featured, seed orgs, cite counts", () => {
  const chop = catalog.find((i) => i.id === "news-chop-orca-cds");
  const tower = catalog.find((i) => i.id === "news-tower-ai-tax");
  assert.ok(chop && tower);
  assert.equal(chop.slug, "chop-orca-cds");
  assert.equal(tower.slug, "tower-ai-tax");
  for (const item of [chop, tower]) {
    assert.equal(item.kind, "news");
    assert.equal(item.status, "published");
    assert.equal(item.featured, false);
    assert.ok(item.impactSentence?.trim());
    assert.ok(hasLiveSeedOrg(item.orgs, seedIds));
  }
  assert.deepEqual(chop.orgs, ["org-chop"]);
  assert.equal(chop.featured, false);
  assert.equal(chop.title, "CHOP ORCA repo for Epic downtime order sets");
  assert.equal(
    chop.dek,
    "GitHub plus two Aug. 3 LinkedIn posts. Desai and Salmasian are posters, not authors.",
  );
  assert.ok(!chop.dek.includes("No paper n"));
  assert.ok(chop.body.includes("posters, not authors"));
  assert.ok(chop.body.includes("not MIT"));
  assert.ok(!chop.body.includes("HOLD"));
  assert.equal(chop.citations?.length, 3);
  assert.equal(chop.source.url, chop.citations?.[0]?.url);
  assert.ok(!chop.citations?.some((c) => /doi\.org|10\.1055/i.test(c.url)));
  assert.deepEqual(tower.orgs, ["org-tower"]);
  assert.equal(tower.citations?.length, 2);
  assert.equal(tower.source.url, tower.citations?.[0]?.url);
  assert.ok(!/honor.?roll/i.test(JSON.stringify(chop) + JSON.stringify(tower)));
  assert.ok(latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((i) => i.id === "news-chop-orca-cds"));
  assert.ok(latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((i) => i.id === "news-tower-ai-tax"));
});

test("Chestnut Hill JHP contract is published, not featured, Chestnut Hill org only", () => {
  const item = catalog.find((i) => i.slug === "temple-chestnut-hill-jhp-2026-09-30");
  const entities = JSON.parse(readFileSync(join(root, "fixtures/entities.json"), "utf8")) as { id: string; name: string }[];
  assert.ok(item);
  assert.equal(item.kind, "news");
  assert.equal(item.status, "published");
  assert.equal(item.featured, false);
  assert.equal(item.publishedAt, "2026-08-17T16:00:00.000Z");
  assert.deepEqual(item.orgs, ["org-temple-chestnut-hill"]);
  assert.ok(!item.orgs.includes("org-jefferson"));
  assert.ok(!entities.some((e) => /jefferson health plans/i.test(`${e.id} ${e.name}`)));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.ok(item.body.includes("have not yet reached a new agreement."));
  assert.ok(item.body.includes("up to 60 days after Sept. 30, 2026."));
  assert.ok(item.body.includes("runs through Dec. 7, 2026."));
  assert.ok(!item.body.includes("not temple-dragon-copilot-400"));
  assert.ok(!item.body.includes("not Honor Roll"));
  assert.equal(item.body.trim().split(/\n\n/).length, 3);
  assert.equal(item.citations?.length, 1);
  assert.equal(
    item.source.url,
    "https://www.templehealth.org/about/newsroom/temple-health-chestnut-hill-hospital-and-jefferson-health-plans",
  );
  assert.equal(item.citations?.[0]?.url, item.source.url);
});

test("HAP CMS-0057-F letter is published, not featured, org-hap only", () => {
  const item = catalog.find((i) => i.slug === "hap-cms-0057-f-enforce-rfi");
  assert.ok(item);
  assert.equal(item.kind, "news");
  assert.equal(item.status, "published");
  assert.equal(item.featured, false);
  assert.equal(item.publishedAt, "2025-06-10T16:00:00.000Z");
  assert.deepEqual(item.orgs, ["org-hap"]);
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.ok(item.body.includes("not a local hospital PA-API go-live"));
  assert.ok(item.body.includes("26 Pennsylvania hospitals"));
  assert.ok(!item.body.includes("Delaware Valley PA-API"));
  assert.equal(item.citations?.length, 2);
  assert.equal(item.source.url, "https://www.haponline.org/Resource-Center?resourceid=1357");
  assert.equal(item.citations?.[0]?.url, item.source.url);
});

test("leadItem source does not call briefingSinceYesterday5pmET", () => {
  const src = readFileSync(join(root, "src/content/queries.ts"), "utf8");
  const leadFn = src.slice(src.indexOf("export function leadItem"), src.indexOf("export const featuredLead"));
  assert.ok(!leadFn.includes("briefingSinceYesterday5pmET"));
  assert.ok(!leadFn.includes("briefing[0]"));
  assert.ok(!src.includes("deskClocks"));
});

test("homepage binds store queries and kit class names", () => {
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  const briefing = readFileSync(join(root, "src/ui/BriefingPage.tsx"), "utf8");
  const eventsPage = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const lead = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const desk = readFileSync(join(root, "src/ui/home/Desk.tsx"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const footer = readFileSync(join(root, "src/ui/home/SiteFooter.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  assert.ok(home.includes("leadItem"));
  assert.ok(home.includes("briefingSinceYesterday5pmET"));
  assert.ok(home.includes("latestNews"));
  assert.ok(home.includes("latestVoices"));
  assert.ok(home.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("publishedNewsList"));
  assert.ok(eventsPage.includes("latestVoices"));
  assert.ok(!eventsPage.includes("newsFamily"));
  assert.ok(!rail.includes("topics[0]"));
  assert.ok(!home.includes("briefing[0]"));
  assert.ok(!home.includes("subscribe"));
  assert.ok(!home.includes("deskClocks"));
  assert.ok(!home.includes("homepage-10"));
  assert.ok(!home.toLowerCase().includes("himss seal"));
  assert.ok(home.includes("NEWS · LATEST"));
  assert.ok(home.includes("EVENTS · NEXT"));
  assert.ok(home.includes("VOICES · LATEST"));
  assert.ok(lead.includes("THE DESK"));
  assert.ok(lead.includes("item.publishedAt"));
  assert.ok(!lead.includes("chipInstant"));
  assert.ok(lead.includes("Lead-headline"));
  assert.ok(lead.includes("Impact:"));
  assert.ok(desk.includes("THE DESK"));
  assert.ok(desk.includes("DeskRow"));
  assert.ok(desk.includes("impactSentence"));
  assert.ok(desk.includes("DeskRow-impact"));
  assert.ok(desk.includes("QUEUED"));
  assert.ok(desk.includes('ann="ask"'));
  assert.ok(!desk.toLowerCase().includes("spill"));
  assert.ok(rail.includes("RegisterLink"));
  assert.ok(!rail.includes("queued"));
  {
    const registerAt = css.indexOf(".Register,");
    const registerCss = css.slice(registerAt, css.indexOf(".SiteFooter {", registerAt));
    assert.ok(registerCss.includes(".RailRow a.Register"));
    assert.ok(registerCss.includes("color: var(--event)"));
    assert.ok(!registerCss.includes("var(--ink)"));
    const dateChip = css.slice(css.indexOf(".DateChip"), css.indexOf(".StatusChip"));
    assert.ok(dateChip.includes("background: var(--event)"));
  }
  assert.ok(footer.includes("News"));
  assert.ok(footer.includes("Events"));
  assert.ok(footer.includes("Voices"));
  assert.ok(footer.includes("feed.json"));
  assert.ok(footer.includes("feed.xml"));
  assert.ok(footer.includes("© The Valley Desk"));
  assert.ok(!footer.toLowerCase().includes("subscribe"));
  assert.ok(!home.includes("SiteFooter"));
  assert.ok(layout.includes("SiteFooter"));
  assert.ok(!layout.includes("SiteChromeFooter"));
  assert.ok(!layout.includes("isHome"));
  assert.ok(layout.includes("MarkFold"));
  assert.ok(layout.includes("Wordmark"));
  assert.ok(layout.includes("NavLink"));
  assert.ok(layout.includes('to="/news"'));
  assert.ok(layout.includes('to="/events"'));
  assert.ok(layout.includes('to="/voices"'));
  assert.ok(layout.includes("is-news"));
  assert.ok(layout.includes("is-events"));
  assert.ok(layout.includes("is-voices"));
  assert.ok(css.includes(".NavLink.is-voices"));
  assert.ok(css.includes("border-bottom-color: var(--ink)"));
  assert.ok(router.includes('"/voices"'));
  assert.ok(!router.includes('"/briefing"'));
  assert.ok(!router.includes("BriefingPage"));
  assert.ok(!router.includes('"/policy"'));
  assert.ok(!router.includes('"/ai"'));
  assert.ok(!/path:\s*["']\/org\//.test(router));
  assert.ok(!router.includes('to="/org'));
  assert.ok(css.includes("width: 36px"));
  assert.ok(css.includes("height: 36px"));
  assert.ok(css.includes("font-size: 13px"));
  assert.ok(css.includes("font-weight: 600"));
  assert.ok(tokens.includes("#FFFFFF"));
  assert.ok(tokens.includes("#21145F"));
  assert.ok(tokens.includes("#1E22AA"));
  assert.ok(tokens.includes("#54C0E8"));
  assert.ok(tokens.includes("#CA8504"));
  assert.ok(tokens.includes("#101828"));
  assert.ok(tokens.includes("#475467"));
  assert.ok(tokens.includes("#E6E8EE"));
  assert.ok(briefing.includes("Ranked by org and topic overlap, not recency."));
  assert.ok(briefing.includes("Nothing published in this window yet."));
  assert.ok(briefing.includes("ItemCard"));
});

test("Register uses registrationUrl only; locked DVHIMSS URLs unchanged", () => {
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958");
  const golf = catalog.find((i) => i.id === "evt-dvhimss-23007");
  const networking = catalog.find((i) => i.id === "evt-01");
  const jefferson = catalog.find((i) => i.id === "evt-02");
  assert.equal(
    eventRegisterUrl(fall!),
    "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary",
  );
  assert.equal(
    eventRegisterUrl(golf!),
    "https://web.cvent.com/event/30573954-490f-49b3-8395-3757f872c442/summary",
  );
  assert.equal(golf?.slug, "njdvhimss-annual-golf-outing");
  assert.equal(golf?.body, "Kickoff to the fall conference.");
  assert.ok(!golf?.body.includes("Ingested from the DVHIMSS Events Calendar."));
  assert.equal(fall?.status, "published");
  assert.equal(golf && golf.kind === "event" ? golf.autoPublish : false, true);
  assert.equal(fall && fall.kind === "event" ? fall.autoPublish : false, true);
  const eventsAdapter = readFileSync(join(root, "src/ingest/events.ts"), "utf8");
  const social = readFileSync(join(root, "src/ingest/social.ts"), "utf8");
  const linkedin = readFileSync(join(root, "src/ingest/linkedin.ts"), "utf8");
  assert.ok(eventsAdapter.includes("autoPublish: true"));
  assert.ok(!social.includes("autoPublish"));
  assert.ok(!linkedin.includes("autoPublish"));
  assert.equal(eventRegisterUrl(networking!), "https://dvhimss.org/events/");
  assert.equal(eventRegisterUrl(jefferson!), undefined);
  assert.ok(jefferson && jefferson.kind === "event" && jefferson.source.url);
  const src = readFileSync(join(root, "src/lib/register.ts"), "utf8");
  assert.ok(!src.includes("source."));
});

test("nextChapterEvent prefers a conference in window over mixer/golf and pins the events rail", () => {
  const now = new Date("2026-08-22T20:00:00.000Z");
  const chapter = nextChapterEvent(catalog, now);
  assert.equal(chapter?.id, "evt-dvhimss-22958");
  assert.equal(chapter?.partner, "dvhimss");
  assert.equal(
    eventRegisterUrl(chapter!),
    "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary",
  );
  assert.ok(chapter?.registrationUrl);
  const mixerOnly = catalog.filter((i) => i.id === "evt-01");
  assert.equal(catalog.find((i) => i.id === "evt-01")?.status, "draft");
  assert.equal(nextChapterEvent(mixerOnly, now), undefined);
  const missingRegister = EventItem.parse({
    ...base,
    id: "evt-no-pin",
    slug: "evt-no-pin",
    title: "Chapter without register",
    kind: "event",
    status: "published",
    startsAt: "2026-09-02T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
  });
  assert.equal(nextChapterEvent([missingRegister], now), undefined);
  const pinned = pinnedUpcomingEvents(catalog, now, 6);
  assert.equal(pinned[0]?.id, chapter?.id);
  assert.equal(pinned.filter((i) => i.id === chapter?.id).length, 1);
  assert.ok(!pinned.some((i) => i.id === "evt-01"));
  assert.ok(!pinned.some((i) => i.id === "evt-02"));
  assert.ok(pinned.some((i) => i.id === "evt-dvhimss-22958"));
  assert.equal(eventRegisterUrl(catalog.find((i) => i.id === "evt-02")!), undefined);
  assert.equal(
    canPublish({ kind: "event", status: "published", partner: "health-system" }),
    true,
  );
  assert.equal(pinned.filter((i) => /conference/i.test(i.title)).length, 1);
  const phillies = EventItem.parse({
    ...base,
    id: "evt-phillies",
    slug: "njhimss-phillies-night",
    title: "NJHIMSS Phillies night",
    kind: "event",
    status: "published",
    startsAt: "2026-09-01T23:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "NJHIMSS",
    partner: "njhimss",
    orgs: ["org-njhimss"],
    registrationUrl: "https://dvhimss.org/events/",
  });
  assert.equal(nextChapterEvent([phillies, chapter!], now)?.id, chapter?.id);
  assert.equal(nextChapterEvent([phillies], now)?.id, "evt-phillies");
  const scrapeDup = EventItem.parse({
    ...base,
    id: "evt-njdvhimss-fall-2026",
    slug: "njdvhimss-fall-conference-2026",
    title: "NJ/DVHIMSS Fall Conference 2026",
    kind: "event",
    status: "published",
    startsAt: chapter!.kind === "event" ? chapter!.startsAt : "2026-10-13T20:30:00.000Z",
    timezone: "America/New_York",
    hostOrg: "NJDVHIMSS",
    partner: "njhimss",
    orgs: ["org-njhimss"],
    registrationUrl: "https://njdvhimssevent.com/",
    source: { kind: "ingest" as const, origin: "njdvhimssevent", url: "https://njdvhimssevent.com/" },
  });
  assert.equal(nextChapterEvent([scrapeDup, chapter!], now)?.id, chapter?.id);
  assert.equal(
    upcomingEvents([scrapeDup, chapter!], now, 10).filter((i) => /conference/i.test(i.title)).length,
    1,
  );
  assert.ok(pinned.every((i) => i.kind === "event" && i.status === "published"));
  assert.ok(pinned.every((i) => i.startsAt >= now.toISOString()));
  const ingest = readFileSync(join(root, "src/ingest/events.ts"), "utf8");
  const scrapeFn = ingest.slice(ingest.indexOf("export async function scrapeNjdvhimss"));
  assert.ok(scrapeFn.includes("autoPublish: false"));
  assert.ok(!scrapeFn.includes("autoPublish: true"));
  const register = readFileSync(join(root, "src/lib/register.ts"), "utf8");
  assert.ok(!register.includes("source.url"));
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  assert.ok(!home.toLowerCase().includes("badge"));
  assert.ok(!home.toLowerCase().includes("brochure"));
  assert.ok(!home.toLowerCase().includes("directory"));
  assert.ok(!rail.toLowerCase().includes("badge"));
});

test("event JSON-LD is published EventItem only; offers.url is registrationUrl", () => {
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958")!;
  const jefferson = catalog.find((i) => i.id === "evt-02")!;
  const news = catalog.find((i) => i.id === "news-penn-ai-scribe")!;
  const ld = eventJsonLd(fall, entityRows);
  assert.equal(ld?.["@type"], "Event");
  assert.equal(ld?.name, fall.title);
  assert.equal(ld?.startDate, fall.kind === "event" ? fall.startsAt : undefined);
  assert.equal(ld?.endDate, fall.kind === "event" ? fall.endsAt : undefined);
  assert.equal(ld?.eventTimezone, "America/New_York");
  assert.deepEqual(
    (ld?.offers as { url?: string; price?: string } | undefined)?.url,
    "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary",
  );
  assert.equal((ld?.offers as { price?: string } | undefined)?.price, undefined);
  assert.equal((ld?.organizer as { name?: string; identifier?: string }).name, "DVHIMSS");
  assert.equal((ld?.organizer as { identifier?: string }).identifier, "org-dvhimss");
  assert.equal(ld?.url, "https://thevalleydesk.org/events/njdvhimss-fall-conference-october-13th-15th");
  assert.equal(ld?.mainEntityOfPage, ld?.url);
  assert.equal((ld?.location as { name?: string }).name, "Hard Rock Hotel & Casino, Atlantic City, NJ");
  assert.ok(!String((ld?.location as { name?: string }).name).includes("Atlantic City, Atlantic City"));
  assert.equal((ld?.about as { identifier?: string }[])[0]?.identifier, "org-dvhimss");
  assert.ok(!Object.prototype.hasOwnProperty.call(ld, "image"));
  assert.deepEqual(Object.keys((ld?.offers as object) ?? {}).sort(), ["@type", "url"]);
  const splitHost = EventItem.parse({
    ...base,
    id: "evt-split-host",
    slug: "evt-split-host",
    title: "Host is not orgs",
    kind: "event",
    status: "published",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-jefferson"],
    registrationUrl: "https://dvhimss.org/events/",
  });
  const splitLd = eventJsonLd(splitHost, entityRows);
  assert.equal((splitLd?.organizer as { name?: string }).name, "DVHIMSS");
  assert.equal((splitLd?.organizer as { identifier?: string }).identifier, "org-dvhimss");
  assert.equal((splitLd?.about as { identifier?: string }[])[0]?.identifier, "org-jefferson");
  assert.equal(jefferson.status, "draft");
  assert.equal(eventJsonLd(jefferson, entityRows), undefined);
  const publishedJefferson = EventItem.parse({ ...jefferson, status: "published" });
  const noOffer = eventJsonLd(publishedJefferson, entityRows);
  assert.equal(noOffer?.["@type"], "Event");
  assert.equal(noOffer?.offers, undefined);
  assert.equal(noOffer?.endDate, undefined);
  assert.equal(eventJsonLd(news), undefined);
  const review = EventItem.parse({
    ...base,
    id: "evt-review-ld",
    slug: "evt-review-ld",
    title: "Review event",
    kind: "event",
    status: "review",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
    registrationUrl: "https://dvhimss.org/events/",
  });
  assert.equal(eventJsonLd(review), undefined);
});

test("feed.json projection keeps registrationUrl on published events", () => {
  const feed = toFeed(catalog, "2026-08-22T20:14:00.000Z");
  const fall = feed.items.find((i) => i.id === "evt-dvhimss-22958");
  assert.equal(fall?.kind, "event");
  assert.equal(
    fall && fall.kind === "event" ? fall.registrationUrl : undefined,
    "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary",
  );
  assert.ok(feed.items.every((i) => i.status === "published"));
  assert.ok(!feed.items.some((i) => i.status === "review"));
});

test("ItemPage is an aggregator card: chip, title, impact, body, citations — not a magazine template", () => {
  const page = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(page.includes("GroupChip"));
  assert.ok(!page.includes("StatusChip"));
  assert.ok(page.includes("kindChip"));
  assert.ok(page.includes("item.impactSentence"));
  assert.ok(page.includes("itemCitations"));
  assert.ok(page.includes("item.body"));
  assert.ok(page.includes("ItemJsonLd"));
  assert.ok(page.includes("RegisterLink"));
  assert.ok(page.includes("registrationUrl"));
  assert.ok(page.includes("startsAt"));
  assert.ok(page.includes("publishedAt"));
  assert.ok(page.includes("itemByline"));
  assert.ok(page.includes("Sources"));
  assert.ok(page.includes("Lead-headline"));
  assert.ok(page.includes("ItemFacts"));
  assert.ok(page.includes("ItemPage-dek"));
  assert.ok(page.includes("ItemFactScope"));
  assert.ok(!page.includes("text-3xl"));
  assert.ok(!page.includes("item.dek"));
  assert.ok(!page.includes("QUEUED"));
  assert.ok(!page.includes("KIND_LABEL"));
  assert.ok(!page.includes("/voices"));
  assert.ok(!page.includes("/org"));
  assert.ok(!page.includes("sourceLine"));
  assert.ok(!page.includes("item.source.url"));
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe")!;
  const cites = itemCitations(penn);
  assert.ok(cites.some((c) => c.url === penn.source.url));
  assert.equal(cites.filter((c) => c.url === penn.source.url).length, 1);
  const extra = itemCitations({
    source: { origin: "newsroom", url: "https://example.com/source" },
    citations: [{ name: "Other", url: "https://example.com/other" }],
  });
  assert.deepEqual(extra, [
    { name: "Other", url: "https://example.com/other" },
    { name: "newsroom", url: "https://example.com/source" },
  ]);
  const jefferson = catalog.find((i) => i.id === "evt-02")!;
  assert.equal(jefferson.kind, "event");
  assert.equal(eventRegisterUrl(jefferson), undefined);
  assert.ok(jefferson.source.url);
  assert.ok(itemCitations(jefferson).some((c) => c.url === jefferson.source.url));
});

test("canonical helper: news family under /news, events under /events, voices under /voices", () => {
  assert.equal(canonicalPath({ kind: "news", slug: "penn-in-house-ai-scribe" }), "/news/penn-in-house-ai-scribe");
  assert.equal(canonicalPath({ kind: "policy", slug: "pa-doh-telehealth-guidance-2026" }), "/news/pa-doh-telehealth-guidance-2026");
  assert.equal(canonicalPath({ kind: "ai", slug: "epic-ambient-listening-note" }), "/news/epic-ambient-listening-note");
  assert.equal(canonicalPath({ kind: "interview", slug: "x" }), "/news/x");
  assert.equal(canonicalPath({ kind: "voice", slug: "mlh-cloud-analytics-2026-08-17" }), "/voices/mlh-cloud-analytics-2026-08-17");
  assert.equal(canonicalPath({ kind: "voice", slug: "temple-honor-roll-2026" }), "/voices/temple-honor-roll-2026");
  assert.equal(canonicalUrl({ kind: "event", slug: "dvhimss-september-networking" }), "https://thevalleydesk.org/events/dvhimss-september-networking");
});

test("NewsArticle JSON-LD uses envelope fields and canonical url", () => {
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe")!;
  const ld = itemJsonLd(penn, entityRows);
  assert.equal(ld?.["@type"], "NewsArticle");
  assert.equal(ld?.headline, penn.title);
  assert.equal(ld?.description, penn.impactSentence);
  assert.notEqual(ld?.description, penn.dek);
  assert.equal(ld?.url, "https://thevalleydesk.org/news/penn-in-house-ai-scribe");
  assert.equal(ld?.mainEntityOfPage, ld?.url);
  assert.equal(ld?.isBasedOn, penn.source.url);
  assert.equal(ld?.isAccessibleForFree, true);
  assert.equal((ld?.publisher as { name?: string }).name, "The Valley Desk");
  assert.equal((ld?.about as { identifier?: string; name?: string }[])[0]?.identifier, "org-penn");
  assert.equal((ld?.about as { name?: string }[])[0]?.name, "Penn Medicine");
  assert.ok(!JSON.stringify(ld).includes("sourceName"));
  assert.ok(!JSON.stringify(ld).includes("freshnessClass"));
  assert.ok(!JSON.stringify(ld).includes("FAQPage"));
  assert.ok(!JSON.stringify(ld).includes("HowTo"));
  assert.ok(!JSON.stringify(ld).includes("BreadcrumbList"));
});

test("dvhimss/njhimss cannot publish without registrationUrl", () => {
  const raw = {
    ...base,
    id: "evt-no-reg",
    slug: "evt-no-reg",
    title: "No register",
    kind: "event",
    status: "published",
    startsAt: "2026-09-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    partner: "dvhimss",
    orgs: ["org-dvhimss"],
  };
  assert.equal(canPublish({ kind: "event", status: "published", partner: "dvhimss" }), false);
  assert.equal(canPublish({ kind: "event", status: "published", partner: "njhimss" }), false);
  assert.equal(
    canPublish({ kind: "event", status: "published", partner: "health-system" }),
    true,
  );
  assert.throws(() => ContentItem.parse(raw));
  assert.throws(() => ContentItem.parse({ ...raw, partner: "njhimss" }));
});

test("date chips use SEP 26 / OCT 13–15; lead date is 26 SEPTEMBER 2026", () => {
  const einstein = catalog.find((i) => i.id === "news-jefferson-einstein-mychart")!;
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958")!;
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic")!;
  assert.equal(formatChipLabel(einstein), "SEP 26");
  assert.equal(formatChipLabel(fall), "OCT 13–15");
  assert.equal(formatLeadDate("2026-09-26T04:00:00.000Z"), "26 SEPTEMBER 2026");
  assert.equal(formatLeadDate(christiana.publishedAt), "1 JULY 2026");
  assert.notEqual(formatLeadDate(christiana.publishedAt), "3 OCTOBER 2026");
});

test("RSS link/guid are canonical; sitemap lists home news events feeds and permalinks", () => {
  const rss = readFileSync(join(root, "public/feed.xml"), "utf8");
  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  const build = readFileSync(join(root, "scripts/build-feed.mjs"), "utf8");
  const feed = JSON.parse(readFileSync(join(root, "public/feed.json"), "utf8")) as {
    items: { id: string; source?: { url?: string } }[];
  };
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  const entitySrc = readFileSync(join(root, "src/content/entity.ts"), "utf8");
  assert.equal(entityRows.length, 92);
  assert.ok(!/path:\s*["']\/org\//.test(router));
  assert.ok(!router.includes("/orgs"));
  assert.ok(!router.includes("EntityPage"));
  assert.ok(entitySrc.includes("does not mint org-id routes"));
  assert.ok(rss.includes("<link>https://thevalleydesk.org/news/penn-in-house-ai-scribe</link>"));
  assert.ok(rss.includes("<guid isPermaLink=\"true\">https://thevalleydesk.org/news/penn-in-house-ai-scribe</guid>"));
  assert.ok(rss.includes("<link>https://thevalleydesk.org/events/njdvhimss-fall-conference-october-13th-15th</link>"));
  assert.ok(rss.includes("<description>Some 1,200 is an Inquirer headcount for Penn’s later in-house tool; 20.4% less time in notes is a 46-clinician journal table from a 2024 DAX Copilot pilot, not that headcount.</description>"));
  assert.ok(!rss.includes("<description>The Philadelphia Inquirer, Nov. 10, 2025: internist Dina Capalongo hits a green button; the doctor still approves the note.</description>"));
  assert.ok(!rss.includes("Partner event, review-queued in the stub path; published here so the rail has two dates."));
  assert.ok(!rss.includes("Chapter event. Gold rail on the homepage."));
  assert.ok(build.includes("canonicalUrl(item)"));
  assert.ok(!build.includes("citations?.[0]"));
  const feedIds = new Set(feed.items.map((row) => row.id));
  for (const item of catalog.filter((row) => row.status === "published")) {
    for (const citation of item.citations ?? []) {
      assert.ok(!rss.includes(`<link>${citation.url}</link>`));
      assert.ok(!rss.includes(`<guid isPermaLink="true">${citation.url}</guid>`));
    }
    if (!feedIds.has(item.id)) continue;
    const canon = canonicalUrl(item);
    assert.ok(rss.includes(`<link>${canon}</link>`), item.id);
    assert.ok(rss.includes(`<guid isPermaLink="true">${canon}</guid>`), item.id);
    const jsonItem = feed.items.find((row) => row.id === item.id);
    if (item.source.url) {
      assert.equal(jsonItem?.source?.url, item.source.url);
      assert.ok(!rss.includes(`<link>${item.source.url}</link>`));
      assert.ok(!rss.includes(`<guid isPermaLink="true">${item.source.url}</guid>`));
    }
  }
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/news</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/events</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/voices</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/voices/mlh-cloud-analytics-2026-08-17</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/voices/temple-honor-roll-2026</loc>"));
  assert.ok(!sitemap.includes("<loc>https://thevalleydesk.org/news/temple-honor-roll-2026</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/feed.json</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/feed.xml</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/news/penn-in-house-ai-scribe</loc>"));
  assert.ok(!sitemap.includes("/orgs/"));
  assert.ok(!sitemap.includes("/org/"));
  assert.ok(!sitemap.includes("https://thevalleydesk.org/policy"));
  assert.ok(!sitemap.includes("https://thevalleydesk.org/ai"));
  assert.ok(!feed.items.some((row) => row.id === "brief-01"));
  assert.ok(!feed.items.some((row) => row.id === "ai-01"));
  assert.ok(!rss.includes("week-of-2026-08-18"));
  assert.ok(build.includes("new Date().toISOString()"));
  assert.ok(build.includes("hasCite"));
});

test("SEO hold: robots.txt is text, worker 404s unknown and /org/*, no org routes", () => {
  const robots = readFileSync(join(root, "public/robots.txt"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const publishedRoutes = readFileSync(join(root, "worker-published.js"), "utf8");
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  assert.ok(robots.includes("User-agent: *"));
  assert.ok(robots.includes("Allow: /"));
  assert.ok(!robots.includes("<"));
  assert.ok(worker.includes("status: 404"));
  assert.ok(worker.includes("text/plain"));
  assert.ok(worker.includes('path.startsWith("/org/")'));
  assert.ok(worker.includes("publishedItemPath"));
  assert.ok(worker.includes("withHead"));
  assert.ok(worker.includes("og:title"));
  assert.ok(worker.includes("twitter:card"));
  assert.ok(worker.includes("canonical"));
  assert.ok(worker.includes("application/rss+xml"));
  assert.ok(worker.includes('const ORIGIN = "https://thevalleydesk.org"'));
  assert.ok(worker.includes("/feed.xml"));
  assert.ok(!worker.includes("EntityPage"));
  assert.ok(publishedRoutes.includes("christianacare-epic-go-live"));
  assert.ok(!publishedRoutes.includes("mlh-olenoski-cio"));
  assert.ok(!publishedRoutes.includes("virtua-gordon-cio"));
  assert.ok(publishedRoutes.includes("njdvhimss-fall-conference-october-13th-15th"));
  assert.ok(publishedRoutes.includes("publishedHead"));
  assert.ok(publishedRoutes.includes("publishedVoiceSlugs"));
  assert.ok(publishedRoutes.includes("publishedBriefingSlugs"));
  assert.ok(publishedRoutes.includes("mlh-cloud-analytics-2026-08-17"));
  assert.ok(publishedRoutes.includes("temple-honor-roll-2026"));
  assert.ok(!publishedRoutes.includes("penn-medicine-ai-scribe-rollout"));
  assert.ok(!publishedRoutes.includes("epic-ambient-listening-note"));
  assert.ok(!publishedRoutes.includes("week-of-2026-08-18"));
  assert.ok(!publishedRoutes.includes("dvhimss-september-networking"));
  assert.ok(!publishedRoutes.includes("cio-note-workforce-ai"));
  assert.ok(worker.includes("publishedVoiceSlugs"));
  assert.ok(worker.includes('path.startsWith("/briefing/")'));
  assert.ok(worker.includes("news|events|voices"));
  assert.ok(!worker.includes("voices|briefing"));
  assert.ok(wrangler.includes('"not_found_handling": "none"'));
  assert.ok(!wrangler.includes("single-page-application"));
  assert.ok(!wrangler.includes("routes"));
  assert.ok(!/path:\s*["']\/org\//.test(router));
});

test("signed stills kit numbers and Mira addendum locks", () => {
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const favicon = readFileSync(join(root, "public/favicon.svg"), "utf8");
  const status = readFileSync(join(root, "src/ui/home/StatusChip.tsx"), "utf8");
  const eventsPage = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const card = readFileSync(join(root, "src/ui/ItemCard.tsx"), "utf8");
  const networking = catalog.find((i) => i.id === "evt-01");
  const jefferson = catalog.find((i) => i.id === "evt-02");
  const briefing = catalog.find((i) => i.id === "brief-01");
  const ai = catalog.find((i) => i.id === "ai-01");
  assert.ok(favicon.includes("#FFFFFF"));
  assert.ok(!favicon.includes("#F7F4EC"));
  assert.ok(css.includes("font-size: 9px"));
  assert.ok(css.includes("letter-spacing: 0.3em"));
  assert.ok(css.includes("font-size: 18px"));
  assert.ok(css.includes("gap: 28px"));
  assert.ok(css.includes("border-bottom: 3px solid transparent"));
  assert.ok(css.includes("grid-template-columns: 1fr 300px"));
  assert.ok(css.includes("letter-spacing: 0.16em"));
  assert.ok(css.includes("padding-top: 20px"));
  assert.ok(css.includes("padding: 28px 56px 40px"));
  assert.ok(css.includes("max-width: 1440px"));
  assert.ok(!css.includes("max-width: 1000px"));
  assert.ok(status.includes("data-queued"));
  assert.ok(!status.includes("kind"));
  assert.ok(!status.includes("ann"));
  assert.equal(networking?.dek, "");
  assert.equal(jefferson?.dek, "");
  assert.equal(briefing?.status, "draft");
  assert.equal(ai?.status, "draft");
  assert.deepEqual(ai?.orgs, []);
  assert.ok(card.includes("listDek"));
  assert.ok(card.includes("impactSentence"));
  assert.ok(!card.includes("item.dek"));
  assert.ok(!card.includes("item.orgs"));
  assert.ok(!card.includes("listSourceLine"));
  assert.ok(eventsPage.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("Rail"));
  assert.ok(!eventsPage.includes("ItemCard"));
});

test("list pages omit costume deks and costume source crumbs", () => {
  const policy = catalog.find((i) => i.id === "policy-01")!;
  const networking = catalog.find((i) => i.id === "evt-01")!;
  const jefferson = catalog.find((i) => i.id === "evt-02")!;
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe")!;
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic")!;
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958")!;
  assert.equal(networking.dek, "");
  assert.equal(jefferson.dek, "");
  assert.equal(listDek(networking), "");
  assert.equal(listDek(jefferson), "");
  assert.notEqual(policy.status, "published");
  assert.equal(listDek(penn), penn.dek);
  assert.equal(listDek(christiana), christiana.dek);
  assert.equal(listDek(fall), fall.dek);
  assert.equal(listSourceLine(penn), "");
  assert.equal(listSourceLine(policy), "");
  assert.equal(listSourceLine(networking), "");
  const newsRows = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  const eventRows = pinnedUpcomingEvents(catalog, new Date("2026-08-22T20:00:00.000Z"), 50);
  const voiceRows = latestVoices(catalog);
  assert.ok(newsRows.every((i) => i.kind !== "voice"));
  assert.ok(!newsRows.some((i) => /honor.?roll/i.test(`${i.title} ${i.dek} ${i.body}`)));
  const rendered = [...newsRows, ...eventRows, ...voiceRows]
    .flatMap((item) => [item.title, item.impactSentence, listDek(item), listSourceLine(item)])
    .join("\n");
  assert.ok(!/review-queued/i.test(rendered));
  assert.ok(!/stub path/i.test(rendered));
  assert.ok(!/dvhimss-events-stub/i.test(rendered));
  assert.ok(!/Gold rail on the homepage/i.test(rendered));
  assert.ok(!/so the rail has two dates/i.test(rendered));
  assert.ok(!/Jane Doe/i.test(rendered));
  assert.ok(!/Fixture published/i.test(rendered));
  assert.ok(!/org-penn/.test(rendered));
});

test("Sloan Einstein MyChart 2026-09-26 is published, not featured; old go-live slug stays draft", () => {
  const item = catalog.find((i) => i.slug === "jefferson-einstein-mychart-2026-09-26");
  const draft = catalog.find((i) => i.slug === "jefferson-einstein-mychart-go-live");
  assert.ok(item && draft);
  assert.equal(item.id, "news-jefferson-einstein-mychart-2026-09-26");
  assert.equal(item.kind, "news");
  assert.equal(item.status, "published");
  assert.equal(item.featured, false);
  assert.equal(item.publishedAt, "2026-08-23T16:00:00.000Z");
  assert.ok(item.publishedAt?.startsWith("2026-08-23"));
  assert.ok(!item.publishedAt?.startsWith("2026-09-26"));
  assert.equal(item.kind === "news" ? item.clockAt : undefined, "2026-09-26T04:00:00.000Z");
  assert.ok((item.kind === "news" ? item.clockAt : "").startsWith("2026-09-26"));
  assert.equal(
    item.dek,
    "Official Jefferson page: MyEinsteinHealth migrates to MyJeffersonHealth, the Epic MyChart portal, for Jefferson Einstein Philadelphia and Jefferson Einstein Montgomery.",
  );
  assert.deepEqual(item.orgs, [
    "org-jefferson",
    "org-jefferson-einstein-phila",
    "org-jefferson-einstein-montgomery",
  ]);
  assert.deepEqual(item.authors, [{ name: "Jefferson Health" }]);
  assert.equal(newsByline(item), "Jefferson Health");
  assert.ok(!newsByline(item).includes("Valley Desk"));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
  assert.equal(draft.status, "draft");
  assert.equal(draft.id, "news-jefferson-einstein-mychart");
  assert.ok(item.body.includes("MyEinsteinHealth"));
  assert.ok(item.body.includes("MyJeffersonHealth"));
  assert.ok(!item.body.includes("LVHN"));
  assert.ok(!/32|33/.test(item.body));
  assert.ok(!/CIO/i.test(`${item.title} ${item.body} ${item.impactSentence}`));
  assert.equal(item.source.url, "https://www.jeffersonhealth.org/your-health/my-jefferson-health/einstein-patient-portal");
  assert.equal(item.citations?.[0]?.name, "Jefferson Health Einstein patient portal");
  assert.equal(item.citations?.[0]?.url, item.source.url);
});

test("Sloan Delaware 340B HS 1 for HB 383 is published, not featured, empty orgs", () => {
  const item = catalog.find((i) => i.slug === "de-340b-hs1-hb383-2024");
  const einstein = catalog.find((i) => i.slug === "jefferson-einstein-mychart-2026-09-26");
  assert.ok(item && einstein);
  assert.equal(item.kind, "news");
  assert.equal(item.status, "published");
  assert.equal(item.featured, false);
  assert.ok(item.publishedAt?.startsWith("2024-09-19"));
  assert.equal(item.kind === "news" ? item.clockAt : undefined, undefined);
  assert.deepEqual(item.orgs, []);
  assert.equal(item.region, "DE");
  assert.ok(item.topics.includes("policy"));
  assert.ok(!item.topics.includes("340B"));
  assert.deepEqual(item.authors, [{ name: "Delaware" }]);
  assert.equal(newsByline(item), "Delaware");
  assert.ok(!newsByline(item).includes("Valley Desk"));
  assert.equal(kindChip(item), "POLICY");
  assert.equal(item.citations?.length, 2);
  assert.equal(item.citations?.[0]?.name, "Delaware General Assembly Bill Detail, HS 1 for HB 383");
  assert.equal(item.citations?.[0]?.url, "https://legis.delaware.gov/BillDetail/141525");
  assert.equal(item.citations?.[1]?.name, "HS 1 for HB 383 engrossment, 18 Del. C. 3374A");
  assert.equal(
    item.citations?.[1]?.url,
    "https://legis.delaware.gov/json/BillDetail/GenerateHtmlDocumentEngrossment?docTypeId=6&engrossmentId=36721",
  );
  assert.equal(item.source.url, item.citations?.[0]?.url);
  assert.ok(item.body.includes("18 Del. C. § 3374A"));
  assert.ok(item.body.includes("§ 3374A(b)"));
  assert.ok(!isPublicNewsFamily(item, seedIds));
  assert.ok(!latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((i) => i.slug === "de-340b-hs1-hb383-2024"));
  assert.ok(publishedNewsList(catalog).some((i) => i.slug === "de-340b-hs1-hb383-2024"));
  assert.ok(bySlug(catalog, "de-340b-hs1-hb383-2024"));
  assert.equal(einstein.status, "published");
  assert.equal(einstein.featured, false);
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
});

test("Reed hold: published news slugs; stub origins and mixer are unpublished", () => {
  const publishedNews = catalog.filter((i) => i.kind === "news" && i.status === "published");
  assert.deepEqual(publishedNews.map((i) => i.slug).sort(), [
    "chop-orca-cds",
    "christianacare-epic-go-live",
    "de-340b-hs1-hb383-2024",
    "hap-cms-0057-f-enforce-rfi",
    "jefferson-einstein-mychart-2026-09-26",
    "jefferson-fy2026-operating-loss",
    "penn-in-house-ai-scribe",
    "temple-chestnut-hill-jhp-2026-09-30",
    "temple-dragon-copilot-400",
    "tower-ai-tax",
  ]);
  assert.equal(publishedNews.filter((i) => i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
  for (const id of [
    "news-01",
    "news-02",
    "news-jefferson-einstein-mychart",
    "evt-01",
    "evt-02",
    "voice-01",
    "policy-01",
    "ai-01",
    "brief-01",
  ]) {
    assert.notEqual(catalog.find((i) => i.id === id)?.status, "published", id);
  }
  const mixer = catalog.find((i) => i.id === "evt-01")!;
  assert.equal(mixer.status, "draft");
  assert.ok(mixer.body.includes("Fixture published event"));
  assert.equal(eventRegisterUrl(mixer), "https://dvhimss.org/events/");
  const pin = nextChapterEvent(catalog, new Date("2026-08-22T20:00:00.000Z"));
  assert.equal(pin?.slug, "njdvhimss-fall-conference-october-13th-15th");
  assert.equal(
    eventRegisterUrl(pin!),
    "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary",
  );
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(worker.includes('path.startsWith("/org/")'));
  const store = readFileSync(join(root, "src/content/store.ts"), "utf8");
  const runtime = readFileSync(join(root, "src/content/published-catalog.json"), "utf8");
  const format = readFileSync(join(root, "src/lib/format.ts"), "utf8");
  const register = readFileSync(join(root, "src/ui/RegisterLink.tsx"), "utf8");
  const head = readFileSync(join(root, "src/ui/DocumentHead.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  const card = readFileSync(join(root, "src/ui/ItemCard.tsx"), "utf8");
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958")!;
  assert.ok(store.includes("published-catalog.json"));
  assert.ok(!store.includes("fixtures/catalog.json"));
  assert.ok(!runtime.includes("Fixture."));
  assert.ok(!runtime.includes("Jane Doe"));
  assert.ok(!runtime.includes("review-queued"));
  assert.ok(!runtime.includes("gold-rail"));
  assert.ok(!runtime.includes("gold rail"));
  assert.ok(!runtime.includes("guest TBD"));
  assert.ok(!runtime.includes("penn-medicine-ai-scribe-rollout"));
  assert.ok(runtime.includes("mlh-cloud-analytics-2026-08-17"));
  assert.ok(runtime.includes("temple-honor-roll-2026"));
  assert.ok(!runtime.includes("cio-note-workforce-ai"));
  assert.ok(!format.includes("review-queued"));
  assert.ok(!format.includes("gold-rail"));
  assert.ok(!format.includes("dvhimss-events-stub"));
  assert.ok(register.includes('target="_blank"'));
  assert.ok(register.includes("noopener noreferrer"));
  assert.ok(layout.includes("DocumentHead"));
  assert.ok(head.includes("og:title"));
  assert.ok(head.includes("twitter:card"));
  assert.ok(head.includes("canonical"));
  assert.ok(head.includes("alternate"));
  assert.ok(head.includes("application/rss+xml"));
  assert.ok(card.includes("eventPlace"));
  assert.equal(eventPlace(fall as Extract<typeof fall, { kind: "event" }>), "Hard Rock Hotel & Casino, Atlantic City, NJ");
  assert.ok(!eventPlace(fall as Extract<typeof fall, { kind: "event" }>).includes("Atlantic City, Atlantic City"));
});

test("Voices v1: published kind=voice only, Honor Roll is not news, Jane Doe stays draft", () => {
  const jane = catalog.find((i) => i.slug === "cio-note-workforce-ai");
  const mlh = catalog.find((i) => i.slug === "mlh-cloud-analytics-2026-08-17");
  const honor = catalog.find((i) => i.slug === "temple-honor-roll-2026");
  assert.ok(jane && mlh && honor);
  assert.equal(jane.status, "draft");
  assert.equal(jane.kind, "voice");
  assert.equal(jane.person, "Jane Doe");
  assert.equal(mlh.kind, "voice");
  assert.equal(mlh.status, "published");
  assert.equal(mlh.featured, false);
  assert.equal(mlh.person, "Main Line Health (official account)");
  assert.deepEqual(mlh.orgs, ["org-main-line"]);
  assert.equal(mlh.publishedAt, "2026-08-17T16:00:00.000Z");
  assert.equal(
    mlh.source.url,
    "https://www.linkedin.com/posts/main-line-health_advancing-data-driven-decision-making-through-activity-7495166755649216513-0uVh",
  );
  assert.equal(mlh.citations?.length, 1);
  assert.equal(mlh.citations?.[0]?.name, "Main Line Health official LinkedIn");
  assert.equal(mlh.citations?.[0]?.url, mlh.source.url);
  assert.equal(mlh.body, mlh.dek);
  assert.equal(honor.kind, "voice");
  assert.equal(honor.status, "published");
  assert.equal(honor.featured, false);
  assert.equal(honor.person, "Benjamin Slovis");
  assert.deepEqual(honor.orgs, ["org-temple"]);
  assert.equal(honor.publishedAt, "2026-08-08T16:00:00.000Z");
  assert.equal(
    honor.source.url,
    "https://www.linkedin.com/posts/benjaminslovis_templehealth-epichonorroll-clinicalinformatics-activity-7491951990122631168-XCu_",
  );
  assert.deepEqual(
    honor.citations?.map((c) => c.name),
    ["Slovis Aug. 8 LI", "Temple Health official Aug. 7 LI", "Temple newsroom July 16"],
  );
  assert.equal(honor.citations?.length, 3);
  assert.ok(!honor.citations?.some((c) => /credly/i.test(`${c.name} ${c.url}`)));
  assert.equal(honor.body, honor.dek);
  const voices = latestVoices(catalog);
  assert.deepEqual(voices.map((i) => i.slug), [
    "mlh-cloud-analytics-2026-08-17",
    "temple-honor-roll-2026",
  ]);
  assert.ok(voices.every((i) => i.kind === "voice" && i.status === "published"));
  assert.ok(!voices.some((i) => i.slug === "cio-note-workforce-ai"));
  const news = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  assert.ok(!news.some((i) => i.slug === "temple-honor-roll-2026"));
  assert.ok(!news.some((i) => i.slug === "mlh-cloud-analytics-2026-08-17"));
  assert.ok(!news.some((i) => /honor.?roll/i.test(i.title)));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
  assert.equal(canonicalPath(mlh), "/voices/mlh-cloud-analytics-2026-08-17");
  assert.equal(canonicalPath(honor), "/voices/temple-honor-roll-2026");
  assert.notEqual(canonicalPath(honor), "/news/temple-honor-roll-2026");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(itemPage.includes('section: "news" | "event" | "voice"'));
  assert.ok(worker.includes("publishedVoiceSlugs"));
  assert.ok(worker.includes('path.startsWith("/briefing/")'));
});

test("firehose: stable RSS ids, seed org map, HOLD denylist, social no-op, queue not in catalog", async () => {
  const raw = rssItemToContent(
    {
      title: "Jefferson Health posts a year-end operating loss",
      link: "https://www.inquirer.com/health/jefferson-loss",
      description: "Bondholders saw the Inquirer clip.",
      pubDate: "Fri, 14 Aug 2026 12:00:00 GMT",
      guid: "https://www.inquirer.com/health/jefferson-loss",
    },
    "Inquirer Health",
    "2026-08-23T20:00:00.000Z",
    0,
  );
  const again = rssItemToContent(
    {
      title: "Jefferson Health posts a year-end operating loss",
      link: "https://www.inquirer.com/health/jefferson-loss",
      description: "Bondholders saw the Inquirer clip.",
      pubDate: "Fri, 14 Aug 2026 12:00:00 GMT",
      guid: "https://www.inquirer.com/health/jefferson-loss",
    },
    "Inquirer Health",
    "2026-08-23T20:00:00.000Z",
    99,
  );
  assert.equal(raw.id, again.id);
  assert.ok(!/rss-inquirer-health-\d+-/.test(raw.id));
  assert.ok(raw.orgs.includes("org-jefferson"));
  assert.equal(raw.kind, "news");
  assert.equal(raw.source.kind, "ingest");
  assert.equal(raw.status, "review");
  assert.equal(raw.featured, false);
  const national = rssItemToContent(
    {
      title: "A national CMS note",
      link: "https://example.com/cms",
      description: "No Valley system is named.",
      pubDate: "Fri, 14 Aug 2026 12:00:00 GMT",
      guid: "https://example.com/cms",
    },
    "Inquirer Health",
    "2026-08-23T20:00:00.000Z",
    1,
  );
  assert.deepEqual(national.orgs, []);
  assert.ok(
    !isPublicNewsFamily({
      ...national,
      status: "published",
      impactSentence: "National CMS note with no Valley system.",
    }),
  );
  const [queued] = toReviewQueue({
    adapter: "linkedin",
    fetchedAt: "2026-08-23T20:00:00.000Z",
    items: [
      {
        ...raw,
        id: "voice-li-1",
        slug: "li-1",
        kind: "voice",
        person: "Main Line Health (official account)",
        platform: "linkedin",
        originalUrl: "https://www.linkedin.com/company/main-line-health",
      },
    ],
  });
  assert.equal(queued.status, "review");
  assert.equal(queued.featured, false);
  assert.ok(isHeldHandle("x", "CooperHealth"));
  assert.ok(isHeldHandle("x", "TowerHealth"));
  assert.ok(isHeldHandle("x", "wearejefferson"));
  assert.ok(isHeldHandle("x", "DVHIMSS"));
  assert.ok(isHeldHandle("linkedin", "salmasian"));
  assert.ok(isHeldHandle("linkedin", "schnall"));
  assert.ok(isHeldHandle("linkedin", "pennington"));
  assert.ok(!isLiveSocialKey("voice-01"));
  assert.ok(!isLiveSocialKey("cio-note-workforce-ai"));
  assert.equal(liveXOrigins().length, 0);
  assert.ok(liveLinkedInOrigins().every((o) => !/jane|voice-01|schnall|salmasian|pennington/i.test(o.slug)));
  assert.ok(firstWaveOrigins.hold.notes.join(" ").includes("personal X"));
  const li = await ingestLinkedIn({});
  assert.equal(li.skipped, "no-token");
  assert.deepEqual(li.items, []);
  const x = await ingestX({});
  assert.equal(x.skipped, "no-token");
  assert.deepEqual(x.items, []);
  const kept = mergeReviewQueue(
    [{ id: "evt-dvhimss-23007", status: "published", title: "Golf" } as (typeof catalog)[number]],
    [{ id: "evt-dvhimss-23007", status: "review", title: "Clobber" } as (typeof catalog)[number]],
    new Set(["evt-dvhimss-23007"]),
  );
  assert.equal(kept[0]?.status, "published");
  assert.equal(kept[0]?.title, "Golf");
  const store = readFileSync(join(root, "src/content/store.ts"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const rssSrc = readFileSync(join(root, "src/ingest/rss.ts"), "utf8");
  const eventsStub = readFileSync(join(root, "src/ingest/events-stub.ts"), "utf8");
  assert.ok(!store.includes("review-queue"));
  assert.ok(store.includes("published-catalog.json"));
  assert.ok(worker.includes("async scheduled"));
  assert.ok(worker.includes("runScheduledIngest"));
  assert.ok(wrangler.includes("0 * * * *"));
  assert.ok(!wrangler.includes("routes"));
  assert.ok(!rssSrc.includes("linkedin.com"));
  assert.ok(!rssSrc.includes("api.twitter.com"));
  assert.ok(eventsStub.includes("events-stub"));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.ok(!latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((i) => /honor.?roll/i.test(i.title)));
});

test("Verity/Mira/Vale packet: featured Lead only, byline, dates, nav, chips, SEO", () => {
  const lead = leadItem(catalog);
  assert.equal(lead?.slug, "christianacare-epic-go-live");
  assert.notEqual(lead?.slug, "temple-chestnut-hill-jhp-2026-09-30");
  const news = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  assert.ok(!news.some((i) => i.slug === "christianacare-epic-go-live"));
  assert.ok(!news.some((i) => i.featured === true));
  assert.ok(news.some((i) => i.slug === "temple-chestnut-hill-jhp-2026-09-30"));

  const chestnut = catalog.find((i) => i.slug === "temple-chestnut-hill-jhp-2026-09-30")!;
  const hap = catalog.find((i) => i.slug === "hap-cms-0057-f-enforce-rfi")!;
  const honor = catalog.find((i) => i.slug === "temple-honor-roll-2026")!;
  const mlh = catalog.find((i) => i.slug === "mlh-cloud-analytics-2026-08-17")!;
  assert.equal(newsByline(chestnut), "Temple Health – Chestnut Hill Hospital");
  assert.ok(!newsByline(chestnut).includes("Valley Desk"));
  assert.ok(!itemByline(chestnut, "news").includes("Valley Desk"));
  assert.equal(itemByline(honor, "voice"), "Benjamin Slovis");
  assert.equal(itemByline(mlh, "voice"), "Main Line Health (official account)");
  assert.equal(honor.kind === "voice" ? honor.role : "", "Temple Health CMIO");
  assert.notEqual(hap.publishedAt, chestnut.publishedAt);
  assert.notEqual(formatDate(hap.publishedAt), formatDate(chestnut.publishedAt));
  assert.ok(formatDate(hap.publishedAt).includes("2025"));
  assert.ok(formatDate(chestnut.publishedAt).includes("2026"));
  assert.equal(kindChip(hap), "POLICY");
  assert.equal(chipKind(hap), "policy");

  assert.equal(navSection("/news/temple-chestnut-hill-jhp-2026-09-30"), "news");
  assert.notEqual(navSection("/news/temple-chestnut-hill-jhp-2026-09-30"), "voices");
  assert.equal(navSection("/voices"), "voices");
  assert.equal(navSection("/voices/temple-honor-roll-2026"), "voices");
  assert.equal(navSection("/events/njdvhimss-fall-conference-october-13th-15th"), "events");
  assert.equal(navSection("/"), null);

  assert.equal(itemJsonLd(honor), undefined);
  assert.notEqual(itemJsonLd(honor)?.["@type"], "NewsArticle");
  assert.equal(itemJsonLd(chestnut)?.["@type"], "NewsArticle");

  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  const desk = readFileSync(join(root, "src/ui/home/Desk.tsx"), "utf8");
  const leadSrc = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const page = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  const footer = readFileSync(join(root, "src/ui/home/SiteFooter.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const indexCss = readFileSync(join(root, "src/index.css"), "utf8");
  const head = readFileSync(join(root, "src/ui/DocumentHead.tsx"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");

  assert.ok(home.includes("desk.length"));
  assert.ok(desk.includes("items.length === 0"));
  assert.ok(desk.includes("return null"));
  assert.ok(leadSrc.includes("<Link to={itemHref(item)}>"));
  assert.ok(leadSrc.includes("MentionText"));
  assert.ok(leadSrc.includes("Lead-headline"));
  assert.ok(rail.includes("publishedAt"));
  assert.ok(rail.includes("formatDate"));
  assert.ok(rail.includes("chipKind"));
  assert.ok(!rail.includes("topics[0]"));
  assert.ok(page.includes("KindList-title"));
  assert.ok(page.includes("KIND_LABEL.voice"));
  assert.ok(page.includes("KIND_LABEL.event"));
  assert.ok(page.includes("KIND_LABEL.news"));
  assert.ok(itemPage.includes("itemByline"));
  assert.ok(itemPage.includes("ItemPage"));
  assert.ok(!itemPage.includes("Valley Desk"));
  assert.ok(layout.includes("is-news"));
  assert.ok(layout.includes("is-events"));
  assert.ok(layout.includes("is-voices"));
  assert.ok(layout.includes("navSection"));
  assert.ok(layout.includes('to="/voices"'));
  assert.ok(footer.includes("Delaware Valley"));
  assert.ok(footer.includes("© The Valley Desk"));
  assert.ok(css.includes(".NavLink:focus-visible"));
  assert.ok(css.includes("outline-width: 2px"));
  assert.ok(css.includes("outline-style: solid"));
  assert.ok(css.includes("outline-color: var(--ink)"));
  assert.ok(css.includes("var(--motion-fast)"));
  assert.ok(indexCss.includes(".SiteNav a.NavLink:focus-visible"));
  assert.ok(indexCss.includes(".SiteHeader-brand:focus-visible"));
  assert.ok(indexCss.includes(".SiteFooter a:focus-visible"));
  assert.ok(css.includes("grid-template-columns: 1fr 1fr 1fr"));
  assert.ok(!css.includes("grid-template-columns: 1fr 1fr;"));
  assert.ok(css.includes(".GroupChip[data-kind=\"voice\"]"));
  const voiceChip = css.slice(css.indexOf('.GroupChip[data-kind="voice"]'), css.indexOf(".StatusChip[data-status=\"review\"]"));
  assert.ok(voiceChip.includes("var(--ink)"));
  assert.ok(!voiceChip.includes("var(--mute)"));
  assert.ok(css.includes(".ItemPage"));
  assert.ok(css.includes(".KindList-title"));
  assert.ok(head.includes('desc = "Voices"'));
  assert.ok(head.includes('ogType'));
  assert.ok(!head.includes('item && item.kind !== "event"'));
  assert.ok(worker.includes('desc = "Voices"'));
  assert.ok(worker.includes("articleKinds"));
  assert.ok(!worker.includes('item && item.kind !== "event"'));
});

test("Reed/Sloan packet: signed facts, first-mention chips, chapter pin, four pay facts", () => {
  assert.equal(entityRows.length, 92);
  const byId = Object.fromEntries(entityRows.map((e) => [e.id, e]));
  const labels = (id: string) => (byId[id]?.facts ?? []).map((f) => f.label);

  assert.deepEqual(labels("org-christianacare"), [
    "Net patient service revenue $3,140,501,000 · YE June 30, 2025",
  ]);
  assert.equal(byId["org-christianacare"]?.facts?.length, 1);
  assert.ok(!/operating/i.test(JSON.stringify(byId["org-christianacare"]?.facts)));
  assert.ok(!/3,289,202,000/.test(JSON.stringify(byId["org-christianacare"]?.facts)));
  assert.deepEqual(labels("org-jefferson"), [
    "Total operating revenues $15,755,857,000 · YE June 30, 2025",
    "Net patient service revenue $11,054,287,000 · YE June 30, 2025",
  ]);
  assert.equal(labels("org-temple")[0], "TUH Inc. program service revenue $2,574,187,207 · FY25 990");
  assert.equal(byId["org-temple"]?.facts?.[0]?.detail, "total revenue $2,728,530,922");
  assert.deepEqual(labels("org-cooper"), [
    "Program service revenue $2,391,541,266 · total $2,550,029,191 · FYE Dec. 31, 2024",
    "Part VIII 2a NET PATIENT SVC REV. $2,275,446,711 · YE Dec. 31, 2024 · EIN 21-0634462",
  ]);
  assert.deepEqual(labels("org-chop"), [
    "Program service revenue $3,529,304,347 · total $4,165,576,231 · FYE June 30, 2025 (TY2024)",
    "Part VIII 2a NET PATIENT REVENUE $3,307,657,737 · YE June 30, 2025 · EIN 23-1352166",
  ]);
  assert.ok(!/operating/i.test(labels("org-chop")[1] ?? ""));
  assert.ok(!/program service|program\/total/i.test(labels("org-chop")[1] ?? ""));
  assert.equal(
    labels("org-virtua")[0],
    "Patient service revenue $3,402,619,000 · total $3,629,539,000 · YE Dec. 31, 2025",
  );
  assert.equal(
    labels("org-inspira")[0],
    "Net patient service revenue $1,300,688,000 · total $1,457,534,000 · YE Dec. 31, 2025",
  );
  assert.equal(
    labels("person-dave-johnson")[0],
    "Reportable compensation $563,295 · Sch J $682,305 · FYE 12/31/2024",
  );
  assert.equal(byId["person-dave-johnson"]?.facts?.[0]?.kind, "salary");
  assert.equal(byId["person-dave-johnson"]?.facts?.[0]?.filerOrg, "Inspira Medical Centers, Inc.");

  assert.equal(labels("person-tom-bartiromo")[0], "SVP CIO · reportable $562,874 · Sch J $664,344");
  assert.equal(byId["person-tom-bartiromo"]?.facts?.[0]?.filerOrg, "Reading Hospital");
  assert.equal(byId["person-tom-bartiromo"]?.facts?.[0]?.citation.name, "Reading Hospital 990");
  assert.ok(
    !/tower/i.test(JSON.stringify(byId["person-tom-bartiromo"]?.facts?.filter((f) => f.kind === "salary"))),
  );
  assert.equal(labels("person-luke-olenoski")[0], "SVP CIO · reportable $663,099 · Sch J $868,996");
  assert.equal(byId["person-luke-olenoski"]?.facts?.[0]?.filerOrg, "Main Line Services");
  assert.equal(byId["person-luke-olenoski"]?.facts?.[0]?.citation.name, "Main Line Services 990");
  assert.ok(!/health system parent/i.test(JSON.stringify(byId["person-luke-olenoski"]?.facts)));
  assert.equal(labels("person-thomas-f-gordon")[0], "SVP/CIO · reportable $725,521 · Sch J $795,556");
  assert.equal(byId["person-thomas-f-gordon"]?.facts?.[0]?.filerOrg, "Virtua Health Inc.");
  assert.equal(byId["person-thomas-f-gordon"]?.facts?.[0]?.citation.name, "Virtua Health Inc. 990");
  assert.notEqual(
    byId["person-thomas-f-gordon"]?.facts?.[0]?.citation.url,
    byId["org-virtua"]?.facts?.[0]?.citation.url,
  );
  const salaryIds = entityRows.filter((e) => e.facts?.some((f) => f.kind === "salary")).map((e) => e.id).sort();
  assert.deepEqual(salaryIds, [
    "person-dave-johnson",
    "person-luke-olenoski",
    "person-thomas-f-gordon",
    "person-tom-bartiromo",
  ]);
  assert.ok(entityRows.every((e) => citableFacts(e.facts).every((f) => f.citation.url)));

  const emptyUrl = factBearingEntities([
    {
      ...byId["org-chop"]!,
      facts: [{ kind: "revenue", label: "No cite", citation: { name: "x" } }],
    },
  ]);
  assert.deepEqual(emptyUrl, []);

  const bearing = factBearingEntities(entityRows);
  const first = findFirstMentions("Jefferson Einstein and Jefferson again", bearing);
  assert.equal(first.filter((h) => h.orgId === "org-jefferson").length, 1);
  const second = findFirstMentions("Jefferson again", bearing, new Set(["org-jefferson"]));
  assert.equal(second.filter((h) => h.orgId === "org-jefferson").length, 0);
  const painted = findFirstMentions(
    "quoted Tom Bartiromo, senior vice president and CIO of Tower Health",
    bearing,
  );
  assert.equal(painted.filter((h) => h.orgId === "person-tom-bartiromo").length, 1);
  assert.equal(painted.find((h) => h.orgId === "person-tom-bartiromo")?.facts[0]?.citation.name, "Reading Hospital 990");
  assert.ok(!painted.some((h) => h.orgId === "org-tower"));

  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  const mention = readFileSync(join(root, "src/ui/MentionText.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  assert.ok(!/path:\s*["']\/org\//.test(router));
  assert.ok(!mention.includes("/org/"));
  assert.ok(!mention.includes("tabIndex"));
  assert.ok(!mention.includes("tabindex"));
  assert.ok(mention.includes("Escape"));
  assert.ok(mention.includes("mousedown"));
  assert.ok(mention.includes("aria-describedby"));
  assert.ok(mention.includes("placeOrgChip"));
  assert.ok(mention.includes("GRACE_MS"));
  assert.ok(mention.includes("createPortal"));
  assert.ok(layout.includes("MentionScope"));
  assert.ok(!catalog.some((i) => /bartiromo|olenoski/i.test(JSON.stringify(i.facts ?? []))));

  const pin = nextChapterEvent(catalog, new Date("2026-08-23T20:00:00.000Z"));
  assert.equal(pin?.slug, "njdvhimss-fall-conference-october-13th-15th");
  assert.equal(pin?.registrationUrl, "https://web.cvent.com/event/01ce5c42-9d59-4fea-a0f5-ae4fa59f9e4e/summary");
  assert.equal(catalog.find((i) => i.id === "evt-01")?.status, "draft");
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");

  const hap = catalog.find((i) => i.slug === "hap-patient-safety-symposium-2026-09-02");
  const lsf = catalog.find((i) => i.slug === "life-sciences-future-2026-09-30");
  const acheGolf = catalog.find((i) => i.slug === "ache-nj-golf-outing-2026-09-09");
  assert.equal(
    hap && hap.kind === "event" ? hap.registrationUrl : "",
    "https://my.haponline.org/Events/Calendar-Of-Events/Meeting-Home-Page?meetingid=%7B0C23A820-246B-F111-A825-7C1E524A88B5%7D",
  );
  for (const item of catalog) {
    if (item.kind === "event" && item.registrationUrl) {
      assert.ok(!/[{}]/.test(item.registrationUrl), item.slug);
    }
  }
  assert.equal(
    lsf && lsf.kind === "event" ? lsf.registrationUrl : "",
    "https://events.ticketleap.com/tickets/life-sciences-pennsylvania/life-sciences-future-2026",
  );
  assert.equal(acheGolf && acheGolf.kind === "event" ? acheGolf.startsAt : "", "2026-09-09T11:00:00.000Z");
  assert.equal(acheGolf && acheGolf.kind === "event" ? acheGolf.venue : "", "Crystal Springs, Hamburg NJ");

  const noRegister = [
    "ache-eastern-pa-fall-symposium-2026-09-30",
    "builds-bio-philly-2026-09-15",
  ];
  for (const slug of noRegister) {
    const row = catalog.find((i) => i.slug === slug);
    assert.equal(row?.status, "published", slug);
    assert.equal(row && row.kind === "event" ? row.registrationUrl : "missing", undefined, slug);
  }

  const withRegister = [
    "bionj-manufacturing-summit-2026-09-29",
    "science-center-nucleus-awards-2026-09-29",
    "ache-greater-philly-connect-2026-09-02",
    "ache-nj-virtual-behavioral-health-2026-08-27",
    "ache-nj-golf-outing-2026-09-09",
    "dha-healthcare-forum-2026-10-29",
    "bionj-members-cafe-2026-09-15",
    "bionj-entrepreneurs-exchange-2026-09-23",
    "lspa-open-house-2026-09-02",
    "wistar-drug-discovery-forum-2026-09-09",
  ];
  for (const slug of withRegister) {
    const row = catalog.find((i) => i.slug === slug);
    assert.equal(row?.kind, "event", slug);
    assert.equal(row?.status, "published", slug);
    assert.equal(row?.featured, false, slug);
    assert.ok(row && row.kind === "event" && row.registrationUrl, slug);
  }
  const bionj = catalog.find((i) => i.slug === "bionj-manufacturing-summit-2026-09-29");
  assert.ok(bionj?.body.includes("$150/$275"));
  assert.ok(!catalog.some((i) => i.kind === "event" && i.status === "published" && "price" in ((i as { offers?: unknown }).offers ?? {})));
});

test("Sloan CIO paint news: Olenoski and Gordon stay as review slugs; pay facts remain", () => {
  const olenoski = catalog.find((i) => i.slug === "mlh-olenoski-cio");
  const gordon = catalog.find((i) => i.slug === "virtua-gordon-cio");
  assert.ok(olenoski && gordon);
  for (const item of [olenoski, gordon]) {
    assert.equal(item.kind, "news");
    assert.equal(item.status, "review");
    assert.equal(item.featured, false);
    assert.equal(bySlug(catalog, item.slug), undefined);
    assert.ok(!latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((row) => row.slug === item.slug));
    assert.ok(!publishedNewsList(catalog).some((row) => row.slug === item.slug));
    assert.ok(item.publishedAt?.startsWith("2026-08-23"));
    assert.ok(!/ORBIE|Vanguard|350 locations|banking/i.test(`${item.title} ${item.body} ${item.dek}`));
    assert.ok(!newsByline(item).includes("Valley Desk"));
  }
  assert.equal(olenoski.title, "Luke Olenoski, Main Line Health CIO");
  assert.equal(
    olenoski.body,
    "Luke Olenoski serves as the Senior Vice President and Chief Information Officer for Main Line Health.",
  );
  assert.equal(olenoski.impactSentence, olenoski.body);
  assert.deepEqual(olenoski.orgs, ["org-main-line"]);
  assert.deepEqual(olenoski.authors, [{ name: "Main Line Health" }]);
  assert.equal(olenoski.source.url, "https://www.mainlinehealth.org/about/senior-leadership/luke-olenoski");
  assert.ok(olenoski.body.includes("Luke Olenoski"));
  assert.equal(gordon.title, "Thomas Gordon, Virtua CIO");
  assert.equal(gordon.body, "Thomas Gordon is senior vice president and chief information officer for Virtua.");
  assert.equal(gordon.impactSentence, gordon.body);
  assert.deepEqual(gordon.orgs, ["org-virtua"]);
  assert.deepEqual(gordon.authors, [{ name: "Virtua" }]);
  assert.equal(gordon.source.url, "https://www.virtua.org/About/Senior-Leadership/Thomas-Gordon");
  assert.ok(gordon.body.includes("Thomas Gordon"));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
  const byId = Object.fromEntries(entityRows.map((e) => [e.id, e]));
  assert.equal(byId["person-luke-olenoski"]?.facts?.[0]?.citation.name, "Main Line Services 990");
  assert.equal(byId["person-thomas-f-gordon"]?.facts?.[0]?.citation.name, "Virtua Health Inc. 990");
  assert.equal(byId["person-tom-bartiromo"]?.facts?.[0]?.citation.name, "Reading Hospital 990");
  assert.ok(
    !/tower/i.test(JSON.stringify(byId["person-tom-bartiromo"]?.facts?.filter((f) => f.kind === "salary"))),
  );
  const paintedO = findFirstMentions(olenoski.title + " " + olenoski.body, factBearingEntities(entityRows));
  assert.ok(paintedO.some((h) => h.orgId === "person-luke-olenoski" && h.text === "Luke Olenoski"));
  const paintedG = findFirstMentions(gordon.title + " " + gordon.body, factBearingEntities(entityRows));
  assert.ok(paintedG.some((h) => h.orgId === "person-thomas-f-gordon" && h.text === "Thomas Gordon"));
});

test("signed school facts on existing people; pay and CC NPSR unchanged", () => {
  const byId = Object.fromEntries(entityRows.map((e) => [e.id, e]));
  const edu = (id: string) => (byId[id]?.facts ?? []).filter((f) => f.kind === "education");
  const salary = (id: string) => (byId[id]?.facts ?? []).filter((f) => f.kind === "salary");

  assert.equal(entityRows.length, 92);
  assert.deepEqual(
    (byId["org-christianacare"]?.facts ?? []).map((f) => f.label),
    ["Net patient service revenue $3,140,501,000 · YE June 30, 2025"],
  );
  assert.ok(!/operating|3,289,202,000/i.test(JSON.stringify(byId["org-christianacare"]?.facts)));

  assert.equal(salary("person-luke-olenoski")[0]?.citation.name, "Main Line Services 990");
  assert.equal(salary("person-thomas-f-gordon")[0]?.citation.name, "Virtua Health Inc. 990");
  assert.equal(salary("person-dave-johnson")[0]?.filerOrg, "Inspira Medical Centers, Inc.");
  assert.equal(salary("person-tom-bartiromo")[0]?.citation.name, "Reading Hospital 990");
  assert.ok(!/tower/i.test(JSON.stringify(salary("person-tom-bartiromo"))));

  assert.equal(edu("person-julian-mihai")[0]?.label, "MBA Chicago Booth · MS+BS CS Polytechnic University of Bucharest");
  assert.equal(edu("person-anna-schoenbaum")[0]?.label, "DNP+MS Informatics Maryland Nursing · BSN Medical College of Georgia");
  assert.equal(edu("person-john-donohue")[0]?.label, "BS Business Management University of Phoenix");
  assert.equal(edu("person-luke-olenoski")[0]?.label, "EMBA (Beta Gamma Sigma)+BS CS Villanova");
  assert.equal(
    edu("person-benjamin-slovis")[0]?.label,
    "CMIO Temple University Hospital · MD RWJ · informatics fellowship + EM residency Icahn/Mount Sinai",
  );
  assert.ok(!/Temple Health CMIO/i.test(JSON.stringify(edu("person-benjamin-slovis"))));
  assert.equal(edu("person-thomas-f-gordon")[0]?.label, "BS MIS LaSalle · MBA St. Joseph's Haub");
  assert.equal(edu("person-dave-johnson")[0]?.label, "Inspira SVP CIIO · MBA Saint Joseph's · BA Animatics Rutgers");
  assert.equal(edu("person-dave-johnson")[0]?.citation.url, undefined);
  assert.ok(!/Kevin/.test(JSON.stringify(byId["person-dave-johnson"])));
  assert.equal(edu("person-bimal-desai")[0]?.label, "MBI OHSU · MD WashU · internship/residency CHOP");
  assert.equal(edu("person-bimal-desai")[0]?.citation.url, "https://www.chop.edu/doctors/desai-bimal");
  assert.equal(
    edu("person-bimal-desai")[1]?.label,
    "Professor of Clinical Pediatrics · B.S. Biology Emory 1995 · M.D. WashU 2000 · M.B.I. OHSU 2008",
  );
  assert.equal(edu("person-bimal-desai")[1]?.citation.url, "https://www.med.upenn.edu/apps/faculty/index.php/g275/p17256");
  assert.ok(edu("person-bimal-desai")[1]?.detail?.includes("267-426-6552"));
  assert.ok(!/@/.test(JSON.stringify(edu("person-bimal-desai"))));
  assert.ok(!/ORCA author/i.test(JSON.stringify(edu("person-bimal-desai"))));
  assert.equal(edu("person-robert-hartmann")[0]?.label, "MBA Northwestern · BA economics Vanderbilt");
  assert.deepEqual(
    edu("person-anahi-santiago").map((f) => f.label),
    ["EMBA", "MBA Drexel + BS ECE Drexel"],
  );
  assert.equal(edu("person-tom-bartiromo")[0]?.label, "bachelor's Computer Science, Brick Computer Science Institute");
  assert.equal(edu("person-randall-gaboriault")[0]?.label, "Randy Gaboriault, MS, MBA");
  assert.equal(
    edu("person-randall-gaboriault")[1]?.label,
    "Business Administration, Executive Master, Oxford / Business Administration, Business Administration, Dartmouth College / Bachelor's Degree, Temple University",
  );
  assert.equal(
    edu("person-randall-gaboriault")[1]?.citation.url,
    "https://news.christianacare.org/our-experts-media/randy-gaboriaultms/",
  );

  for (const id of [
    "person-vinay-bharel",
    "person-mitchell-schnall",
    "person-hojjat-salmasian",
    "person-jeffrey-pennington",
  ]) {
    assert.equal(edu(id).length, 0, id);
  }
  assert.ok(!entityRows.some((e) => /cancilla/i.test(e.id)));
  assert.ok(!/path:\s*["']\/org\//.test(readFileSync(join(root, "src/router.tsx"), "utf8")));
  const factsBlob = JSON.stringify(entityRows.flatMap((e) => e.facts ?? []));
  assert.ok(!/@[a-z0-9.-]+\./i.test(factsBlob));
});

test("Reed OrgChip geometry: above, header flips under dek, rail stays in column, mobile under dek", () => {
  const rect = (top: number, left: number, width: number, height: number) => ({
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  const chip = { width: 320, height: 80 };
  const viewport = { width: 1200, height: 800 };
  const header = rect(0, 0, 1200, 72);
  const lead = rect(80, 56, 1088, 280);
  const h1 = rect(100, 56, 1088, 160);
  const dek = rect(280, 56, 1088, 80);

  const above = placeOrgChip({
    mention: rect(500, 80, 140, 20),
    chip,
    viewport,
    header,
    lead,
    dek,
    h1,
  });
  assert.ok(above.top + 80 <= 500);
  assert.ok(above.top >= 8);
  assert.ok(above.left >= 8);
  assert.ok(above.left + above.width <= 1200 - 8);

  const flipped = placeOrgChip({
    mention: rect(110, 80, 200, 24),
    chip,
    viewport,
    header,
    lead,
    dek,
    h1,
  });
  assert.ok(flipped.top >= dek.bottom);
  assert.ok(flipped.top >= lead.bottom || flipped.top >= dek.bottom);
  assert.ok(flipped.top >= h1.bottom);
  assert.ok(flipped.top + 80 > dek.bottom);

  const column = rect(400, 56, 344, 400);
  const row = rect(420, 56, 344, 80);
  const eventsGutter = 420;
  const rail = placeOrgChip({
    mention: rect(450, 70, 160, 20),
    chip,
    viewport,
    header,
    lead,
    dek,
    h1,
    row,
    column,
  });
  assert.ok(rail.left >= column.left);
  assert.ok(rail.left + rail.width <= column.right);
  assert.ok(rail.left + rail.width <= eventsGutter);
  assert.ok(rail.top >= row.bottom);
  assert.ok(rail.left >= 8);

  const mobileCol = rect(80, 20, 350, 280);
  const mobile = placeOrgChip({
    mention: rect(110, 40, 180, 24),
    chip,
    viewport: { width: 390, height: 800 },
    header: rect(0, 0, 390, 72),
    lead: mobileCol,
    dek: rect(260, 20, 350, 60),
    h1: rect(90, 20, 350, 140),
    column: mobileCol,
    mobile: true,
  });
  assert.ok(mobile.top >= 260 + 60);
  assert.ok(mobile.top >= 90 + 140);
  assert.equal(mobile.width, 350);
  assert.ok(mobile.left >= 8);
});

test("Reed liability: item-page prints signed facts; CC is NPSR-only; CIO slugs off public surfaces", () => {
  const ccItem = catalog.find((i) => i.slug === "christianacare-epic-go-live");
  assert.ok(ccItem);
  const hits = itemSignedFacts(ccItem!, entityRows);
  const cc = hits.find((hit) => hit.orgId === "org-christianacare");
  assert.ok(cc);
  assert.equal(cc?.facts.length, 1);
  assert.equal(cc?.facts[0]?.label, "Net patient service revenue $3,140,501,000 · YE June 30, 2025");
  assert.equal(cc?.facts[0]?.citation.name, "PwC AFS");
  assert.equal(
    cc?.facts[0]?.citation.url,
    "https://app.fac.gov/dissemination/report/pdf/2025-06-GSAFAC-0000407992",
  );
  assert.ok(!/operating|3,289,202,000/i.test(JSON.stringify(cc?.facts)));
  assert.ok(!/operating/i.test(readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8")));

  const mention = readFileSync(join(root, "src/ui/MentionText.tsx"), "utf8");
  assert.ok(mention.includes("item-fact-") || mention.includes("printed"));
  assert.ok(mention.includes("chipId"));

  const feed = readFileSync(join(root, "public/feed.json"), "utf8");
  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  const published = readFileSync(join(root, "src/content/published-catalog.json"), "utf8");
  const workerPublished = readFileSync(join(root, "worker-published.js"), "utf8");
  for (const slug of ["mlh-olenoski-cio", "virtua-gordon-cio"]) {
    assert.ok(!feed.includes(`"slug": "${slug}"`));
    assert.ok(!sitemap.includes(`/news/${slug}`));
    assert.ok(!published.includes(`"slug": "${slug}"`));
    assert.ok(!workerPublished.includes(slug));
  }
});

