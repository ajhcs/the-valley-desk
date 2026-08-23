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
  latestNews,
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
import { CLOSED_LIVE_SEED_IDS, hasLiveSeedOrg, liveSeedOrgIds } from "../src/content/seed.ts";
import { eventRegisterUrl } from "../src/lib/register.ts";
import { eventJsonLd, itemJsonLd } from "../src/content/jsonld.ts";
import { toFeed } from "../src/ingest/feed-contract.ts";
import { canonicalUrl, canonicalPath } from "../src/lib/canonical.ts";
import { formatChipLabel, formatLeadDate } from "../src/lib/format.ts";
import { KIND_CHIP, kindChip } from "../src/lib/kind.ts";
import { Entity } from "../src/content/entity.ts";

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
  assert.ok(ids.includes("news-01"));
  assert.ok(ids.includes("policy-01"));
  assert.ok(ids.includes("news-jefferson-einstein-mychart"));
  assert.ok(ids.includes("news-christianacare-epic"));
  assert.ok(ids.includes("news-jefferson-fy2026-loss"));
  assert.ok(ids.includes("news-penn-ai-scribe"));
  assert.ok(ids.includes("news-temple-dragon-copilot"));
  assert.ok(ids.includes("news-chop-orca-cds"));
  assert.ok(ids.includes("news-tower-ai-tax"));
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
  assert.equal(kindChip(penn), "HIT");
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
  assert.ok(itemPage.includes("StatusChip"));
});

