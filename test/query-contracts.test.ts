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
} from "../src/content/schema.ts";
import { toReviewQueue } from "../src/ingest/envelope.ts";
import { rssItemToContent } from "../src/ingest/rss.ts";
import { CLOSED_LIVE_SEED_IDS, hasLiveSeedOrg, liveSeedOrgIds } from "../src/content/seed.ts";
import { eventRegisterUrl } from "../src/lib/register.ts";
import { eventJsonLd, itemJsonLd } from "../src/content/jsonld.ts";
import { toFeed } from "../src/ingest/feed-contract.ts";
import { canonicalUrl, canonicalPath } from "../src/lib/canonical.ts";
import { formatChipLabel, formatLeadDate } from "../src/lib/format.ts";
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

test("briefingSinceYesterday5pmET may include review/QUEUED; overlap first, then publishedAt — never clockAt", () => {
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
    ["shared-newer", "shared-review", "shared-older", "clock"],
  );
  assert.ok(desk.some((i) => i.status === "review"));
  assert.ok(!desk.some((i) => i.id === "draft"));
  const src = readFileSync(join(root, "src/content/queries.ts"), "utf8");
  const deskFn = src.slice(
    src.indexOf("export function briefingSinceYesterday5pmET"),
    src.indexOf("function isLeadNews"),
  );
  assert.ok(!deskFn.includes("item.clockAt"));
  assert.ok(!deskFn.includes("deskSortKey"));
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

test("Sloan three: published, featured false, source publishedAt, no Temple Slovis/Dragon", () => {
  const christiana = catalog.find((i) => i.id === "news-christianacare-epic");
  const loss = catalog.find((i) => i.id === "news-jefferson-fy2026-loss");
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe");
  assert.ok(christiana && loss && penn);
  for (const item of [christiana, loss, penn]) {
    assert.equal(item.status, "published");
    assert.equal(item.featured, false);
    assert.equal(item.kind, "news");
  }
  assert.equal(christiana.kind === "news" ? christiana.clockAt : undefined, "2026-10-03T04:00:00.000Z");
  assert.equal(christiana.publishedAt, "2026-07-01T16:00:00.000Z");
  assert.equal(loss.kind === "news" ? loss.clockAt : "none", undefined);
  assert.equal(loss.publishedAt, "2026-08-14T16:00:00.000Z");
  assert.equal(penn.kind === "news" ? penn.clockAt : "none", undefined);
  assert.equal(penn.publishedAt, "2025-11-10T16:00:00.000Z");
  const pennLead = `${penn.title}\n${penn.dek}\n${penn.impactSentence}`;
  assert.ok(pennLead.includes("1,200"));
  assert.ok(!pennLead.includes("46"));
  assert.ok(!catalog.some((i) => /slovis|dragon/i.test(`${i.id} ${i.title} ${i.body}`)));
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
  assert.ok(!router.includes("/org"));
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
  const mixerOnly = catalog.filter((i) => i.id === "evt-01");
  assert.equal(nextChapterEvent(mixerOnly, now)?.id, "evt-01");
  const pinned = pinnedUpcomingEvents(catalog, now, 6);
  assert.equal(pinned[0]?.id, chapter?.id);
  assert.equal(pinned.filter((i) => i.id === chapter?.id).length, 1);
  assert.ok(pinned.some((i) => i.id === "evt-01"));
  assert.ok(pinned.some((i) => i.id === "evt-02"));
  assert.ok(pinned.every((i) => i.kind === "event" && i.status === "published"));
  assert.ok(pinned.every((i) => i.startsAt >= now.toISOString()));
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
  assert.ok(!JSON.stringify(ld).includes("Offer.price"));
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
  assert.ok(!router.includes("/org/"));
  assert.ok(!router.includes("/orgs"));
  assert.ok(!router.includes("EntityPage"));
  assert.ok(entitySrc.includes("does not mint /org/{id}"));
  assert.ok(rss.includes("<link>https://thevalleydesk.org/news/penn-in-house-ai-scribe</link>"));
  assert.ok(rss.includes("<guid isPermaLink=\"true\">https://thevalleydesk.org/news/penn-in-house-ai-scribe</guid>"));
  assert.ok(rss.includes("<link>https://thevalleydesk.org/events/njdvhimss-fall-conference-october-13th-15th</link>"));
  assert.ok(build.includes("canonicalUrl(item)"));
  assert.ok(!build.includes("citations?.[0]"));
  for (const item of catalog.filter((row) => row.status === "published")) {
    const canon = canonicalUrl(item);
    assert.ok(rss.includes(`<link>${canon}</link>`), item.id);
    assert.ok(rss.includes(`<guid isPermaLink="true">${canon}</guid>`), item.id);
    const jsonItem = feed.items.find((row) => row.id === item.id);
    if (item.source.url) {
      assert.equal(jsonItem?.source?.url, item.source.url);
      assert.ok(!rss.includes(`<link>${item.source.url}</link>`));
      assert.ok(!rss.includes(`<guid isPermaLink="true">${item.source.url}</guid>`));
    }
    for (const citation of item.citations ?? []) {
      assert.ok(!rss.includes(`<link>${citation.url}</link>`));
      assert.ok(!rss.includes(`<guid isPermaLink="true">${citation.url}</guid>`));
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