test("kind chip paint is mute/rule, ink, or admiral — never sky, never gold except QUEUED", () => {
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const kindNews = css.slice(css.indexOf('.StatusChip[data-kind="news"]'), css.indexOf('.StatusChip[data-kind="policy"]'));
  const kindPolicy = css.slice(css.indexOf('.StatusChip[data-kind="policy"]'), css.indexOf('.StatusChip[data-kind="ai"]'));
  const kindAi = css.slice(css.indexOf('.StatusChip[data-kind="ai"]'), css.indexOf('.StatusChip[data-status="review"]'));
  const queued = css.slice(css.indexOf('.StatusChip[data-status="review"]'), css.indexOf('.StatusChip[data-ann="ask"]'));
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

test("KindListPage /news uses the same latestNews gate; ai-01 stays out", () => {
  const page = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  assert.ok(page.includes("latestNews(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(!page.includes("newsFamily"));
  assert.ok(home.includes("latestNews(catalog)"));
  const ai = catalog.find((i) => i.id === "ai-01");
  assert.ok(ai);
  assert.deepEqual(ai.orgs, []);
  assert.ok(ai.impactSentence?.trim());
  assert.equal(ai.status, "published");
  assert.ok(!isPublicNewsFamily(ai, seedIds));
  const newsPage = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  assert.ok(!newsPage.some((i) => i.id === "ai-01"));
  assert.ok(newsPage.every((i) => isPublicNewsFamily(i, seedIds)));
  assert.ok(newsPage.some((i) => i.id === "news-jefferson-fy2026-loss"));
  assert.ok(newsPage.some((i) => i.kind === "policy"));
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
  assert.equal(loss.title, "Jefferson FY2026 operating loss and Fitch liquidity");
  assert.equal(loss.kind === "news" ? loss.clockAt : "none", undefined);
  assert.equal(loss.publishedAt, "2026-08-14T16:00:00.000Z");
  assert.deepEqual(loss.orgs, ["org-jefferson"]);
  assert.equal(loss.citations?.length, 2);
  assert.equal(loss.source.url, loss.citations?.[0]?.url);
  assert.ok(loss.body.includes("Independence Blue Cross"));
  assert.ok(loss.body.includes("Aetna"));
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
  assert.ok(!/honor.?roll|epic-names-temple|july 16/i.test(JSON.stringify(temple)));
  assert.ok(!/capalongo/i.test(`${temple.title} ${temple.dek} ${temple.body}`));
  assert.ok(temple.citations?.some((c) => c.name === "PBJ April 1 (sponsored)" && c.url.includes("bizjournals.com")));
  const blob = JSON.stringify(catalog);
  assert.ok(!blob.includes("org-ibc"));
  assert.ok(!blob.includes("org-aetna"));
  assert.ok(!blob.includes("org-microsoft"));
  assert.ok(!catalog.some((i) => i.id.startsWith("news-") && /chop/i.test(`${i.id} ${i.title}`)));
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
  assert.ok(home.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("latestNews"));
  assert.ok(!eventsPage.includes("newsFamily"));
  assert.ok(!rail.includes("topics[0]"));
  assert.ok(!home.includes("briefing[0]"));
  assert.ok(!home.includes("subscribe"));
  assert.ok(!home.includes("deskClocks"));
  assert.ok(!home.includes("homepage-10"));
  assert.ok(!home.toLowerCase().includes("himss seal"));
  assert.ok(home.includes("NEWS · LATEST"));
  assert.ok(home.includes("EVENTS · NEXT"));
  assert.ok(lead.includes("THE DESK"));
  assert.ok(lead.includes("Lead-headline"));
  assert.ok(lead.includes("Impact:"));
  assert.ok(desk.includes("DeskRow"));
  assert.ok(desk.includes("impactSentence"));
  assert.ok(desk.includes("DeskRow-impact"));
  assert.ok(desk.includes("QUEUED"));
  assert.ok(desk.includes('ann="ask"'));
  assert.ok(!desk.toLowerCase().includes("spill"));
  assert.ok(rail.includes("RegisterLink"));
  assert.ok(!rail.includes("queued"));
  assert.ok(footer.includes("News"));
  assert.ok(footer.includes("Events"));
  assert.ok(footer.includes("feed.json"));
  assert.ok(footer.includes("feed.xml"));
  assert.ok(footer.includes("© The Valley Desk"));
  assert.ok(!footer.toLowerCase().includes("subscribe"));
  assert.ok(layout.includes("MarkFold"));
  assert.ok(layout.includes("Wordmark"));
  assert.ok(layout.includes("NavLink"));
  assert.ok(layout.includes('to="/news"'));
  assert.ok(layout.includes('to="/events"'));
  assert.ok(!layout.includes('to="/voices"'));
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
});

test("Register uses registrationUrl only; locked DVHIMSS URLs unchanged", () => {
  const fall = catalog.find((i) => i.id === "evt-dvhimss-22958");
  const golf = catalog.find((i) => i.id === "evt-dvhimss-23007");
  const networking = catalog.find((i) => i.id === "evt-01");
  const jefferson = catalog.find((i) => i.id === "evt-02");
  assert.equal(eventRegisterUrl(fall!), "https://njdvhimssevent.com/");
  assert.equal(
    eventRegisterUrl(golf!),
    "https://dvhimss.org/events-calendar/njdvhimss-annual-golf-outing-october-13-930-am-330-pm-et/",
  );
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
  assert.equal(eventRegisterUrl(chapter!), "https://njdvhimssevent.com/");
  assert.ok(chapter?.registrationUrl);
  const mixerOnly = catalog.filter((i) => i.id === "evt-01");
  assert.equal(nextChapterEvent(mixerOnly, now)?.id, "evt-01");
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
  assert.ok(pinned.some((i) => i.id === "evt-01"));
  assert.ok(pinned.some((i) => i.id === "evt-02"));
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
  assert.deepEqual((ld?.offers as { url?: string; price?: string } | undefined)?.url, "https://njdvhimssevent.com/");
  assert.equal((ld?.offers as { price?: string } | undefined)?.price, undefined);
  assert.equal((ld?.organizer as { name?: string; identifier?: string }).name, "DVHIMSS");
  assert.equal((ld?.organizer as { identifier?: string }).identifier, "org-dvhimss");
  assert.equal(ld?.url, "https://thevalleydesk.org/events/njdvhimss-fall-conference-october-13th-15th");
  assert.equal(ld?.mainEntityOfPage, ld?.url);
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
  const noOffer = eventJsonLd(jefferson, entityRows);
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
  assert.equal(fall && fall.kind === "event" ? fall.registrationUrl : undefined, "https://njdvhimssevent.com/");
  assert.ok(feed.items.every((i) => i.status === "published"));
  assert.ok(!feed.items.some((i) => i.status === "review"));
});

test("ItemPage is an aggregator card: chip, title, impact, body, citations — not a magazine template", () => {
  const page = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(page.includes("StatusChip"));
  assert.ok(page.includes("kindChip"));
  assert.ok(page.includes("item.impactSentence"));
  assert.ok(page.includes("itemCitations"));
  assert.ok(page.includes("item.body"));
  assert.ok(page.includes("ItemJsonLd"));
  assert.ok(page.includes("RegisterLink"));
  assert.ok(page.includes("registrationUrl"));
  assert.ok(page.includes("startsAt"));
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

test("canonical helper: news family under /news, events under /events", () => {
  assert.equal(canonicalPath({ kind: "news", slug: "penn-in-house-ai-scribe" }), "/news/penn-in-house-ai-scribe");
  assert.equal(canonicalPath({ kind: "policy", slug: "pa-doh-telehealth-guidance-2026" }), "/news/pa-doh-telehealth-guidance-2026");
  assert.equal(canonicalPath({ kind: "ai", slug: "epic-ambient-listening-note" }), "/news/epic-ambient-listening-note");
  assert.equal(canonicalPath({ kind: "interview", slug: "x" }), "/news/x");
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
  assert.equal(formatChipLabel(einstein), "SEP 26");
  assert.equal(formatChipLabel(fall), "OCT 13–15");
  assert.equal(formatLeadDate("2026-09-26T04:00:00.000Z"), "26 SEPTEMBER 2026");
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
  assert.ok(rss.includes("<description>About 1,200 ambulatory users is an Inquirer headcount; 20.4% less time in notes is a 46-clinician journal table, not that headcount.</description>"));
  assert.ok(!rss.includes("<description>The Philadelphia Inquirer, Nov. 10, 2025: internist Dina Capalongo hits a green button; the doctor still approves the note.</description>"));
  assert.ok(rss.includes("<description>Partner event, review-queued in the stub path; published here so the rail has two dates.</description>"));
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
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/feed.json</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/feed.xml</loc>"));
  assert.ok(sitemap.includes("<loc>https://thevalleydesk.org/news/penn-in-house-ai-scribe</loc>"));
  assert.ok(!sitemap.includes("/orgs/"));
  assert.ok(!sitemap.includes("/org/"));
  assert.ok(!sitemap.includes("https://thevalleydesk.org/policy"));
  assert.ok(!sitemap.includes("https://thevalleydesk.org/ai"));
});
