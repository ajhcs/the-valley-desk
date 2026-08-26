import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  briefingSinceYesterday5pmET,
  byPreviousSlug,
  bySlug,
  editionStamp,
  featuredLead,
  isPublicNewsFamily,
  isStaleLead,
  lastEditionAt,
  latestNews,
  latestVoices,
  leadItem,
  nextChapterEvent,
  nextEditionAt,
  pinnedUpcomingEvents,
  productWatch,
  publishedNewsList,
  upcomingEvents,
} from "../src/content/queries.ts";
import { mergePublishedOverlay, retainPublishedIdentity } from "../src/content/merge.ts";
import {
  ContentCatalog,
  ContentItem,
  EventItem,
  NewsItem,
  setFeaturedNews,
  canPublish,
  itemCitations,
  Status,
} from "../src/content/schema.ts";
import { toReviewQueue } from "../src/ingest/envelope.ts";
import { fetchDvhimssCalendar, ingestEventsWithHealth, scrapeNjdvhimss } from "../src/ingest/events.ts";
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
import { primaryDisplayLabel, primaryEventLabel, primaryNewsLabel, primaryVoiceLabel } from "../src/lib/taxonomy.ts";
import { Entity } from "../src/content/entity.ts";
import {
  citableFacts,
  factBearingEntities,
  findFirstMentions,
  itemOrgGraph,
  itemSignedFacts,
  publicEntityRole,
  publicEntityContext,
  displayFacts,
  VERIFIED_ENTITY_MEDIA,
  signedHoverLine,
  signedPrintLine,
  splitFirstSentence,
} from "../src/lib/entityFacts.ts";
import { itemByline, newsByline } from "../src/lib/byline.ts";
import { navSection } from "../src/lib/nav.ts";
import { eventIsUpcoming, eventLifecycle, eventSchedule, formatEventWhen, googleCalendarDates, googleCalendarUrl } from "../src/lib/calendar.ts";
import { eventWhyCopy, eventWhyLine, isBoilerplateEventCopy } from "../src/lib/eventCopy.ts";
import { hasDefensiveEditorialAside, hasInternalProcessLanguage, professionalizeHeadline } from "../src/lib/editorialCopy.ts";
import { matchingProductUses } from "../src/ingest/product-watch.ts";
import {
  candidateFingerprint,
  findPublishedContent,
  findPublishedSlugAlias,
  persistEditorialDecisions,
  persistEnrichments,
  persistIngestRun,
  persistSourceHealth,
  readPublicationTombstones,
  readPublishedContent,
  readReusableEnrichments,
  reconcileMissingPublishedEvents,
  type D1DatabaseLike,
  type D1StatementLike,
} from "../src/ingest/persistence.ts";
import {
  collapseBySourceIdentity,
  normalizeSourceUrl,
  sourceIdentityKey,
} from "../src/ingest/identity.ts";
import { RSS_SOURCES, ingestRssWithHealth, rssItemToContent } from "../src/ingest/rss.ts";
import { snapshotCompleteness, sourceAuthorizesDisappearance } from "../src/ingest/source-health.ts";
import { evaluateCandidate, EDITOR_POLICY_VERSION } from "../src/ingest/editor.ts";
import {
  EditorEnrichment,
  EditorModelError,
  enrichWithEditorModel,
  extractEditorJson,
  DEFAULT_EDITOR_BASE_URL,
  DEFAULT_EDITOR_MODEL,
  EDITOR_OUTPUT_MAX_TOKENS,
  EDITOR_REASONING_MAX_TOKENS,
} from "../src/ingest/editor-model.ts";
import {
  DEFAULT_EDITOR_MODEL_BUDGET,
  editorModelBackoffMs,
  isEditorModelEligible,
  selectEditorModelWork,
  shouldEnrichCandidate,
  type EditorModelState,
} from "../src/ingest/editor-work.ts";
import { runAutomation } from "../src/ingest/automation.ts";
import { editorContextForItem } from "../src/ingest/editor-context.ts";
import { mergePublishedContent, runtimeItemsScript } from "../src/ingest/public-feed.ts";
import { handleReviewApi } from "../src/ingest/review-api.ts";
import { runIngestAll } from "../src/ingest/run-all.ts";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entities = require("../fixtures/entities.json") as { id: string }[];
const entityRows = Entity.array().parse(JSON.parse(readFileSync(join(root, "fixtures/entities.json"), "utf8")));
const catalog = ContentCatalog.parse(JSON.parse(readFileSync(join(root, "fixtures/catalog.json"), "utf8")));
const seedIds = liveSeedOrgIds(entities);

class SqliteD1Statement implements D1StatementLike {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]) {
    const bound = new SqliteD1Statement(this.statement);
    bound.values = values;
    return bound;
  }

  async first<T = unknown>() {
    return (this.statement.get(...this.values as never[]) as T | undefined) ?? null;
  }

  async run() {
    return this.statement.run(...this.values as never[]);
  }

  async all<T = unknown>() {
    return { results: this.statement.all(...this.values as never[]) as T[] };
  }
}

function sqliteD1(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(query: string) {
      return new SqliteD1Statement(database.prepare(query));
    },
    async batch(statements: D1StatementLike[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function dvhimssResponse(website?: unknown) {
  return new Response(JSON.stringify({
    events: [{
      id: 42,
      title: "Chapter Forum",
      url: "https://dvhimss.org/event/chapter-forum/",
      website,
      utc_start_date: "2026-09-14 13:00:00",
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("DVHIMSS auto-publishes only with a verified registration URL", async () => {
  const registered = await fetchDvhimssCalendar(async () => dvhimssResponse("https://web.cvent.com/event/chapter-forum"));
  assert.equal(registered[0]?.registrationUrl, "https://web.cvent.com/event/chapter-forum");
  assert.equal(registered[0]?.autoPublish, true);
  assert.equal(registered[0]?.status, "published");
  assert.equal(registered[0]?.source.origin, "dvhimss-events");
  assert.equal(registered[0]?.source.externalId, "42");
  assert.equal(hasInternalProcessLanguage(registered[0]?.dek), false);
  assert.equal(hasInternalProcessLanguage(registered[0]?.body), false);
  assert.equal(hasInternalProcessLanguage(registered[0] && registered[0].kind === "event" ? registered[0].whyAttend : undefined), false);
  const decision = evaluateCandidate(registered[0]!, null, new Date("2026-08-26T12:00:00.000Z"));
  assert.equal(decision.action, "publish");
  assert.equal(decision.rule, "official-chapter-event");

  for (const website of [undefined, "javascript:alert(1)", "not a URL", "https://attacker.invalid/register"]) {
    const unverified = await fetchDvhimssCalendar(async () => dvhimssResponse(website));
    assert.equal(unverified[0]?.registrationUrl, undefined);
    assert.equal(unverified[0]?.autoPublish, false);
    assert.equal(unverified[0]?.status, "review");
  }
});

test("NJDVHIMSS auto-publishes only when its official page exposes a Cvent path", async () => {
  const page = (body: string) => async () => new Response(body, { status: 200 });
  const confirmed = await scrapeNjdvhimss(page(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
  `) as typeof fetch);
  assert.equal(confirmed[0]?.source.origin, "njhimss-events");
  assert.equal(confirmed[0]?.partner, "njhimss");
  assert.equal(confirmed[0]?.registrationUrl, "https://cvent.me/NAqAxv");
  assert.equal(confirmed[0]?.autoPublish, true);

  const unconfirmed = await scrapeNjdvhimss(page(`
    <a href="https://njdvhimssevent.com/agenda">Agenda</a>
    Tuesday, October 13, 2026 through October 15, 2026
  `) as typeof fetch);
  assert.equal(unconfirmed[0]?.registrationUrl, undefined);
  assert.equal(unconfirmed[0]?.autoPublish, false);
  assert.equal(unconfirmed[0]?.status, "review");
});

test("one event-source outage does not discard successful RSS ingestion", async () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title>ChristianaCare workflow update</title><link>https://news.christianacare.org/workflow-update</link><guid>workflow-update</guid><description>Epic workflow deployment.</description><pubDate>Wed, 26 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const result = await runIngestAll({}, new Date("2026-08-26T12:30:00.000Z"), async (input) => {
    const url = String(input);
    if (url.includes("christianacare.org")) return new Response(rss, { status: 200 });
    if (url.includes("dvhimss.org/wp-json")) throw new Error("upstream unavailable");
    if (url.includes("njdvhimssevent.com")) return new Response("", { status: 503 });
    return new Response("", { status: 503 });
  });
  assert.equal(result.rss.length, 1);
  assert.equal(result.events.length, 0);
});

test("first-party health-system feeds pin their verified organization", () => {
  const cooper = RSS_SOURCES.find((source) => source.id === "cooper-newsroom");
  assert.ok(cooper);
  assert.equal(cooper.origin, "cooper-newsroom");
  assert.deepEqual(cooper.orgIds, ["org-cooper"]);
  assert.equal(cooper.url, "https://blogs.cooperhealth.org/news/feed/");
});

test("an unrecognized NJ event page cannot trigger disappearance reconciliation", async () => {
  const result = await ingestEventsWithHealth(new Date("2026-08-26T12:00:00.000Z"), async (input) => {
    const url = String(input);
    if (url.includes("wp-json/tribe")) {
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }
    return new Response("<html><title>Temporary holding page</title></html>", { status: 200 });
  });
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.state, "success");
  assert.equal(nj?.complete, false);
  assert.equal(nj?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(nj!), false);
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(dvhimss?.state, "success");
  assert.equal(dvhimss?.itemCount, 0);
  assert.equal(dvhimss?.completeness, "empty-unverified");
  assert.equal(dvhimss?.complete, false);
  assert.equal(snapshotCompleteness(dvhimss!), "empty-unverified");
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
});

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

test("kind chip is editorial taxonomy, never topics[0]; Jefferson loss is FINANCE", () => {
  const loss = catalog.find((i) => i.id === "news-jefferson-fy2026-loss");
  assert.ok(loss);
  assert.equal(loss.kind, "news");
  assert.equal(loss.topics[0], "finance");
  assert.equal(kindChip(loss), "FINANCE");
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
  const productPage = readFileSync(join(root, "src/ui/ProductWatch.tsx"), "utf8");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  assert.ok(page.includes("publishedNewsList(catalog)"));
  assert.ok(!page.includes("latestNews(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(page.includes("Rail"));
  assert.ok(page.includes("NEWS · LATEST"));
  assert.ok(page.includes("ProductWatch"));
  assert.ok(productPage.includes("PRODUCTS · WATCH"));
  assert.ok(page.includes("VOICES · LATEST"));
  assert.ok(page.includes("latestVoices(catalog, Number.MAX_SAFE_INTEGER)"));
  assert.ok(!page.includes("ItemCard"));
  assert.ok(!page.includes("newsFamily"));
  assert.ok(home.includes("latestNews(catalog, 7)"));
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

test("upcomingEvents is published events still in progress and never reads clockAt", () => {
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
  const cancelled = EventItem.parse({
    ...future,
    id: "evt-cancelled-upcoming",
    slug: "evt-cancelled-upcoming",
    title: "Official Chapter Forum — Cancelled",
    cancelled: true,
  });
  const rows = upcomingEvents([past, queued, clockNews, future, cancelled], now, 10);
  assert.deepEqual(rows.map((i) => i.id), [future.id]);
  assert.ok(rows.every((i) => i.kind === "event"));
  assert.ok(!("clockAt" in (rows[0] ?? {})));
  assert.equal(bySlug([past, future], past.slug)?.id, past.id);
  assert.equal(eventLifecycle(past, now), "completed");
  assert.equal(eventLifecycle(cancelled, now), "cancelled");
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
  assert.ok(christiana.body.includes("underway since a 2024 decision"));
  assert.ok(!/not an Epic dollar|No FAC dollars/i.test(`${christiana.dek} ${christiana.body} ${christiana.impactSentence}`));
  assert.equal(loss.title, "Jefferson FY2026 operating loss and Fitch liquidity");
  assert.equal(loss.kind === "news" ? loss.clockAt : "none", undefined);
  assert.equal(loss.publishedAt, "2026-08-14T16:00:00.000Z");
  assert.deepEqual(loss.orgs, ["org-jefferson"]);
  assert.equal(loss.citations?.length, 2);
  assert.equal(loss.source.url, loss.citations?.[0]?.url);
  assert.ok(loss.body.includes("Independence Blue Cross"));
  assert.ok(loss.body.includes("Aetna"));
  assert.ok(!loss.body.includes("This desk has not opened the EMMA year-end PDF."));
  assert.ok(!loss.body.includes("not a substitute"));
  assert.equal(penn.title, "Penn in-house scribe headcount and 2024 JAMA pilot table");
  assert.equal(penn.kind === "news" ? penn.clockAt : "none", undefined);
  assert.equal(penn.publishedAt, "2025-11-10T16:00:00.000Z");
  assert.deepEqual(penn.orgs, ["org-penn"]);
  assert.equal(penn.citations?.length, 3);
  assert.equal(penn.source.url, penn.citations?.[0]?.url);
  const pennLead = `${penn.title}\n${penn.dek}\n${penn.impactSentence}`;
  assert.ok(pennLead.includes("1,200"));
  assert.ok(penn.body.includes("A separate JAMA Network Open study"));
  assert.ok(!/not this count|not the same product/i.test(`${penn.dek} ${penn.body} ${penn.impactSentence}`));
  assert.ok(!/slovis/i.test(`${penn.title} ${penn.dek} ${penn.body}`));
  assert.ok(!/does not name a commercial vendor|no vendor/i.test(`${penn.title} ${penn.dek} ${penn.body}`));
  assert.equal(temple.title, "Temple expands Dragon Copilot to 400 end users");
  assert.equal(temple.slug, "temple-dragon-copilot-400");
  assert.equal(temple.kind === "news" ? temple.clockAt : "none", undefined);
  assert.equal(temple.publishedAt, "2026-08-01T16:00:00.000Z");
  assert.deepEqual(temple.orgs, ["org-temple", "org-temple-tuh-main"]);
  assert.equal(temple.citations?.length, 3);
  assert.equal(temple.source.url, temple.citations?.[0]?.url);
  assert.ok(temple.body.includes("chief medical information officer at Philadelphia-based Temple Health"));
  assert.ok(temple.body.includes("Chief Medical Information Officer for Temple University Hospital"));
  assert.ok(temple.body.includes("reduced after-hours documentation time by more than 10 percent"));
  assert.ok(!/DCOH|not a filing|not this count/i.test(`${temple.title} ${temple.dek} ${temple.body} ${temple.impactSentence}`));
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
  assert.equal(chop.title, "CHOP publishes ORCA repo");
  assert.equal(chop.dek, "CHOP’s ORCA repository is an offline, read-only viewer for Epic order sets and SmartSets during downtime.");
  assert.ok(!chop.dek.includes("No paper n"));
  assert.ok(chop.body.includes("Desai and Hojjat Salmasian shared the repository"));
  assert.ok(chop.body.includes("reference when the live EHR is unavailable"));
  assert.ok(chop.body.includes("clear safety boundary"));
  assert.match(chop.contextSentence ?? "", /Applied Clinical Informatics/i);
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
  assert.ok(item.body.includes("until Jan. 1, 2027 for the FHIR APIs"));
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
  const eventsPage = readFileSync(join(root, "src/ui/EventsPage.tsx"), "utf8");
  const kindListPage = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const lead = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const desk = readFileSync(join(root, "src/ui/home/Desk.tsx"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const footer = readFileSync(join(root, "src/ui/home/SiteFooter.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  assert.ok(home.includes("leadItem"));
  assert.ok(home.includes("latestNews"));
  assert.ok(home.includes("rankedNews[0]"));
  assert.ok(home.includes("item.id !== lead?.id"));
  assert.ok(!home.includes("<Desk"));
  assert.ok(home.includes("latestVoices"));
  assert.ok(home.includes("pinnedUpcomingEvents"));
  assert.ok(eventsPage.includes("upcomingEvents"));
  assert.ok(eventsPage.includes("CHAPTER RADAR"));
  assert.ok(eventsPage.includes("NEXT UP"));
  assert.ok(kindListPage.includes("publishedNewsList"));
  assert.ok(kindListPage.includes("latestVoices"));
  assert.ok(!kindListPage.includes("newsFamily"));
  assert.ok(!rail.includes("topics[0]"));
  assert.ok(!home.includes("briefing[0]"));
  assert.ok(!home.includes("subscribe"));
  assert.ok(!home.includes("deskClocks"));
  assert.ok(!home.includes("homepage-10"));
  assert.ok(!home.toLowerCase().includes("himss seal"));
  assert.ok(home.includes("NEWS · LATEST"));
  assert.ok(home.includes("EVENTS · NEXT"));
  assert.ok(home.includes("VOICES · LATEST"));
  assert.ok(lead.includes("LATEST NEWS"));
  assert.ok(!lead.includes("item.publishedAt"));
  assert.ok(!lead.includes("chipInstant"));
  assert.ok(lead.includes("Lead-headline"));
  assert.ok(lead.includes("Lead-impact"));
  assert.ok(!lead.includes("Impact:"));
  assert.ok(desk.includes("THE DESK"));
  assert.ok(desk.includes("DeskRow"));
  assert.ok(desk.includes("impactSentence"));
  assert.ok(desk.includes("DeskRow-impact"));
  assert.ok(desk.includes("QUEUED"));
  assert.ok(desk.includes('ann="ask"'));
  assert.ok(!desk.toLowerCase().includes("spill"));
  assert.ok(rail.includes("RegisterLink"));
  assert.ok(!rail.includes("Impact:"));
  assert.ok(!rail.includes("impactSentence"));
  assert.ok(!rail.includes("queued"));
  {
    const registerAt = css.indexOf(".Register,");
    const registerCss = css.slice(registerAt, css.indexOf(".SiteFooter {", registerAt));
    assert.ok(registerCss.includes(".RailRow a.Register"));
    assert.ok(registerCss.includes("color: var(--event-text)"));
    assert.ok(!registerCss.includes("var(--ink)"));
    const dateChip = css.slice(css.indexOf(".DateChip"), css.indexOf(".StatusChip"));
    assert.ok(dateChip.includes("background: var(--event)"));
    assert.ok(dateChip.includes("color: var(--text)"));
    const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
    assert.ok(tokens.includes("--event-text: #9A6500"));
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

test("Tailwind scans application source only, not recovery evidence or archive text", () => {
  const css = readFileSync(join(root, "src/index.css"), "utf8");
  assert.ok(css.includes('@import "tailwindcss" source(".")'));
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
  assert.ok(eventsAdapter.includes("autoPublish: Boolean(registrationUrl)"));
  assert.ok(eventsAdapter.includes('status: registrationUrl ? "published" : "review"'));
  assert.ok(!/ingested from/i.test(eventsAdapter));
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
    false,
  );
  assert.equal(
    canPublish({
      kind: "event",
      status: "published",
      partner: "health-system",
      registrationUrl: "https://example.com/register",
    }),
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
  const scrapeFn = ingest.slice(ingest.indexOf("async function scrapeNjdvhimssBatch"));
  assert.ok(scrapeFn.includes("autoPublish: Boolean(registrationUrl)"));
  assert.ok(scrapeFn.includes('origin: "njhimss-events"'));
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
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
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
  assert.ok(page.includes("ItemPage-body"));
  assert.match(css, /\.ItemPage-body,[\s\S]*?max-width:\s*76ch/);
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
  assert.equal(canPublish({ kind: "event", status: "published", partner: "health-system" }), false);
  assert.equal(
    canPublish({
      kind: "event",
      status: "published",
      partner: "health-system",
      registrationUrl: "https://example.com/register",
    }),
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
  assert.ok(rss.includes("<description>Penn’s in-house scribe reached roughly 1,200 ambulatory users; a separate 46-clinician DAX Copilot study reported 20.4% less note time per appointment.</description>"));
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
  assert.ok(build.includes("const generatedAt = published"));
  assert.ok(!build.includes("generatedAt: new Date().toISOString()"));
  assert.ok(build.includes("hasCite"));
  const lastBuildDate = new Date(feed.generatedAt).valueOf();
  for (const match of rss.matchAll(/<item>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<pubDate>([^<]+)<\/pubDate>[\s\S]*?<\/item>/g)) {
    assert.ok(match[1].trim().length > 0, "RSS descriptions must never be empty");
    assert.ok(new Date(match[2]).valueOf() <= lastBuildDate, "RSS publication dates cannot be in the future");
  }
});

test("SEO hold: robots.txt is text, worker 404s unknown and /org/*, no org routes", () => {
  const robots = readFileSync(join(root, "public/robots.txt"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const publishedRoutes = readFileSync(join(root, "worker-published.js"), "utf8");
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  assert.ok(robots.includes("User-agent: *"));
  assert.ok(robots.includes("Allow: /"));
  assert.ok(robots.includes("Disallow: /lab"));
  assert.ok(!robots.includes("<"));
  assert.ok(worker.includes("status: 404"));
  assert.ok(worker.includes("text/html"));
  assert.ok(!worker.includes("text/plain"));
  assert.ok(!/new Response\("Not found"/.test(worker));
  assert.ok(worker.includes("x-robots-tag"));
  assert.ok(worker.includes("noindex"));
  assert.ok(worker.includes("/index.html"));
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
  const eventsPage = readFileSync(join(root, "src/ui/EventsPage.tsx"), "utf8");
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
  assert.ok(eventsPage.includes("upcomingEvents"));
  assert.ok(eventsPage.includes("EventCard"));
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
  assert.ok(mlh.body.includes("2,017 subscriptions"));
  assert.ok(!/not an audited filing/i.test(`${mlh.dek} ${mlh.body}`));
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
  assert.ok(honor.body.includes("$418,000 Epic Good Maintenance grant"));
  assert.ok(!/not a Temple filing|not a Temple operating metric|program dollar/i.test(`${honor.dek} ${honor.body}`));
  const voices = latestVoices(catalog, Number.MAX_SAFE_INTEGER);
  assert.ok(voices.some((i) => i.slug === "inspira-johnson-epic-day-6-2026-07-30"));
  assert.ok(voices.some((i) => i.slug === "mlh-cloud-analytics-2026-08-17"));
  assert.ok(voices.some((i) => i.slug === "temple-honor-roll-2026"));
  assert.ok(voices.every((i) => i.kind === "voice" && i.status === "published"));
  assert.ok(!voices.some((i) => i.slug === "cio-note-workforce-ai"));
  const news = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  assert.ok(!news.some((i) => i.slug === "temple-honor-roll-2026"));
  assert.ok(!news.some((i) => i.slug === "mlh-cloud-analytics-2026-08-17"));
  assert.ok(!news.some((i) => i.slug === "inspira-johnson-epic-day-6-2026-07-30"));
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
  assert.ok(worker.includes("runAutomation"));
  assert.ok(wrangler.includes("VALLEY_DESK_DB"));
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
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");

  assert.ok(!home.includes("desk.length"));
  assert.ok(!home.includes("<Desk"));
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
  assert.ok(router.includes("EventsPage"));
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
  assert.ok(mention.includes("OrgTick"));
  assert.ok(mention.includes("tabIndex={0}"));
  assert.ok(mention.includes("is-help"));
  assert.ok(mention.includes('aria-hidden="true"'));
  assert.ok(mention.includes("canInsert"));
  const facts = readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8");
  assert.ok(facts.includes("aria-controls"));
  assert.ok(facts.includes("aria-expanded"));
  assert.ok(!mention.includes("createPortal"));
  assert.ok(!mention.includes("placeOrgChip"));
  assert.ok(!mention.includes("OrgChip"));
  assert.ok(!mention.includes("document.body"));
  assert.ok(!mention.includes('position: "fixed"'));
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

  const acheEpa = catalog.find((i) => i.slug === "ache-eastern-pa-fall-symposium-2026-09-30");
  assert.notEqual(acheEpa?.status, "published");
  const builds = catalog.find((i) => i.slug === "builds-bio-philly-2026-09-15");
  assert.equal(builds?.status, "published");
  assert.ok(builds && builds.kind === "event" && builds.registrationUrl);

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
    "builds-bio-philly-2026-09-15",
    "ache-greater-philly-fall-symposium-2026-09-14",
    "hap-i-transfer-sepsis-webinar-2026-09-18",
    "hap-emergency-management-2026-09-16",
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

test("Sloan CIO paint news: Olenoski and Gordon stay as unpublished slugs; pay facts remain", () => {
  assert.ok(Status.options.includes("unpublished"));
  const olenoski = catalog.find((i) => i.slug === "mlh-olenoski-cio");
  const gordon = catalog.find((i) => i.slug === "virtua-gordon-cio");
  assert.ok(olenoski && gordon);
  const desk = briefingSinceYesterday5pmET(catalog, new Date("2026-08-23T23:00:00.000Z"));
  for (const item of [olenoski, gordon]) {
    assert.equal(item.kind, "news");
    assert.equal(item.status, "unpublished");
    assert.notEqual(item.status, "published");
    assert.notEqual(item.status, "review");
    assert.equal(item.featured, false);
    assert.equal(bySlug(catalog, item.slug), undefined);
    assert.ok(!latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((row) => row.slug === item.slug));
    assert.ok(!publishedNewsList(catalog).some((row) => row.slug === item.slug));
    assert.ok(!desk.some((row) => row.slug === item.slug));
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
  assert.equal(edu("person-dave-johnson").length, 0);
  assert.ok(!/Kevin/.test(JSON.stringify(byId["person-dave-johnson"])));
  assert.equal(edu("person-bimal-desai")[0]?.label, "MBI OHSU · MD WashU · internship/residency CHOP");
  assert.equal(edu("person-bimal-desai")[0]?.citation.url, "https://www.chop.edu/doctors/desai-bimal");
  assert.equal(
    edu("person-bimal-desai")[1]?.label,
    "Professor of Clinical Pediatrics · B.S. Biology Emory 1995 · M.D. WashU 2000 · M.B.I. OHSU 2008",
  );
  assert.equal(edu("person-bimal-desai")[1]?.citation.url, "https://www.med.upenn.edu/apps/faculty/index.php/g275/p17256");
  assert.ok(!/267-426-6552/.test(edu("person-bimal-desai")[1]?.detail ?? ""));
  assert.ok(!/@/.test(JSON.stringify(edu("person-bimal-desai"))));
  assert.ok(!/ORCA author/i.test(JSON.stringify(edu("person-bimal-desai"))));
  assert.equal(edu("person-robert-hartmann")[0]?.label, "MBA Northwestern · BA economics Vanderbilt");
  assert.deepEqual(
    edu("person-anahi-santiago").map((f) => f.label),
    ["EMBA", "MBA Drexel + BS ECE Drexel"],
  );
  assert.equal(edu("person-tom-bartiromo")[0]?.label, "Computer science education");
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

test("Sloan SIGN: Inspira Johnson day-6 voice; Honor Roll stays voice; pay facts stay", () => {
  const voice = catalog.find((i) => i.id === "voice-li-7483929651741081600");
  const honor = catalog.find((i) => i.slug === "temple-honor-roll-2026");
  assert.ok(voice && honor);
  assert.equal(voice.kind, "voice");
  assert.equal(voice.status, "published");
  assert.equal(voice.featured, false);
  assert.equal(voice.slug, "inspira-johnson-epic-day-6-2026-07-30");
  assert.equal(voice.publishedAt, "2026-07-30T16:00:00.000Z");
  assert.ok(!("clockAt" in voice));
  assert.deepEqual(voice.orgs, ["org-inspira"]);
  assert.equal(voice.region, "NJ");
  assert.equal(voice.authors[0]?.name, "David Johnson");
  assert.ok(!voice.authors.some((a) => /Valley Desk/i.test(a.name)));
  assert.equal(voice.kind === "voice" ? voice.person : "", "David Johnson");
  assert.equal(voice.kind === "voice" ? voice.role : "", "CIIO");
  assert.equal(voice.kind === "voice" ? voice.org : "", "Inspira Health");
  assert.equal(voice.kind === "voice" ? voice.platform : "", "linkedin");
  assert.equal(voice.source.kind, "editorial");
  assert.equal(voice.source.origin, "linkedin");
  assert.equal(
    voice.source.url,
    "https://www.linkedin.com/posts/tim-bowers-ms-cic-fapic-cphq-a4492311_more-tdr-today-but-the-highlight-so-far-was-activity-7483929651741081600-YO6Q",
  );
  assert.equal(voice.kind === "voice" ? voice.originalUrl : "", voice.source.url);
  assert.equal(
    voice.impactSentence,
    "Inspira was on day 6 of an Epic live when its CIIO said so in that comment.",
  );
  assert.equal(voice.body, voice.dek);
  assert.ok(/CIIO/.test(voice.body));
  assert.ok(!/\bCIO\b/.test(voice.body));
  assert.ok(!/Kevin/.test(`${voice.title} ${voice.body} ${voice.dek}`));
  assert.ok(!/not a go-live date|not a user count/.test(voice.body));
  assert.ok(!/clockAt/.test(voice.body));
  assert.ok(!/["“]/.test(voice.body));
  assert.equal(honor.kind, "voice");
  assert.equal(honor.status, "published");
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(itemJsonLd(voice), undefined);
  assert.notEqual(itemJsonLd(voice)?.["@type"], "NewsArticle");
  assert.ok(latestVoices(catalog, Number.MAX_SAFE_INTEGER).some((i) => i.slug === voice.slug));
  assert.ok(!latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds).some((i) => i.slug === voice.slug));
  assert.equal(canonicalPath(voice), "/voices/inspira-johnson-epic-day-6-2026-07-30");
  const byId = Object.fromEntries(entityRows.map((e) => [e.id, e]));
  assert.equal(byId["person-dave-johnson"]?.facts?.find((f) => f.kind === "salary")?.filerOrg, "Inspira Medical Centers, Inc.");
  assert.equal(entityRows.length, 92);
  assert.ok(!/Kevin/.test(JSON.stringify(byId["person-dave-johnson"])));
});

test("Reed Bloomberg: hover line names the org; rest print does not; no chip; NEWS rail cannot insert", () => {
  const byId = Object.fromEntries(entityRows.map((e) => [e.id, e]));
  const cc = citableFacts(byId["org-christianacare"]?.facts).at(0);
  assert.ok(cc);
  assert.equal(
    signedHoverLine("ChristianaCare", cc!),
    "ChristianaCare NPSR $3,140,501,000 · YE June 30, 2025 · PwC AFS",
  );
  assert.equal(signedPrintLine(cc!), "NPSR $3,140,501,000 · YE June 30, 2025 · PwC AFS");
  assert.ok(!/operating|3,289,202,000|Net patient service revenue/i.test(signedHoverLine("ChristianaCare", cc!)));
  assert.ok(!signedPrintLine(cc!).includes("ChristianaCare"));

  const jeffFacts = citableFacts(byId["org-jefferson"]?.facts);
  assert.ok(jeffFacts.some((f) => /operating/i.test(f.label)));
  const jeff = displayFacts(jeffFacts);
  assert.equal(jeff.length, 1);
  assert.equal(
    signedHoverLine("Jefferson", jeff[0]!),
    "Jefferson NPSR $11,054,287,000 · YE June 30, 2025 · TJU audited AFS",
  );
  assert.equal(signedPrintLine(jeff[0]!), "NPSR $11,054,287,000 · YE June 30, 2025 · TJU audited AFS");
  assert.ok(!/operating/i.test(signedHoverLine("Jefferson", jeff[0]!)));
  assert.ok(!/operating/i.test(signedPrintLine(jeff[0]!)));
  assert.ok(!signedPrintLine(jeff[0]!).startsWith("Jefferson "));

  const temple = citableFacts(byId["org-temple"]?.facts).at(0);
  assert.ok(temple);
  assert.ok(signedHoverLine("Temple", temple!).startsWith("Temple "));
  assert.ok(!signedPrintLine(temple!).startsWith("Temple "));

  const pay = citableFacts(byId["person-dave-johnson"]?.facts.filter((f) => f.kind === "salary")).at(0);
  assert.ok(pay);
  assert.ok(signedHoverLine("Dave Johnson", pay!).startsWith("Dave Johnson "));
  assert.ok(!signedPrintLine(pay!).includes("Dave Johnson"));

  const ccDek = "Oct. 3 is a training-gated cutover on ChristianaCare’s own update; Becker’s second-cites that date and does not price Epic.";
  const split = splitFirstSentence(ccDek);
  assert.equal(split.rest, "");
  assert.ok(split.first.startsWith("Oct. 3"));
  const two = splitFirstSentence("First sentence. Second sentence.");
  assert.equal(two.first, "First sentence.");
  assert.equal(two.rest.trim(), "Second sentence.");

  const mention = readFileSync(join(root, "src/ui/MentionText.tsx"), "utf8");
  const lead = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  const facts = readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8");
  const dek = readFileSync(join(root, "src/ui/DekInsert.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const tokens = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  assert.ok(!mention.includes("createPortal"));
  assert.ok(!mention.includes("OrgChip"));
  assert.ok(!mention.includes("placeOrgChip"));
  assert.ok(!css.includes("OrgChip"));
  assert.ok(mention.includes("OrgTick"));
  assert.ok(mention.includes("is-help"));
  assert.ok(mention.includes('aria-hidden="true"'));
  assert.ok(!rail.includes("role=\"button\""));
  assert.ok(!rail.includes("tabIndex"));
  assert.ok(lead.includes("LeadDekInsert"));
  assert.ok(lead.includes("LeadSignedLine"));
  assert.ok(lead.includes("splitFirstSentence"));
  assert.ok(dek.includes("Escape"));
  assert.ok(dek.includes("mousedown"));
  assert.ok(!rail.includes("LeadDekInsert"));
  assert.ok(!rail.includes("impactSentence"));
  assert.ok(itemPage.includes("ItemFacts"));
  assert.ok(!itemPage.includes("LeadDekInsert"));
  assert.ok(facts.includes("signedFactText"));
  assert.ok(facts.includes("displayFacts"));
  assert.ok(!facts.includes("hit.text"));
  assert.ok(!/operating/i.test(facts));
  assert.ok(tokens.includes("#54C0E8"));
  assert.ok(tokens.includes("--sky: #54C0E8"));
  const tickCss = css.slice(css.indexOf(".OrgTick,"), css.indexOf(".OrgTick.is-help"));
  assert.ok(tickCss.includes("width: 7px"));
  assert.ok(tickCss.includes("height: 2px"));
  assert.ok(tickCss.includes("margin-left: 4px"));
  assert.ok(tickCss.includes("var(--sky)"));
  assert.ok(!tickCss.includes("overflow: auto"));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
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
  assert.ok(!mention.includes("chipId"));
  assert.ok(!mention.includes("OrgChip"));
  const factsUi = readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8");
  assert.ok(factsUi.includes("signedFactText"));
  assert.ok(!/ChristianaCare/.test(factsUi));

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

test("Sloan SIGN Voices packet: published rows, Johnson off Mansue, chrome holds", () => {
  const signed = [
    {
      id: "voice-inspira-mansue-epic-2026-07-27",
      slug: "inspira-mansue-epic-2026-07-27",
      person: "Amy B. Mansue",
      orgId: "org-inspira",
      origin: "inspira",
      publishedAt: "2026-07-27T16:00:00.000Z",
      cite: "https://www.inspirahealthnetwork.org/news/press-release/inspira-health-launches-epic-advancing-care-experience-south-jersey-patients",
    },
    {
      id: "voice-mlh-jimenez-sju-hawks-2026-07-22",
      slug: "mlh-jimenez-sju-hawks-2026-07-22",
      person: "Ed Jimenez",
      orgId: "org-main-line",
      origin: "main-line-health",
      publishedAt: "2026-07-22T16:00:00.000Z",
      cite: "https://www.mainlinehealth.org/news/2026/07/22/saint-josephs-athletics-and-main-line-health-announce-new-affiliation",
    },
    {
      id: "voice-penn-mahoney-muller-endowments-2026-08-04",
      slug: "penn-mahoney-muller-endowments-2026-08-04",
      person: "Kevin B. Mahoney",
      orgId: "org-penn",
      origin: "penn-medicine",
      publishedAt: "2026-08-04T16:00:00.000Z",
      cite: "https://www.pennmedicine.org/news/preserving-a-legacy-to-endure-long-after-retirement",
    },
    {
      id: "voice-mlh-jimenez-us-amateur-2026-08-05",
      slug: "mlh-jimenez-us-amateur-2026-08-05",
      person: "Ed Jimenez",
      orgId: "org-main-line",
      origin: "main-line-health",
      publishedAt: "2026-08-05T16:00:00.000Z",
      cite: "https://www.mainlinehealth.org/news/2026/08/05/main-line-health-named-official-healthcare-provider-for-the-2026-us-amateur-championship",
    },
    {
      id: "voice-jefferson-cacchione-skmc-allentown-2026-07-13",
      slug: "jefferson-cacchione-skmc-allentown-2026-07-13",
      person: "Joseph G. Cacchione",
      orgId: "org-jefferson",
      origin: "jefferson",
      publishedAt: "2026-07-13T16:00:00.000Z",
      cite: "https://www.jefferson.edu/news/2026/07/thomas-jefferson-university-to-establish-regional-medical-college-campus-in-lehigh-valley.html",
    },
    {
      id: "voice-jefferson-cacchione-community-impact-2026-07-14",
      slug: "jefferson-cacchione-community-impact-2026-07-14",
      person: "Joseph G. Cacchione",
      orgId: "org-jefferson",
      origin: "jefferson",
      publishedAt: "2026-07-14T16:00:00.000Z",
      cite: "https://www.jeffersonhealth.org/about-us/news/2026/07/driven-to-improve-lives",
    },
    {
      id: "voice-jefferson-cacchione-de-med-school-2026-07-15",
      slug: "jefferson-cacchione-de-med-school-2026-07-15",
      person: "Joseph G. Cacchione",
      orgId: "org-jefferson",
      origin: "jefferson",
      publishedAt: "2026-07-15T16:00:00.000Z",
      cite: "https://www.jefferson.edu/news/2026/07/thomas-jefferson-university-and-consortium-partners-share-plans-for-delawares-first-medical-school.html",
    },
    {
      id: "voice-jefferson-cacchione-board-2026-07-30",
      slug: "jefferson-cacchione-board-2026-07-30",
      person: "Joseph G. Cacchione",
      orgId: "org-jefferson",
      origin: "jefferson",
      publishedAt: "2026-07-30T16:00:00.000Z",
      cite: "https://www.jefferson.edu/news/2026/07/jefferson-announces-new-appointments-to-its-board-of-trustees.html",
    },
    {
      id: "voice-jefferson-cacchione-lcs-link-2026-08-05",
      slug: "jefferson-cacchione-lcs-link-2026-08-05",
      person: "Joseph G. Cacchione",
      orgId: "org-jefferson",
      origin: "jefferson",
      publishedAt: "2026-08-05T16:00:00.000Z",
      cite: "https://giving.jefferson.edu/about/news/bristol-myers-squibb-foundation-lung-cancer-screening-grant.html",
    },
    {
      id: "voice-chop-bell-breaking-through-2026-08-14",
      slug: "chop-bell-breaking-through-2026-08-14",
      person: "Madeline Bell",
      orgId: "org-chop",
      origin: "chop",
      publishedAt: "2026-08-14T16:00:00.000Z",
      cite: "https://open.chop.edu/courses/chops-next-chapter/",
    },
    {
      id: "voice-virtua-pullin-here-for-good-2026-07-16",
      slug: "virtua-pullin-here-for-good-2026-07-16",
      person: "Dennis W. Pullin",
      orgId: "org-virtua",
      origin: "virtua",
      publishedAt: "2026-07-16T16:00:00.000Z",
      cite: "https://www.virtua.org/About/Here-for-Good-Podcast",
    },
    {
      id: "voice-li-7487503653004775426",
      slug: "virtua-pullin-lessons-in-leadership-2026-07-27",
      person: "Dennis Pullin",
      orgId: "org-virtua",
      origin: "linkedin",
      publishedAt: "2026-07-27T16:00:00.000Z",
      cite: "https://www.linkedin.com/posts/virtuahealth_president-and-ceo-dennis-pullin-spoke-with-activity-7487503653004775426-pcxl",
    },
    {
      id: "voice-li-7486154836821037056",
      slug: "temple-slovis-tuh-epic-apps-2026-07-23",
      person: "Benjamin Slovis",
      orgId: "org-temple",
      origin: "linkedin",
      publishedAt: "2026-07-23T16:00:00.000Z",
      cite: "https://www.linkedin.com/posts/benjaminslovis_come-join-our-epic-team-activity-7486154836821037056-1Qkc",
    },
    {
      id: "voice-li-7490482263512481792",
      slug: "inspira-mansue-neuro-icu-2026-08-04",
      person: "Amy B. Mansue",
      orgId: "org-inspira",
      origin: "linkedin",
      publishedAt: "2026-08-04T16:00:00.000Z",
      cite: "https://www.linkedin.com/posts/inspira-health_what-does-the-future-of-brain-and-stroke-activity-7490482263512481792-fVAN",
    },
  ];
  const slugs = signed.map((row) => row.slug);
  const voices = signed.map((row) => {
    const item = catalog.find((i) => i.id === row.id);
    assert.ok(item, row.id);
    return item!;
  });
  const johnson = catalog.find((i) => i.id === "voice-li-7483929651741081600");
  const mansue = catalog.find((i) => i.id === "voice-inspira-mansue-epic-2026-07-27");
  const honor = catalog.find((i) => i.slug === "temple-honor-roll-2026");
  const lcs = catalog.find((i) => i.slug === "jefferson-cacchione-lcs-link-2026-08-05");
  assert.ok(johnson && mansue && honor && lcs);

  assert.equal(johnson.slug, "inspira-johnson-epic-day-6-2026-07-30");
  assert.equal(johnson.kind, "voice");
  assert.equal(johnson.status, "published");
  assert.equal(johnson.featured, false);
  assert.equal(johnson.publishedAt, "2026-07-30T16:00:00.000Z");
  assert.deepEqual(johnson.orgs, ["org-inspira"]);
  assert.equal(johnson.authors[0]?.name, "David Johnson");
  assert.ok(!johnson.authors.some((a) => /Mansue/i.test(a.name)));
  assert.equal(johnson.kind === "voice" ? johnson.person : "", "David Johnson");
  assert.equal(
    johnson.impactSentence,
    "Inspira was on day 6 of an Epic live when its CIIO said so in that comment.",
  );
  assert.equal(
    johnson.source.url,
    "https://www.linkedin.com/posts/tim-bowers-ms-cic-fapic-cphq-a4492311_more-tdr-today-but-the-highlight-so-far-was-activity-7483929651741081600-YO6Q",
  );

  const mansuePerson = mansue.kind === "voice" ? mansue.person : "";
  assert.ok(!/Johnson/i.test(`${mansuePerson} ${mansue.authors.map((a) => a.name).join(" ")}`));
  assert.ok(!mansue.authors.some((a) => /Johnson/i.test(a.name)));
  assert.notEqual(mansuePerson, "David Johnson");
  assert.ok(/Inspira’s (estimate|claim)|Inspira estimates/i.test(`${mansue.dek} ${mansue.impactSentence}`));
  assert.ok(!/Holt|salary|revenue/i.test(`${mansue.dek} ${mansue.body} ${mansue.impactSentence}`));
  assert.ok(!/\b32\b|\b33\b/.test(`${lcs.title} ${lcs.dek} ${lcs.body} ${lcs.impactSentence}`));
  assert.ok(!JSON.stringify(mansue).includes("7490482263512481792"));
  assert.ok(!JSON.stringify(mansue).includes("inspira-mansue-neuro-icu-2026-08-04"));
  assert.ok(!JSON.stringify(johnson).includes("7490482263512481792"));

  const bell = catalog.find((i) => i.id === "voice-chop-bell-breaking-through-2026-08-14");
  const neuro = catalog.find((i) => i.id === "voice-li-7490482263512481792");
  assert.ok(bell && neuro);
  assert.equal(
    catalog.filter((i) => i.kind === "voice" && /bell/i.test(`${i.id} ${i.slug}`) && /2026-08-14/.test(i.publishedAt ?? "")).length,
    1,
  );
  assert.ok(!catalog.some((i) => i.id.includes("7494090470386696193")));
  assert.equal(bell.source.url, "https://open.chop.edu/courses/chops-next-chapter/");
  assert.deepEqual(
    bell.citations?.map((c) => c.url),
    [
      "https://open.chop.edu/courses/chops-next-chapter/",
      "https://www.linkedin.com/posts/the-childrens-hospital-of-philadelphia_chops-next-chapter-activity-7494090470386696193-XR-j",
    ],
  );
  assert.ok(/incoming CEO Joe Mitchell takes over Oct\.? 1/i.test(`${bell.dek} ${bell.body} ${bell.impactSentence}`));
  assert.ok(/October retirement|retirement later in October/.test(`${bell.dek} ${bell.body}`));
  assert.ok(!/not (the )?current CEO/.test(`${bell.dek} ${bell.body} ${bell.impactSentence}`));
  assert.ok(!neuro.authors.some((a) => /Johnson/i.test(a.name)));
  assert.notEqual(neuro.kind === "voice" ? neuro.person : "", "David Johnson");
  assert.ok(!JSON.stringify(neuro).includes("7483929651741081600"));
  assert.ok(!JSON.stringify(neuro).includes("inspira-mansue-epic-2026-07-27"));
  assert.ok(!JSON.stringify(neuro).includes("inspira-johnson-epic-day-6"));
  assert.equal(
    neuro.source.url,
    "https://www.linkedin.com/posts/inspira-health_what-does-the-future-of-brain-and-stroke-activity-7490482263512481792-fVAN",
  );
  assert.ok(!/brain-and-spine/.test(neuro.source.url ?? ""));
  assert.ok(
    !catalog.some((i) => {
      const person = i.kind === "voice" ? i.person : "";
      return (
        i.kind === "voice" &&
        /mansue/i.test(`${person} ${i.slug}`) &&
        /linkedin\.com\/(in|posts)\/(?!inspira-health)/i.test(i.source.url ?? "")
      );
    }),
  );
  assert.equal(
    catalog.filter((i) => {
      const person = i.kind === "voice" ? i.person : "";
      return i.kind === "voice" && /mansue/i.test(`${i.id} ${i.slug} ${person}`);
    }).length,
    2,
  );

  for (const [row, item] of signed.map((spec, i) => [spec, voices[i]] as const)) {
    assert.equal(item.kind, "voice");
    assert.equal(item.status, "published");
    assert.equal(item.featured, false);
    assert.ok(!("clockAt" in item));
    assert.equal(item.slug, row.slug);
    assert.equal(item.publishedAt, row.publishedAt);
    assert.deepEqual(item.orgs, [row.orgId]);
    assert.ok(seedIds.has(row.orgId));
    assert.ok(item.orgs.every((id) => seedIds.has(id)));
    assert.ok(!item.authors.some((a) => /Valley Desk/i.test(a.name)));
    assert.equal(item.authors[0]?.name, row.person);
    assert.equal(item.authors[0]?.org, row.orgId);
    assert.equal(item.source.kind, "editorial");
    assert.equal(item.source.origin, row.origin);
    assert.equal(item.source.url, row.cite);
    assert.equal(item.kind === "voice" ? item.person : "", row.person);
    assert.equal(item.kind === "voice" ? item.originalUrl : "", row.cite);
    assert.ok(item.impactSentence?.trim());
    assert.ok(!/\n/.test(item.impactSentence ?? ""));
    assert.equal(itemJsonLd(item), undefined);
    assert.notEqual(itemJsonLd(item)?.["@type"], "NewsArticle");
    assert.equal(canonicalPath(item), `/voices/${row.slug}`);
    assert.notEqual(canonicalPath(item), `/news/${row.slug}`);
    assert.equal(bySlug(catalog, row.slug)?.id, row.id);
  }

  const allVoices = latestVoices(catalog, Number.MAX_SAFE_INTEGER);
  const news = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  const newsPage = publishedNewsList(catalog);
  const rail = latestVoices(catalog);
  for (const slug of slugs) {
    assert.ok(allVoices.some((i) => i.slug === slug));
    assert.ok(!news.some((i) => i.slug === slug));
    assert.ok(!newsPage.some((i) => i.slug === slug));
  }
  assert.ok(allVoices.every((i) => i.kind === "voice" && i.status === "published"));
  assert.ok(rail.every((i) => i.kind === "voice"));
  assert.equal(honor.kind, "voice");
  assert.equal(honor.status, "published");
  assert.equal(honor.id, "voice-temple-honor-roll-2026");
  assert.equal(honor.kind === "voice" ? honor.role : "", "Temple Health CMIO");
  assert.equal(honor.publishedAt, "2026-08-08T16:00:00.000Z");
  assert.ok(!JSON.stringify(honor).includes("7486154836821037056"));
  assert.ok(!JSON.stringify(honor).includes("temple-slovis-tuh-epic-apps-2026-07-23"));
  const dragon = catalog.find((i) => i.slug === "temple-dragon-copilot-400");
  const slovisHire = catalog.find((i) => i.id === "voice-li-7486154836821037056");
  assert.ok(dragon && slovisHire);
  assert.equal(dragon.kind, "news");
  assert.equal(dragon.kind === "news" ? dragon.relatedVoiceIds.join() : "x", "");
  assert.ok(!JSON.stringify(dragon).includes("7486154836821037056"));
  assert.ok(!/honor.?roll|dragon-copilot-400|418,000/i.test(`${slovisHire.title} ${slovisHire.dek} ${slovisHire.body} ${slovisHire.impactSentence}`));
  assert.equal(slovisHire.kind === "voice" ? slovisHire.role : "", "Temple Health CMIO, Temple University Hospital");
  const impact = catalog.find((i) => i.id === "voice-jefferson-cacchione-community-impact-2026-07-14");
  const fyLoss = catalog.find((i) => i.slug === "jefferson-fy2026-operating-loss");
  assert.ok(impact && fyLoss);
  assert.equal(fyLoss.kind === "news" ? fyLoss.relatedVoiceIds.join() : "x", "");
  assert.ok(!JSON.stringify(fyLoss).includes("jefferson-cacchione-community-impact-2026-07-14"));
  assert.ok(!/181\.5|Inquirer|operating loss/i.test(`${impact.title} ${impact.dek} ${impact.body} ${impact.impactSentence}`));
  assert.ok(/more than \$2\.7 billion/.test(`${impact.dek} ${impact.body}`));
  assert.ok(/10 million patient visits/.test(`${impact.dek} ${impact.body}`));
  assert.ok(!hasDefensiveEditorialAside(`${impact.dek} ${impact.body} ${impact.impactSentence}`));
  assert.ok(!/["“]/.test(`${impact.dek} ${impact.body}`));
  assert.ok(!catalog.some((i) => /leaphart/i.test(`${i.id} ${i.slug} ${i.title}`)));
  assert.ok(!entityRows.some((e) => /leaphart/i.test(`${e.id} ${e.name}`)));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
  assert.equal(entityRows.length, 92);
  assert.ok(!entityRows.some((e) => /mansue|jimenez|mahoney|cacchione|madeline-bell|pullin/i.test(e.id)));
  assert.ok(!entityRows.some((e) => e.id.startsWith("person-") && /Mansue|Jimenez|Mahoney|Cacchione|Madeline Bell|Dennis/.test(e.name)));

  const blob = JSON.stringify(voices);
  assert.ok(!/Cooper \$100|\$100M/i.test(blob));
  assert.ok(!/Stern|LVB300/i.test(blob));
  assert.ok(!/ranking/i.test(blob));
  assert.ok(!/\bCIR\b/.test(blob));
  assert.ok(!/Venua/.test(blob));

  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  const workerPublished = readFileSync(join(root, "worker-published.js"), "utf8");
  const feed = JSON.parse(readFileSync(join(root, "public/feed.json"), "utf8")) as { items: { id: string; slug: string; kind: string }[] };
  const newsSlugBlock = workerPublished.slice(
    workerPublished.indexOf("export const publishedNewsSlugs"),
    workerPublished.indexOf("export const publishedEventSlugs"),
  );
  const voiceSlugBlock = workerPublished.slice(
    workerPublished.indexOf("export const publishedVoiceSlugs"),
    workerPublished.indexOf("export const publishedBriefingSlugs"),
  );
  for (const slug of slugs) {
    assert.ok(sitemap.includes(`<loc>https://thevalleydesk.org/voices/${slug}</loc>`), slug);
    assert.ok(!sitemap.includes(`<loc>https://thevalleydesk.org/news/${slug}</loc>`), slug);
    assert.ok(voiceSlugBlock.includes(`"${slug}"`), slug);
    assert.ok(!newsSlugBlock.includes(`"${slug}"`), slug);
    assert.ok(feed.items.some((row) => row.slug === slug && row.kind === "voice"));
  }
  assert.ok(voiceSlugBlock.includes('"inspira-johnson-epic-day-6-2026-07-30"'));
});

test("Reed walk: HTML 404 shell, list cards title-only, Register hole, PIN, rest underline", () => {
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const rail = readFileSync(join(root, "src/ui/home/Rail.tsx"), "utf8");
  const lead = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  const notFound = readFileSync(join(root, "src/ui/NotFound.tsx"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  const kindList = readFileSync(join(root, "src/ui/KindListPage.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const mention = readFileSync(join(root, "src/ui/MentionText.tsx"), "utf8");

  assert.ok(worker.includes('content-type": "text/html'));
  assert.ok(!worker.includes("text/plain"));
  assert.ok(!/new Response\("Not found"/.test(worker));
  assert.ok(worker.includes("x-robots-tag"));
  assert.ok(worker.includes("noindex"));
  assert.ok(worker.includes("no-store"));
  assert.ok(worker.includes("/index.html"));
  assert.ok(worker.includes("This page is not published."));
  assert.equal(notFound.match(/This page is not published\./g)?.length, 1);
  assert.ok(!/Not found/.test(notFound));
  const notFoundCss = css.slice(css.indexOf(".NotFound {"), css.indexOf(".SiteHeader-inner {"));
  assert.ok(notFoundCss.includes("padding: 32px 0"));
  assert.ok(!notFoundCss.includes("padding: 0 56"));
  assert.ok(itemPage.includes("<NotFound"));
  assert.ok(router.includes("defaultNotFoundComponent"));
  assert.ok(layout.includes("SiteHeader"));
  assert.ok(layout.includes("SiteNav"));
  assert.ok(layout.includes('to="/news"'));
  assert.ok(layout.includes('to="/events"'));
  assert.ok(layout.includes('to="/voices"'));
  assert.ok(layout.includes("SiteFooter"));
  assert.ok(!/path:\s*["']\/org\//.test(router));

  assert.ok(!rail.includes("Impact:"));
  assert.ok(!rail.includes("impactSentence"));
  assert.ok(!rail.includes("RailRow-impact"));
  assert.ok(lead.includes("Lead-impact"));
  assert.ok(!lead.includes("Impact:"));
  assert.ok(itemPage.includes("item.impactSentence"));
  assert.ok(!itemPage.includes("Impact:"));

  assert.ok(rail.includes("is-register"));
  assert.ok(rail.includes("eventRegisterUrl"));
  assert.ok(css.includes('.Rail[data-rail="events"] .RailRow.is-register'));
  assert.ok(css.includes("grid-template-columns: auto minmax(0, 1fr)"));
  assert.ok(css.includes("grid-template-columns: auto minmax(0, 1fr) auto"));
  const builds = catalog.find((i) => i.slug === "builds-bio-philly-2026-09-15");
  const acheEpa = catalog.find((i) => i.slug === "ache-eastern-pa-fall-symposium-2026-09-30");
  assert.ok(builds && builds.kind === "event" && builds.registrationUrl);
  assert.notEqual(acheEpa?.status, "published");

  assert.ok(rail.includes(">PIN<"));
  assert.ok(home.includes("pinId"));
  const eventsPage = readFileSync(join(root, "src/ui/EventsPage.tsx"), "utf8");
  assert.ok(eventsPage.includes("radar"));
  assert.ok(!/himss/i.test(rail));
  const pin = nextChapterEvent(catalog, new Date("2026-08-23T20:00:00.000Z"));
  assert.equal(pin?.slug, "njdvhimss-fall-conference-october-13th-15th");
  assert.ok(pin?.registrationUrl);

  const mentionCss = css.slice(css.indexOf(".OrgMention,"), css.indexOf(".OrgTick,"));
  assert.ok(mentionCss.includes(".OrgMention:hover"));
  assert.ok(mentionCss.includes(".OrgMention:focus"));
  assert.ok(mentionCss.includes(".OrgMention:focus-visible"));
  assert.ok(mentionCss.includes("text-decoration: none"));
  assert.ok(!mentionCss.includes("dotted"));
  assert.ok(!mentionCss.includes("underline"));
  assert.ok(!mention.includes("createPortal"));
  assert.ok(!mention.includes("OrgChip"));
  assert.ok(!mention.includes("placeOrgChip"));
  assert.ok(mention.includes("OrgTick"));
  assert.ok(!css.includes("OrgChip"));
  assert.ok(css.includes(".OrgTick"));
  const dekInsert = readFileSync(join(root, "src/ui/DekInsert.tsx"), "utf8");
  assert.ok(dekInsert.includes("Escape"));
  assert.ok(dekInsert.includes("mousedown"));
  assert.equal(leadItem(catalog)?.slug, "christianacare-epic-go-live");
  assert.equal(catalog.filter((i) => i.kind === "news" && i.featured).map((i) => i.slug).join(), "christianacare-epic-go-live");
});

test("product watch is local-use gated and visible as a curated news slice", () => {
  const rows = productWatch(catalog, 20);
  const slugs = rows.map((item) => item.slug);
  assert.ok(slugs.includes("christianacare-epic-go-live"));
  assert.ok(slugs.includes("jefferson-einstein-mychart-2026-09-26"));
  assert.ok(slugs.includes("temple-dragon-copilot-400"));
  assert.ok(slugs.includes("chop-orca-cds"));
  assert.ok(rows.every((item) => item.topics.includes("product-watch")));

  const temple = catalog.find((item) => item.slug === "temple-dragon-copilot-400");
  assert.ok(temple);
  const matches = matchingProductUses(temple);
  assert.deepEqual(matches.map((row) => row.id), ["microsoft-dragon-copilot-temple"]);

  const unrelated = news({
    id: "generic",
    slug: "generic",
    title: "Epic earnings rise",
    orgs: [],
    source: { kind: "ingest", origin: "Epic", url: "https://example.com/epic-earnings" },
  });
  assert.deepEqual(matchingProductUses(unrelated), []);
});

test("event calendar action preserves title, UTC interval, and place", () => {
  const event = catalog.find((item): item is EventItem => item.id === "evt-dvhimss-22958");
  assert.ok(event);
  const url = new URL(googleCalendarUrl(event));
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("text"), event.title);
  assert.equal(url.searchParams.get("dates"), "20261013T203000Z/20261015T153000Z");
  assert.match(url.searchParams.get("location") ?? "", /Hard Rock/i);
});

test("automation persistence contract is durable and review-first", async () => {
  const item = catalog.find((row) => row.slug === "temple-dragon-copilot-400");
  assert.ok(item);
  assert.equal(await candidateFingerprint(item), await candidateFingerprint(item));
  assert.notEqual(
    await candidateFingerprint(item),
    await candidateFingerprint({ ...item, body: `${item.body} changed` }),
  );
  const migration = readFileSync(join(root, "migrations/0001_automation.sql"), "utf8");
  const auditMigration = readFileSync(join(root, "migrations/0002_review_audit.sql"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const reviewApi = readFileSync(join(root, "src/ingest/review-api.ts"), "utf8");
  const automation = readFileSync(join(root, "src/ingest/automation.ts"), "utf8");
  assert.ok(migration.includes("CREATE TABLE ingest_runs"));
  assert.ok(migration.includes("CREATE TABLE content_candidates"));
  assert.ok(migration.includes("queue_status IN ('review', 'approved', 'rejected')"));
  assert.ok(worker.includes("runAutomation"));
  assert.ok(worker.includes("handleReviewApi"));
  assert.ok(worker.includes("ingest-scheduled-failed"));
  assert.ok(auditMigration.includes("CREATE TABLE candidate_decisions"));
  assert.ok(reviewApi.includes("candidate_decisions"));
  assert.ok(automation.indexOf("persistIngestRun") < automation.indexOf("enrichBounded("));
  assert.ok(readFileSync(join(root, "migrations/0006_editor_model_attempts.sql"), "utf8").includes("enrichment_attempted_at"));
});

test("automatic editor publishes only rule-confirmed material", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const officialEvent = EventItem.parse({
    ...base,
    id: "evt-auto",
    slug: "official-chapter-forum",
    title: "Official Chapter Forum",
    kind: "event",
    status: "review",
    startsAt: "2026-09-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://events.dvhimss.org/register",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/forum" },
  });
  const eventDecision = evaluateCandidate(officialEvent, null, now);
  assert.equal(eventDecision.action, "publish");
  assert.equal(eventDecision.rule, "official-chapter-event");
  assert.equal(eventDecision.content.publishedAt, now.toISOString());

  assert.throws(() => EventItem.parse({
    ...officialEvent,
    id: "evt-insecure",
    slug: "insecure",
    source: { ...officialEvent.source, url: "http://dvhimss.org/event/insecure" },
    registrationUrl: "javascript:alert(1)",
  }));
  const untrustedRegistration = EventItem.parse({
    ...officialEvent,
    id: "evt-untrusted-registration",
    slug: "untrusted-registration",
    registrationUrl: "https://attacker.invalid/register",
  });
  assert.notEqual(evaluateCandidate(untrustedRegistration, null, now).action, "publish");

  const cancelled = EventItem.parse({
    ...officialEvent,
    id: "evt-cancelled",
    slug: "cancelled",
    title: "Official Chapter Forum — Cancelled",
  });
  assert.equal(evaluateCandidate(cancelled, null, now).rule, "event-cancelled");

  const discovery = news({
    id: "news-discovery",
    slug: "discovery",
    title: "A material local change",
    status: "review",
    source: { kind: "ingest", origin: "Inquirer Health", url: "https://example.com/story" },
  });
  const evidence = EditorEnrichment.parse({
    relevanceScore: 99,
    confidence: 0.99,
    decision: "priority_review",
    reasons: ["Local deployment"],
    affectedOrgIds: ["org-penn"],
    productIds: [],
    changeType: "deployment",
    materialityDimensions: ["deployment"],
    impactSentence: "Penn made a material deployment change.",
    whyAttend: null,
    whoYoullMeet: [],
    evidenceSpans: ["A material local change"],
  });
  assert.equal(evaluateCandidate(discovery, evidence, now).rule, "primary-corroboration-required");
  const firstParty = {
    ...discovery,
    source: { ...discovery.source, origin: "penn-medicine-newsroom" },
  };
  assert.equal(evaluateCandidate(firstParty, evidence, now).action, "publish");
  assert.equal(evaluateCandidate(firstParty, { ...evidence, affectedOrgIds: [] }, now).rule, "affected-org-evidence-required");
  assert.equal(EDITOR_POLICY_VERSION, "tvd-auto-editor-v2");
});

test("automatic publication SQL executes atomically and deduplicates its audit", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const future = EventItem.parse({
    ...base,
    id: "evt-sql-publish",
    slug: "sql-publish",
    title: "Official SQL Publication Test",
    kind: "event",
    status: "review",
    startsAt: "2026-09-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://events.dvhimss.org/register",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/sql-test" },
  });
  const past = EventItem.parse({
    ...future,
    id: "evt-sql-reject",
    slug: "sql-reject",
    title: "Past SQL Rejection Test",
    startsAt: "2026-08-20T16:00:00.000Z",
  });
  database.prepare(`
    INSERT INTO ingest_runs (id, started_at, state, item_count)
    VALUES ('run-sql', ?, 'succeeded', 2)
  `).run(now.toISOString());
  const insert = database.prepare(`
    INSERT INTO content_candidates (
      id, fingerprint, kind, title, source_origin, source_url, item_status,
      queue_status, content_json, first_seen_at, last_seen_at, last_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'review', 'review', ?, ?, ?, 'run-sql')
  `);
  for (const item of [future, past]) {
    insert.run(
      item.id,
      `fingerprint-${item.id}`,
      item.kind,
      item.title,
      item.source.origin,
      item.source.url,
      JSON.stringify(item),
      now.toISOString(),
      now.toISOString(),
    );
  }
  const decisions = [future, past].map((item) => ({
    item,
    enrichment: null,
    decision: evaluateCandidate(item, null, now),
  }));
  const counts = await persistEditorialDecisions(
    db,
    decisions,
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  assert.deepEqual(counts, { published: 1, review: 1, rejected: 0, quarantined: 0 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(future.id).queue_status, "approved");
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(past.id).queue_status, "review");

  const later = new Date("2026-08-26T14:00:00.000Z");
  await persistEditorialDecisions(
    db,
    [{ item: future, enrichment: null, decision: evaluateCandidate(future, null, later) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    later,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM candidate_decisions WHERE candidate_id = ?").get(future.id).count,
    1,
  );
  const republished = database.prepare(
    "SELECT content_json, first_published_at FROM published_content WHERE candidate_id = ?",
  ).get(future.id);
  assert.equal(JSON.parse(String(republished.content_json)).publishedAt, now.toISOString());
  assert.equal(republished.first_published_at, now.toISOString());

  const refetched = EventItem.parse({
    ...future,
    title: "Raw source title changed",
    status: "review",
    publishedAt: undefined,
    updatedAt: "2026-08-26T13:00:00.000Z",
  });
  await persistIngestRun(
    db,
    {
      fetchedAt: "2026-08-26T13:00:00.000Z",
      rss: [],
      events: [refetched],
      social: [],
      notes: {
        rss: 0,
        events: 1,
        linkedin: { count: 0, skipped: "no-token" },
        x: { count: 0, skipped: "no-token" },
      },
    },
    [{ item: refetched, enrichment: null }],
  );
  const preserved = database.prepare(
    "SELECT item_status, queue_status, content_json FROM content_candidates WHERE id = ?",
  ).get(future.id);
  assert.equal(preserved.queue_status, "approved");
  assert.equal(preserved.item_status, "published");
  assert.equal(JSON.parse(String(preserved.content_json)).title, future.title);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  database.close();
});

test("event reconciliation withdraws only after two complete successful omissions", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const event = EventItem.parse({
    ...base,
    id: "evt-reconcile",
    slug: "reconcile-event",
    title: "Official Reconciliation Event",
    kind: "event",
    status: "review",
    startsAt: "2026-10-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://web.cvent.com/event/reconcile",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/reconcile" },
  });
  const remaining = EventItem.parse({
    ...event,
    id: "evt-still-listed",
    slug: "still-listed",
    title: "Still listed chapter event",
    source: { ...event.source, url: "https://dvhimss.org/event/still-listed", externalId: "still" },
  });
  const source = (
    checkedAt: string,
    state: "success" | "error",
    completeness: "complete" | "partial" | "empty-unverified",
    itemCount: number,
  ) => ({
    id: "dvhimss-events",
    origin: "dvhimss-events",
    type: "events" as const,
    state,
    checkedAt,
    itemCount,
    completeness,
    complete: completeness === "complete",
    url: "https://dvhimss.org/events-calendar",
    ...(state === "error" ? { error: "upstream timeout" } : {}),
  });
  const initialAt = "2026-08-26T12:00:00.000Z";
  const initialNote = source(initialAt, "success", "complete", 1);
  const initialRun = await persistIngestRun(db, {
    fetchedAt: initialAt,
    rss: [],
    events: [event],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [initialNote] },
  }, [{ item: event, enrichment: null }]);
  await persistSourceHealth(db, initialRun.runId, [initialNote]);
  await persistEditorialDecisions(
    db,
    [{ item: event, enrichment: null, decision: evaluateCandidate(event, null, new Date(initialAt)) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    new Date(initialAt),
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);

  async function snapshotRun(
    at: string,
    state: "success" | "error",
    completeness: "complete" | "partial" | "empty-unverified",
    events: EventItem[],
  ) {
    const note = source(at, state, completeness, events.length);
    const run = await persistIngestRun(db, {
      fetchedAt: at,
      rss: [],
      events,
      social: [],
      notes: { rss: 0, events: events.length, linkedin: { count: 0 }, x: { count: 0 }, sources: [note] },
    }, events.map((item) => ({ item, enrichment: null })));
    await persistSourceHealth(db, run.runId, [note]);
    return reconcileMissingPublishedEvents(db, run.runId, at, [note]);
  }

  assert.deepEqual(await snapshotRun("2026-08-26T13:00:00.000Z", "error", "partial", []), { missing: 0, withdrawn: 0 });
  assert.equal(database.prepare("SELECT missing_count FROM content_candidates WHERE id = ?").get(event.id).missing_count, 0);
  assert.deepEqual(await snapshotRun("2026-08-26T14:00:00.000Z", "success", "partial", []), { missing: 0, withdrawn: 0 });
  assert.deepEqual(await snapshotRun("2026-08-26T15:00:00.000Z", "success", "complete", [remaining]), { missing: 1, withdrawn: 0 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  assert.deepEqual(await snapshotRun("2026-08-26T16:00:00.000Z", "success", "complete", [remaining]), { missing: 1, withdrawn: 1 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 0);
  const withdrawn = database.prepare(
    "SELECT queue_status, item_status, missing_count FROM content_candidates WHERE id = ?",
  ).get(event.id);
  assert.deepEqual({ ...withdrawn }, { queue_status: "review", item_status: "unpublished", missing_count: 2 });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM publication_reconciliations WHERE action = 'withdrawn'").get().count,
    1,
  );
  assert.deepEqual(await readPublicationTombstones(db), [event.id]);
  database.close();
});

test("empty snapshots and parser-shape changes do not authorize disappearance", async () => {
  const empty = await ingestEventsWithHealth(new Date("2026-08-26T12:00:00.000Z"), async (input) => {
    const url = String(input);
    if (url.includes("wp-json/tribe")) {
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }
    return new Response(`
      <html>
        <head><title>NJDVHIMSS</title>
        <link rel="canonical" href="https://njdvhimssevent.com/" />
        </head>
        <body>Season recap</body>
      </html>
    `, { status: 200 });
  });
  const dvhimss = empty.sources.find((source) => source.id === "dvhimss-events");
  const nj = empty.sources.find((source) => source.id === "njhimss-events");
  assert.equal(dvhimss?.completeness, "empty-unverified");
  assert.equal(nj?.completeness, "empty-unverified");
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
  assert.equal(sourceAuthorizesDisappearance(nj!), false);

  const malformed = await ingestEventsWithHealth(new Date("2026-08-26T12:00:00.000Z"), async (input) => {
    if (String(input).includes("wp-json/tribe")) {
      return new Response(JSON.stringify({ events: [{ id: 99, website: "https://web.cvent.com/event/x" }] }), { status: 200 });
    }
    return new Response("<html><title>Temporary holding page</title></html>", { status: 200 });
  });
  const shape = malformed.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(shape?.itemCount, 0);
  assert.equal(shape?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(shape!), false);
});

test("catastrophic count drops do not withdraw published events", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const events = Array.from({ length: 6 }, (_, index) => EventItem.parse({
    ...base,
    id: `evt-drop-${index}`,
    slug: `drop-${index}`,
    title: `Official drop ${index}`,
    kind: "event",
    status: "review",
    startsAt: "2026-10-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: `https://web.cvent.com/event/drop-${index}`,
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: `https://dvhimss.org/event/drop-${index}` },
  }));
  const note = (checkedAt: string, itemCount: number, completeness: "complete" | "partial" | "empty-unverified" = "complete") => ({
    id: "dvhimss-events",
    origin: "dvhimss-events",
    type: "events" as const,
    state: "success" as const,
    checkedAt,
    itemCount,
    completeness,
    complete: completeness === "complete",
    url: "https://dvhimss.org/events-calendar",
  });
  const initialAt = now.toISOString();
  const initial = await persistIngestRun(db, {
    fetchedAt: initialAt,
    rss: [],
    events,
    social: [],
    notes: { rss: 0, events: events.length, linkedin: { count: 0 }, x: { count: 0 }, sources: [note(initialAt, events.length)] },
  }, events.map((item) => ({ item, enrichment: null })));
  await persistSourceHealth(db, initial.runId, [note(initialAt, events.length)]);
  await persistEditorialDecisions(
    db,
    events.map((item) => ({ item, enrichment: null, decision: evaluateCandidate(item, null, now) })),
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 6);

  const later = "2026-08-26T16:00:00.000Z";
  const survivor = events[0];
  const dropNote = note(later, 1);
  const dropRun = await persistIngestRun(db, {
    fetchedAt: later,
    rss: [],
    events: [survivor],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [dropNote] },
  }, [{ item: survivor, enrichment: null }]);
  await persistSourceHealth(db, dropRun.runId, [dropNote]);
  assert.deepEqual(await reconcileMissingPublishedEvents(db, dropRun.runId, later, [dropNote]), { missing: 0, withdrawn: 0 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 6);
  assert.equal(database.prepare("SELECT missing_count FROM content_candidates WHERE id = ?").get(events[1].id).missing_count, 0);

  const emptyAt = "2026-08-26T17:00:00.000Z";
  const emptyNote = note(emptyAt, 0, "empty-unverified");
  const emptyRun = await persistIngestRun(db, {
    fetchedAt: emptyAt,
    rss: [],
    events: [],
    social: [],
    notes: { rss: 0, events: 0, linkedin: { count: 0 }, x: { count: 0 }, sources: [emptyNote] },
  }, []);
  await persistSourceHealth(db, emptyRun.runId, [emptyNote]);
  assert.deepEqual(await reconcileMissingPublishedEvents(db, emptyRun.runId, emptyAt, [emptyNote]), { missing: 0, withdrawn: 0 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 6);
  database.close();
});

test("bundled ingest events are withdrawable via tombstones from a clean D1", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const bundled = catalog.find((item): item is EventItem => item.id === "evt-dvhimss-22958");
  assert.ok(bundled);
  assert.equal(bundled.source.kind, "ingest");
  const remaining = EventItem.parse({
    ...base,
    id: "evt-other-chapter",
    slug: "other-chapter",
    title: "Other chapter event",
    kind: "event",
    status: "review",
    startsAt: "2026-11-01T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://web.cvent.com/event/other",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/other" },
  });
  const known = [{ id: bundled.id, origin: bundled.source.origin, title: bundled.title, content: bundled }];
  const note = (checkedAt: string) => ({
    id: "dvhimss-events",
    origin: "dvhimss-events",
    type: "events" as const,
    state: "success" as const,
    checkedAt,
    itemCount: 1,
    completeness: "complete" as const,
    complete: true,
    url: "https://dvhimss.org/events-calendar",
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 0);
  assert.equal(mergePublishedContent([bundled], [], []).some((item) => item.id === bundled.id), true);

  const firstAt = "2026-08-26T15:00:00.000Z";
  const first = await persistIngestRun(db, {
    fetchedAt: firstAt,
    rss: [],
    events: [remaining],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [note(firstAt)] },
  }, [{ item: remaining, enrichment: null }]);
  await persistSourceHealth(db, first.runId, [note(firstAt)]);
  assert.deepEqual(
    await reconcileMissingPublishedEvents(db, first.runId, firstAt, [note(firstAt)], 2, known),
    { missing: 1, withdrawn: 0 },
  );
  assert.deepEqual(await readPublicationTombstones(db), []);

  const secondAt = "2026-08-26T16:00:00.000Z";
  const second = await persistIngestRun(db, {
    fetchedAt: secondAt,
    rss: [],
    events: [remaining],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [note(secondAt)] },
  }, [{ item: remaining, enrichment: null }]);
  await persistSourceHealth(db, second.runId, [note(secondAt)]);
  assert.deepEqual(
    await reconcileMissingPublishedEvents(db, second.runId, secondAt, [note(secondAt)], 2, known),
    { missing: 1, withdrawn: 1 },
  );
  const tombstones = await readPublicationTombstones(db);
  assert.deepEqual(tombstones, [bundled.id]);
  assert.deepEqual(mergePublishedContent([bundled], [], tombstones), []);
  assert.equal(mergePublishedContent([bundled], [], tombstones).length, 0);
  const editorial = news({ id: "editorial-keep", slug: "protected-keep", title: "Protected keep" });
  assert.equal(mergePublishedContent([editorial], [], tombstones)[0]?.id, editorial.id);
  database.close();
});

test("cancellation keeps a live permalink and expiry does not unpublish", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const event = EventItem.parse({
    ...base,
    id: "evt-live-cancel",
    slug: "live-cancel",
    title: "Official live cancel",
    kind: "event",
    status: "review",
    startsAt: "2026-10-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://web.cvent.com/event/live-cancel",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/live-cancel" },
  });
  await persistIngestRun(db, {
    fetchedAt: now.toISOString(),
    rss: [],
    events: [event],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [] },
  }, [{ item: event, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{ item: event, enrichment: null, decision: evaluateCandidate(event, null, now) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);

  const cancelled = EventItem.parse({
    ...event,
    title: "Official live cancel — Cancelled",
    body: "This session has been canceled.",
  });
  const cancelledDecision = evaluateCandidate(cancelled, null, now);
  assert.equal(cancelledDecision.rule, "event-cancelled");
  await persistEditorialDecisions(
    db,
    [{ item: cancelled, enrichment: null, decision: cancelledDecision }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    new Date("2026-08-26T13:00:00.000Z"),
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  const live = JSON.parse(String(database.prepare("SELECT content_json FROM published_content WHERE candidate_id = ?").get(event.id).content_json));
  assert.equal(live.status, "published");
  assert.equal(live.cancelled, true);
  assert.equal(live.slug, event.slug);
  assert.equal(bySlug([EventItem.parse(live)], event.slug)?.id, event.id);
  assert.equal(eventLifecycle(EventItem.parse(live), now), "cancelled");
  assert.deepEqual(upcomingEvents([EventItem.parse(live)], now, 10), []);
  assert.deepEqual(await readPublicationTombstones(db), []);

  const later = new Date("2026-10-21T16:00:00.000Z");
  const expiredDecision = evaluateCandidate(event, null, later);
  assert.equal(expiredDecision.rule, "event-not-future");
  assert.equal(expiredDecision.action, "review");
  await persistEditorialDecisions(
    db,
    [{ item: event, enrichment: null, decision: expiredDecision }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    later,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(event.id).queue_status, "approved");
  database.close();
});

test("authenticated rejection unpublishes a live candidate and creates a tombstone", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const event = EventItem.parse({
    ...base,
    id: "evt-human-withdraw",
    slug: "human-withdraw",
    title: "Human withdrawal test",
    kind: "event",
    status: "review",
    startsAt: "2026-10-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://web.cvent.com/event/human-withdraw",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/human-withdraw" },
  });
  await persistIngestRun(db, {
    fetchedAt: now.toISOString(),
    rss: [],
    events: [event],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 }, sources: [] },
  }, [{ item: event, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{ item: event, enrichment: null, decision: evaluateCandidate(event, null, now) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);

  const response = await handleReviewApi(new Request(
    `https://thevalleydesk.org/api/review-queue/${event.id}/decision`,
    {
      method: "POST",
      headers: { authorization: "Bearer test-review-token", "content-type": "application/json" },
      body: JSON.stringify({ decision: "rejected", note: "Confirmed withdrawal" }),
    },
  ), { VALLEY_DESK_DB: db, REVIEW_API_TOKEN: "test-review-token" });
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 0);
  assert.deepEqual(
    { ...database.prepare("SELECT queue_status, item_status FROM content_candidates WHERE id = ?").get(event.id) },
    { queue_status: "rejected", item_status: "unpublished" },
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM publication_reconciliations WHERE candidate_id = ? AND action = 'withdrawn'").get(event.id).count,
    1,
  );
  assert.deepEqual(await readPublicationTombstones(db), [event.id]);
  database.close();
});

test("Muse editor client is provider-configurable and evidence-bound", async () => {
  const item = news({
    id: "model-item",
    slug: "model-item",
    title: "Penn deployment evidence",
    status: "review",
    source: { kind: "ingest", origin: "penn-medicine-newsroom", url: "https://example.com/penn" },
  });
  const payload = {
    relevanceScore: 98,
    confidence: 0.98,
    decision: "priority_review",
    reasons: ["Evidence"],
    affectedOrgIds: ["org-penn"],
    productIds: [],
    changeType: "deployment",
    materialityDimensions: ["deployment"],
    impactSentence: "Penn deployment evidence is material.",
    whyAttend: null,
    whoYoullMeet: [],
    evidenceSpans: [item.title],
  };
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("http-referer"), "https://thevalleydesk.org");
    assert.equal(new Headers(init?.headers).get("x-title"), "The Valley Desk editor-in-chief");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, DEFAULT_EDITOR_MODEL);
    assert.equal(request.response_format.type, "json_object");
    assert.equal(request.max_tokens, EDITOR_OUTPUT_MAX_TOKENS);
    assert.equal(request.reasoning.max_tokens, EDITOR_REASONING_MAX_TOKENS);
    assert.equal(request.reasoning.exclude, true);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
  };
  const result = await enrichWithEditorModel(item, [], { apiKey: "test" }, mockFetch as typeof fetch);
  assert.equal(result?.confidence, 0.98);
});

test("editor context is bounded to cited prior coverage and defensive filler is rejected", async () => {
  const jefferson = catalog.find((item) => item.id === "news-jefferson-einstein-mychart-2026-09-26");
  assert.ok(jefferson?.contextSentence?.includes("completed their merger in October 2021"));
  assert.ok(jefferson.citations?.some((citation) => citation.url.includes("einstein-healthcare-network-has-joined-jefferson-health")));

  const candidate = news({
    id: "jefferson-context-candidate",
    slug: "jefferson-context-candidate",
    title: "Jefferson deployment update",
    dek: "Jefferson deployment update reached its next phase.",
    body: "Jefferson deployment update reached its next phase.",
    orgs: ["org-jefferson"],
    status: "review",
    source: { kind: "ingest", origin: "jefferson-newsroom", url: "https://example.com/new-jefferson-source" },
  });
  const context = editorContextForItem(candidate, catalog);
  assert.ok(context.length > 0 && context.length <= 4);
  assert.ok(context.every((row) => row.sourceUrl.startsWith("https://")));
  assert.ok(context.every((row) => catalog.some((item) => item.id === row.id && item.status === "published")));

  for (const item of catalog.filter((row) => row.status === "published")) {
    for (const value of [item.title, item.dek, item.body, item.impactSentence, item.contextSentence]) {
      assert.equal(hasDefensiveEditorialAside(value), false, `${item.id}: ${value}`);
    }
  }
  assert.equal(hasDefensiveEditorialAside("Epic’s label, not a Temple filing."), true);
  assert.equal(hasDefensiveEditorialAside("The $418,000 is not a Temple operating metric."), true);
  assert.equal(publicEntityRole("CMIO, Temple University Hospital only — not enterprise CMIO"), "CMIO, Temple University Hospital");

  const unsupported = {
    relevanceScore: 98,
    confidence: 0.98,
    decision: "priority_review",
    reasons: ["Evidence"],
    affectedOrgIds: ["org-jefferson"],
    productIds: [],
    changeType: "deployment",
    materialityDimensions: ["deployment"],
    impactSentence: "This is not a Jefferson operating metric.",
    contextSentence: null,
    contextItemIds: [],
    contextEvidenceSpans: [],
    whyAttend: null,
    whoYoullMeet: [],
    evidenceSpans: [candidate.title],
  };
  await assert.rejects(
    enrichWithEditorModel(candidate, [], { apiKey: "test" }, async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(unsupported) } }],
    }))),
    (error: unknown) => error instanceof EditorModelError && error.code === "validation",
  );
});

test("dynamic publication overlay updates matching ingest rows but cannot shadow editorial rows", () => {
  const staticEvent = EventItem.parse({
    ...base,
    id: "evt-overlay",
    slug: "overlay-event",
    title: "Old title",
    kind: "event",
    status: "published",
    startsAt: "2026-10-01T12:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://example.com/register",
    partner: "dvhimss",
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://example.com/event" },
  });
  const updated = EventItem.parse({ ...staticEvent, title: "Corrected title", updatedAt: "2026-08-26T13:00:00.000Z" });
  assert.equal(mergePublishedContent([staticEvent], [updated])[0]?.title, "Corrected title");
  const correctedSlug = EventItem.parse({
    ...updated,
    slug: "corrected-overlay-event",
    title: "Corrected slug and title",
  });
  const retained = mergePublishedContent([staticEvent], [correctedSlug])[0];
  assert.equal(retained?.id, staticEvent.id);
  assert.equal(retained?.slug, "overlay-event");
  assert.deepEqual(retained && "previousSlugs" in retained ? retained.previousSlugs : [], ["corrected-overlay-event"]);
  assert.equal(retained?.title, "Corrected slug and title");

  const occupiedRoute = EventItem.parse({
    ...staticEvent,
    id: "evt-route-owner",
    slug: "corrected-overlay-event",
    title: "Existing route owner",
  });
  const collision = mergePublishedContent([staticEvent, occupiedRoute], [correctedSlug]);
  assert.equal(collision.find((item) => item.id === staticEvent.id)?.slug, staticEvent.slug);
  assert.equal(collision.find((item) => item.id === occupiedRoute.id)?.title, occupiedRoute.title);

  const sameUrlDifferentId = EventItem.parse({
    ...staticEvent,
    id: "evt-url-duplicate",
    slug: "url-duplicate",
    title: "Same source URL from a later ingest id",
    startsAt: "2026-12-01T12:00:00.000Z",
    partner: "other",
  });
  const collapsedUrl = mergePublishedContent([staticEvent], [sameUrlDifferentId]);
  assert.equal(collapsedUrl.length, 1);
  assert.equal(collapsedUrl[0]?.id, staticEvent.id);
  assert.equal(collapsedUrl[0]?.slug, staticEvent.slug);
  assert.deepEqual(collapsedUrl[0] && "previousSlugs" in collapsedUrl[0] ? collapsedUrl[0].previousSlugs : [], ["url-duplicate"]);

  const sameScheduleDifferentId = EventItem.parse({
    ...staticEvent,
    id: "evt-dynamic-duplicate",
    slug: "dynamic-duplicate",
    title: "Same confirmed event from the live overlay",
  });
  const deduplicated = mergePublishedContent([staticEvent], [sameScheduleDifferentId]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0]?.id, staticEvent.id);
  assert.equal(deduplicated[0]?.slug, staticEvent.slug);
  assert.deepEqual(deduplicated[0] && "previousSlugs" in deduplicated[0] ? deduplicated[0].previousSlugs : [], ["dynamic-duplicate"]);

  const staleProcessCopy = EventItem.parse({
    ...sameScheduleDifferentId,
    body: "Best-effort scrape of the conference page.",
    whyAttend: "Ingested from the official REST feed.",
  });
  const sanitized = mergePublishedContent([staticEvent], [staleProcessCopy]);
  assert.equal(sanitized[0]?.body, staticEvent.body);
  assert.equal(sanitized[0]?.kind === "event" ? sanitized[0].whyAttend : undefined, staticEvent.whyAttend);
  assert.ok(!hasInternalProcessLanguage(JSON.stringify(sanitized[0])));

  const orphanedStaleCopy = EventItem.parse({
    ...staleProcessCopy,
    id: "evt-orphaned-process-copy",
    slug: "orphaned-process-copy",
    startsAt: "2026-11-01T12:00:00.000Z",
    partner: "other",
  });
  assert.equal(mergePublishedContent([], [orphanedStaleCopy]).length, 0);

  const editorial = news({ id: "editorial", slug: "protected", title: "Protected" });
  const hostile = news({
    id: "hostile",
    slug: "protected",
    title: "Shadow",
    source: { kind: "ingest", origin: "unknown", url: "https://example.com/shadow" },
  });
  assert.equal(mergePublishedContent([editorial], [hostile])[0]?.title, "Protected");
  assert.deepEqual(mergePublishedContent([staticEvent], [], [staticEvent.id]), []);
  assert.equal(mergePublishedContent([editorial], [], [editorial.id]).length, 1);
  const script = runtimeItemsScript(
    [{ ...updated, title: "</script><script>alert(1)</script>" }],
    ["</script><script>alert(2)</script>"],
  );
  assert.ok(!script.includes("</script><script>alert"));
  assert.ok(script.includes("\\u003c/script\\u003e"));
  assert.ok(script.includes("__VALLEY_DESK_WITHDRAWN_IDS__"));
  const workerSource = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(workerSource.includes("mergePublishedContent(seed.items, overlay.items, overlay.withdrawnIds)"));
  assert.ok(workerSource.includes("runtimeItemsScript(published, overlay.withdrawnIds)"));
});

test("one-worker configuration has Muse defaults, one D1 binding, and no staging environment", () => {
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(wrangler.includes('"EDITOR_MODEL": "meta/muse-spark-1.2-contributor"'));
  assert.ok(!wrangler.includes("standard Muse"));
  assert.ok(wrangler.includes("https://openrouter.ai/api/v1"));
  assert.ok(wrangler.includes('"EDITOR_MODEL_BUDGET": "4"'));
  assert.ok(wrangler.includes('"EDITOR_MODEL_CONCURRENCY": "2"'));
  assert.ok(wrangler.includes('"EDITOR_MODEL_TIMEOUT_MS": "25000"'));
  assert.ok(wrangler.includes('"EDITOR_MODEL_DEADLINE_MS": "40000"'));
  assert.ok(wrangler.includes('"database_name": "the-valley-desk"'));
  assert.ok(!wrangler.includes('"staging"'));
  assert.equal(pkg.scripts.deploy, "npm run build && wrangler deploy");
});

test("lab prototypes bind live catalog, the real mark asset, and unpublished-safe routes", () => {
  const router = readFileSync(join(root, "src/router.tsx"), "utf8");
  const mark = readFileSync(join(root, "public/mark-a-fold.svg"), "utf8");
  const labMark = readFileSync(join(root, "src/ui/lab/LabMark.tsx"), "utf8");
  const css = readFileSync(join(root, "src/ui/lab/lab.css"), "utf8");
  const chrono = readFileSync(join(root, "src/ui/lab/LabChronoPage.tsx"), "utf8");
  const systems = readFileSync(join(root, "src/ui/lab/LabSystemsPage.tsx"), "utf8");
  const horizon = readFileSync(join(root, "src/ui/lab/LabHorizonPage.tsx"), "utf8");
  const calendar = readFileSync(join(root, "src/ui/lab/LabCalendarPage.tsx"), "utf8");
  const shell = readFileSync(join(root, "src/ui/lab/LabShell.tsx"), "utf8");
  const index = readFileSync(join(root, "src/ui/lab/LabIndexPage.tsx"), "utf8");
  const filters = readFileSync(join(root, "src/ui/lab/LabFilters.tsx"), "utf8");
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");

  assert.ok(router.includes('path: "/lab"'));
  assert.ok(router.includes('path: "/lab/briefing"'));
  assert.ok(router.includes('path: "/lab/systems"'));
  assert.ok(router.includes('path: "/lab/horizon"'));
  assert.ok(router.includes('path: "/lab/calendar"'));
  assert.ok(router.includes("LabChronoPage"));
  assert.ok(router.includes("LabSystemsPage"));
  assert.ok(router.includes("LabHorizonPage"));
  assert.ok(router.includes("LabCalendarPage"));
  assert.ok(!router.includes("BriefingPage"));
  assert.ok(!router.includes('"/briefing"'));
  assert.ok(!/path:\s*["']\/org\//.test(router));
  assert.ok(!systems.includes('to="/org'));
  assert.ok(layout.includes('to="/news"'));
  assert.ok(layout.includes('to="/events"'));
  assert.ok(layout.includes('to="/voices"'));
  assert.ok(!layout.includes('to="/lab"'));
  assert.ok(layout.includes('pathname.startsWith("/lab/")'));

  assert.ok(mark.includes('points="6,10 34,10 26,54 4,54"'));
  assert.ok(mark.includes('points="30,10 58,10 60,54 32,54"'));
  assert.ok(mark.includes('points="30,10 36,10 32,54 26,54"'));
  assert.ok(labMark.includes('src="/mark-a-fold.svg"'));
  assert.ok(!labMark.includes("<svg"));
  assert.ok(!labMark.includes("<polygon"));
  assert.ok(!labMark.includes("<path"));

  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.includes("@media (max-width: 320px)"));
  assert.ok(css.includes("@media (max-width: 390px)"));
  assert.ok(css.includes("@media (max-width: 720px)"));
  assert.ok(css.includes("min-height: 44px"));
  assert.ok(css.includes("outline: 2px solid var(--ink)"));

  for (const src of [chrono, systems, horizon, calendar, index]) {
    assert.ok(src.includes('from "../../lib/catalog"'));
    assert.ok(!src.includes("Virtua Advanced Access"));
    assert.ok(!src.includes("17:06"));
  }
  assert.ok(chrono.includes("filterBriefing(windowItems"));
  assert.ok(chrono.includes("briefingSinceYesterday5pmET"));
  assert.ok(systems.includes("systemCards(catalog, entities)"));
  assert.ok(horizon.includes("horizonPoints(catalog)"));
  assert.ok(calendar.includes("horizonPoints(catalog)"));
  assert.ok(calendar.includes("monthCells"));
  assert.ok(filters.includes('role="radiogroup"'));
  assert.ok(filters.includes("ArrowRight"));
  assert.ok(horizon.includes("ArrowRight"));
  assert.ok(horizon.includes('aria-orientation="horizontal"'));
  assert.ok(horizon.includes("tabIndex={on ? 0 : -1}"));
  assert.ok(horizon.includes("LabAxisCue"));
  assert.ok(horizon.includes("Off-edge ticks include monitored cutovers beyond 30 days"));
  assert.ok(horizon.includes('key={selected.id}'));
  assert.ok(css.includes(".LabAxisCue"));
  assert.ok(css.includes("overscroll-behavior-x: contain"));
  assert.ok(css.includes(".LabTick.is-on .LabTick-dot"));
  assert.ok(css.includes(".LabCal-day.is-on .LabCal-num"));
  assert.ok(css.includes(".LabDetail {\n  animation: lab-row-in"));
  assert.ok(css.includes(".LabDetail {\n    animation: none"));
  assert.ok(calendar.includes("PageDown"));
  assert.ok(calendar.includes("LabCalNext"));
  assert.ok(calendar.includes("cellRefs.current[selectedKey]?.focus()"));
  assert.ok(calendar.includes("tabIndex={on ? 0 : -1}"));
  assert.ok(calendar.includes("dayPoints.length > 1"));
  assert.ok(calendar.includes("{selectedDayLabel}"));
  assert.ok(calendar.includes("key={selectedPoint.id}"));
  assert.ok(systems.includes("aria-controls"));
  assert.ok(systems.includes("item.id !== card.latest?.id"));
  assert.ok(shell.includes('aria-label="Prototype views"'));
  assert.ok(worker.includes("SPA_PATH"));
  assert.ok(worker.includes('path.startsWith("/lab")'));
  assert.ok(worker.includes('content="noindex, nofollow"'));
});

test("lab helpers use structured catalog dates and seed systems only", async () => {
  const { chronologicalDesk, filterBriefing, horizonPoints, horizonWindow, monthCells, systemCards, filterSystems, etYmd, pointsOnDay, nextBriefingAt } = await import("../src/ui/lab/lab.ts");
  const now = new Date("2026-08-26T15:00:00.000Z");
  const desk = chronologicalDesk(catalog);
  assert.ok(desk.length > 0);
  assert.ok(desk.every((item) => item.status === "published"));
  for (let i = 1; i < desk.length; i++) {
    const a = desk[i - 1].publishedAt ?? desk[i - 1].updatedAt;
    const b = desk[i].publishedAt ?? desk[i].updatedAt;
    assert.ok(a >= b);
  }
  const clocks = filterBriefing(catalog, "clock");
  assert.ok(clocks.some((item) => item.id === "news-christianacare-epic"));
  assert.ok(clocks.some((item) => item.id === "news-jefferson-einstein-mychart-2026-09-26" || item.slug === "jefferson-einstein-mychart-2026-09-26"));
  assert.ok(!clocks.some((item) => item.slug === "temple-chestnut-hill-jhp-2026-09-30"));

  const points = horizonPoints(catalog);
  assert.ok(points.every((point) => point.item.status === "published"));
  assert.ok(points.some((point) => point.kind === "clock" && point.item.id === "news-christianacare-epic"));
  assert.ok(points.some((point) => point.kind === "event" && point.item.slug === "njdvhimss-fall-conference-october-13th-15th"));
  assert.ok(!points.some((point) => point.item.slug === "temple-chestnut-hill-jhp-2026-09-30"));
  assert.ok(!points.some((point) => point.item.status !== "published"));

  const cards = systemCards(catalog, entityRows);
  assert.equal(cards.length, entityRows.filter((row) => row.kind === "system").length);
  assert.ok(cards.every((card) => card.entity.kind === "system"));
  const jefferson = cards.find((card) => card.entity.id === "org-jefferson");
  assert.ok(jefferson);
  assert.ok(jefferson.items.some((item) => item.slug.includes("jefferson") || item.orgs.includes("org-jefferson")));
  assert.ok(jefferson.facts.some((fact) => /NPSR|Net patient/i.test(fact.painted)));
  assert.ok(!jefferson.facts.some((fact) => /operating/i.test(fact.painted)));
  const cooper = cards.find((card) => card.entity.id === "org-cooper");
  assert.ok(cooper);
  assert.equal(cooper.items.length, 0);
  assert.equal(filterSystems(cards, "DE").every((card) => card.region === "DE"), true);

  const aug = monthCells(2026, 8);
  assert.equal(aug.length % 7, 0);
  assert.equal(aug[6]?.key, "2026-08-01");
  assert.equal(aug[6]?.inMonth, true);
  assert.equal(aug[0]?.key, "2026-07-26");
  const octDays = pointsOnDay(points, "2026-10-13");
  assert.ok(octDays.some((point) => point.item.slug === "njdvhimss-fall-conference-october-13th-15th"));
  assert.equal(etYmd(now), "2026-08-26");
  assert.equal(nextBriefingAt(new Date("2026-08-26T09:00:00.000Z")).toISOString(), "2026-08-26T10:00:00.000Z");
  assert.equal(nextBriefingAt(new Date("2026-08-26T12:00:00.000Z")).toISOString(), "2026-08-26T21:00:00.000Z");
  assert.equal(nextBriefingAt(new Date("2026-08-26T22:00:00.000Z")).toISOString(), "2026-08-27T10:00:00.000Z");
  assert.equal(nextBriefingAt(new Date("2026-11-02T10:00:00.000Z")).toISOString(), "2026-11-02T11:00:00.000Z");
  const thirty = horizonWindow(now, 30);
  assert.equal(Math.round((thirty.end.getTime() - thirty.start.getTime()) / 86_400_000), 30);
});

function applyMigrations(database: DatabaseSync) {
  for (const name of [
    "0001_automation.sql",
    "0002_review_audit.sql",
    "0003_editor_publication.sql",
    "0004_source_reconciliation.sql",
    "0005_publication_invariants.sql",
    "0006_editor_model_attempts.sql",
    "0007_publication_identity.sql",
    "0008_snapshot_completeness.sql",
  ]) database.exec(readFileSync(join(root, "migrations", name), "utf8"));
}

function reviewNews(id: string, title = "Penn deployment evidence"): NewsItem {
  return news({
    id,
    slug: id,
    title,
    status: "review",
    body: "Penn deployment evidence is material for local operations.",
    source: { kind: "ingest", origin: "penn-medicine-newsroom", url: `https://example.com/${id}` },
  });
}

function officialChapterEvent(id = "evt-official"): EventItem {
  return EventItem.parse({
    ...base,
    id,
    slug: id,
    title: "Official Chapter Forum",
    kind: "event",
    status: "review",
    startsAt: "2026-09-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "DVHIMSS",
    registrationUrl: "https://events.dvhimss.org/register",
    partner: "dvhimss",
    autoPublish: true,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/forum" },
  });
}

function validEnrichment(item: ContentItem) {
  return EditorEnrichment.parse({
    relevanceScore: 98,
    confidence: 0.98,
    decision: "priority_review",
    reasons: ["Evidence"],
    affectedOrgIds: item.orgs,
    productIds: [],
    changeType: "deployment",
    materialityDimensions: ["deployment"],
    impactSentence: "Penn deployment evidence is material.",
    whyAttend: null,
    whoYoullMeet: [],
    evidenceSpans: [item.title],
  });
}

function modelState(partial: Partial<EditorModelState> & Pick<EditorModelState, "id">): EditorModelState {
  return {
    fingerprint: `fp-${partial.id}`,
    enrichmentFingerprint: null,
    outcome: null,
    attemptedAt: null,
    attemptCount: 0,
    firstSeenAt: null,
    queueStatus: "review",
    hasSuccessfulEnrichment: false,
    ...partial,
  };
}

function cannedIngest(items: ContentItem[], fetchedAt = "2026-08-26T12:00:00.000Z") {
  const events = items.filter((item) => item.kind === "event");
  const rss = items.filter((item) => item.kind !== "event");
  return async () => ({
    fetchedAt,
    rss,
    events,
    social: [] as ContentItem[],
    notes: {
      rss: rss.length,
      events: events.length,
      linkedin: { count: 0, skipped: "no-token" },
      x: { count: 0, skipped: "no-token" },
      sources: [],
    },
  });
}

test("editor model work is budgeted, fair, and independent of official events", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const official = officialChapterEvent();
  assert.equal(shouldEnrichCandidate(official), false);
  assert.equal(isEditorModelEligible(official, "fp", undefined, now), false);

  const rows = Array.from({ length: 100 }, (_, index) => {
    const id = `news-${String(index).padStart(3, "0")}`;
    return {
      item: reviewNews(id),
      fingerprint: `fp-${id}`,
    };
  });
  const records = new Map(rows.map((row, index) => [row.item.id, modelState({
    id: row.item.id,
    fingerprint: row.fingerprint,
    firstSeenAt: new Date(now.getTime() - (100 - index) * 60_000).toISOString(),
  })]));
  const first = selectEditorModelWork(rows, records, 4, now).map((item) => item.id);
  assert.deepEqual(first, ["news-000", "news-001", "news-002", "news-003"]);
  assert.equal(selectEditorModelWork(rows, records, 0, now).length, 0);
  assert.equal(selectEditorModelWork(rows, records, DEFAULT_EDITOR_MODEL_BUDGET, now).length, 4);

  for (const id of first) {
    records.set(id, modelState({
      id,
      fingerprint: `fp-${id}`,
      enrichmentFingerprint: `fp-${id}`,
      outcome: "failure",
      attemptedAt: now.toISOString(),
      attemptCount: 1,
      firstSeenAt: records.get(id)?.firstSeenAt ?? null,
    }));
  }
  const second = selectEditorModelWork(rows, records, 4, now).map((item) => item.id);
  assert.deepEqual(second, ["news-004", "news-005", "news-006", "news-007"]);
});

test("successful enrichments stay reusable and failures cool down until the fingerprint changes", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const item = reviewNews("news-cache");
  const success = modelState({
    id: item.id,
    fingerprint: "fp-a",
    enrichmentFingerprint: "fp-a",
    outcome: "success",
    attemptedAt: now.toISOString(),
    attemptCount: 1,
    hasSuccessfulEnrichment: true,
  });
  assert.equal(isEditorModelEligible(item, "fp-a", success, now), false);

  const failed = modelState({
    id: item.id,
    fingerprint: "fp-a",
    enrichmentFingerprint: "fp-a",
    outcome: "failure",
    attemptedAt: now.toISOString(),
    attemptCount: 1,
  });
  assert.equal(editorModelBackoffMs(1), 6 * 60 * 60 * 1000);
  assert.equal(editorModelBackoffMs(3), 24 * 60 * 60 * 1000);
  assert.equal(isEditorModelEligible(item, "fp-a", failed, new Date(now.getTime() + 60 * 60 * 1000)), false);
  assert.equal(isEditorModelEligible(item, "fp-a", failed, new Date(now.getTime() + 6 * 60 * 60 * 1000)), true);
  const laterFailure = { ...failed, attemptCount: 3 };
  assert.equal(isEditorModelEligible(item, "fp-a", laterFailure, new Date(now.getTime() + 7 * 60 * 60 * 1000)), false);
  assert.equal(isEditorModelEligible(item, "fp-b", failed, now), true);
});

test("Muse JSON is extracted from fences and whitespace without loosening evidence checks", async () => {
  const item = reviewNews("news-json");
  const payload = validEnrichment(item);
  assert.deepEqual(extractEditorJson(`\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`), payload);
  assert.deepEqual(extractEditorJson(`  ${JSON.stringify(payload)}  `), payload);
  assert.deepEqual(extractEditorJson(`Here is the object:\n${JSON.stringify(payload)}`), payload);
  assert.throws(() => extractEditorJson(""), { code: "no_content" });
  assert.throws(() => extractEditorJson("{"), { code: "malformed" });
  assert.throws(() => extractEditorJson('{ "relevanceScore": 98,'), { code: "malformed" });

  const fencedFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.max_tokens, EDITOR_OUTPUT_MAX_TOKENS);
    assert.equal(request.reasoning.exclude, true);
    return new Response(JSON.stringify({
      choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n` } }],
    }));
  };
  const result = await enrichWithEditorModel(item, [], { apiKey: "test" }, fencedFetch as typeof fetch);
  assert.equal(result?.confidence, 0.98);

  await assert.rejects(
    enrichWithEditorModel(item, [], { apiKey: "test" }, (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...payload, affectedOrgIds: ["org-invented"] }) } }],
    }))) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "validation",
  );
  await assert.rejects(
    enrichWithEditorModel(item, [], { apiKey: "test" }, (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...payload, evidenceSpans: ["not in the source"] }) } }],
    }))) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "validation",
  );
});

test("editor model timeout, malformed JSON, and empty content are classified failures", async () => {
  const item = reviewNews("news-degrade");
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  await assert.rejects(
    enrichWithEditorModel(item, [], { apiKey: "test", timeoutMs: 1000 }, (async () => { throw timeout; }) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "timeout",
  );
  await assert.rejects(
    enrichWithEditorModel(item, [], { apiKey: "test" }, (async () => new Response(JSON.stringify({
      choices: [{ message: { content: "" } }],
    }))) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "no_content",
  );
  await assert.rejects(
    enrichWithEditorModel(item, [], { apiKey: "test" }, (async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{ "relevanceScore": 98,' } }],
    }))) as typeof fetch),
    (error: unknown) => error instanceof EditorModelError && error.code === "malformed",
  );
});

test("D1 attempt persistence reuses successes, cools failures, and retries fingerprint changes", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const item = reviewNews("news-persist");
  const now = "2026-08-26T12:00:00.000Z";
  await persistIngestRun(db, {
    fetchedAt: now,
    rss: [item],
    events: [],
    social: [],
    notes: { rss: 1, events: 0, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item, enrichment: null }]);
  const fingerprint = await candidateFingerprint(item);
  await persistEnrichments(db, [{
    item,
    enrichment: null,
    attempt: {
      fingerprint,
      attemptedAt: now,
      outcome: "failure",
      error: "timeout: Editor model timed out",
    },
  }]);
  assert.equal((await readReusableEnrichments(db, [item])).size, 0);
  const failed = database.prepare(
    "SELECT enrichment_outcome, enrichment_attempt_count, enrichment_error FROM content_candidates WHERE id = ?",
  ).get(item.id);
  assert.equal(failed.enrichment_outcome, "failure");
  assert.equal(failed.enrichment_attempt_count, 1);
  assert.match(String(failed.enrichment_error), /timeout/);

  const enrichment = validEnrichment(item);
  await persistEnrichments(db, [{
    item,
    enrichment,
    attempt: {
      fingerprint,
      attemptedAt: "2026-08-26T18:00:00.000Z",
      outcome: "success",
      error: null,
    },
  }]);
  const reused = await readReusableEnrichments(db, [item]);
  assert.equal(reused.get(item.id)?.confidence, 0.98);
  const changed = reviewNews("news-persist", "Changed Penn deployment evidence");
  assert.equal((await readReusableEnrichments(db, [changed])).size, 0);
  await persistEnrichments(db, [{
    item: changed,
    enrichment: null,
    attempt: {
      fingerprint: await candidateFingerprint(changed),
      attemptedAt: "2026-08-26T18:01:00.000Z",
      outcome: "failure",
      error: "malformed: Editor model returned malformed JSON",
    },
  }]);
  const retried = database.prepare(
    "SELECT enrichment_attempt_count, enrichment_outcome FROM content_candidates WHERE id = ?",
  ).get(item.id);
  assert.equal(retried.enrichment_attempt_count, 1);
  assert.equal(retried.enrichment_outcome, "failure");
  database.close();
});

test("scheduled editor pipeline publishes official events when the model fails and stays inside budget", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const official = officialChapterEvent();
  const newsItems = Array.from({ length: 6 }, (_, index) => reviewNews(`news-budget-${index}`));
  let modelCalls = 0;
  const fetchImpl = async () => {
    modelCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
  };
  const result = await runAutomation(
    {
      VALLEY_DESK_DB: db,
      OPENROUTER_API_KEY: "test-key",
      EDITOR_MODEL_BUDGET: 4,
      EDITOR_MODEL_CONCURRENCY: 2,
    },
    fetchImpl as typeof fetch,
    cannedIngest([official, ...newsItems]),
  );
  assert.equal("skipped" in result && result.skipped, false);
  assert.equal(result.modelBudget, 4);
  assert.equal(result.modelSelectedCount, 4);
  assert.equal(result.modelAttemptedCount, 4);
  assert.equal(result.modelFailedCount, 4);
  assert.equal(result.modelSucceededCount, 0);
  assert.equal(modelCalls, 4);
  assert.equal(result.published, 1);
  assert.equal(result.review, 6);
  const run = database.prepare("SELECT state, error FROM ingest_runs ORDER BY started_at DESC LIMIT 1").get();
  assert.equal(run.state, "succeeded");
  assert.equal(run.error, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  assert.equal(
    database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(official.id).queue_status,
    "approved",
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM automation_locks").get().count, 0);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM content_candidates WHERE enrichment_outcome = 'failure'").get().count,
    4,
  );
  database.close();
});

test("cached enrichments are not re-called and skipped candidates still get editor policy", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const item = reviewNews("news-reuse");
  const official = officialChapterEvent("evt-reuse");
  await persistIngestRun(db, {
    fetchedAt: "2026-08-26T11:00:00.000Z",
    rss: [item],
    events: [official],
    social: [],
    notes: { rss: 1, events: 1, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item, enrichment: null }, { item: official, enrichment: null }]);
  await persistEnrichments(db, [{
    item,
    enrichment: validEnrichment(item),
    attempt: {
      fingerprint: await candidateFingerprint(item),
      attemptedAt: "2026-08-26T11:00:00.000Z",
      outcome: "success",
      error: null,
    },
  }]);
  let modelCalls = 0;
  await runAutomation(
    { VALLEY_DESK_DB: db, OPENROUTER_API_KEY: "test-key", EDITOR_MODEL_BUDGET: 4 },
    (async () => {
      modelCalls += 1;
      throw new Error("model should not run for reusable rows");
    }) as typeof fetch,
    cannedIngest([item, official], "2026-08-26T12:00:00.000Z"),
  );
  assert.equal(modelCalls, 0);
  assert.equal(
    database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(official.id).queue_status,
    "approved",
  );
  assert.equal(
    database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(item.id).queue_status,
    "approved",
  );
  database.close();
});

test("model-stage errors do not leak the lock; unexpected pipeline errors mark the run failed", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const inner = sqliteD1(database);
  const db: D1DatabaseLike = {
    prepare(query: string) {
      if (query.includes("INSERT INTO source_health")) throw new Error("source-health-boom");
      return inner.prepare(query);
    },
    batch: inner.batch.bind(inner),
  };
  await assert.rejects(
    runAutomation(
      { VALLEY_DESK_DB: db, OPENROUTER_API_KEY: "test-key" },
      async () => new Response("{}", { status: 500 }) as unknown as Response,
      async () => ({
        fetchedAt: "2026-08-26T12:00:00.000Z",
        rss: [reviewNews("news-fail-run")],
        events: [],
        social: [],
        notes: {
          rss: 1,
          events: 0,
          linkedin: { count: 0 },
          x: { count: 0 },
          sources: [{
            id: "x",
            origin: "x",
            type: "social" as const,
            state: "success" as const,
            checkedAt: "2026-08-26T12:00:00.000Z",
            itemCount: 0,
            complete: false,
          }],
        },
      }),
    ),
    /source-health-boom/,
  );
  const run = database.prepare("SELECT state, error FROM ingest_runs ORDER BY started_at DESC LIMIT 1").get();
  assert.equal(run.state, "failed");
  assert.match(String(run.error), /source-health-boom/);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM automation_locks").get().count, 0);

  database.prepare(
    "INSERT INTO automation_locks (name, owner_run_id, expires_at) VALUES ('hourly-ingest', 'other-owner', ?)",
  ).run("2099-01-01T00:00:00.000Z");
  const skipped = await runAutomation(
    { VALLEY_DESK_DB: sqliteD1(database), OPENROUTER_API_KEY: "test-key" },
    fetch,
    cannedIngest([reviewNews("news-skipped")]),
  );
  assert.deepEqual(skipped, { skipped: true, reason: "automation-already-running" });
  database.close();
});

test("editor model config contracts cover migration 0006, knobs, and Muse privacy default", () => {
  const migration = readFileSync(join(root, "migrations/0006_editor_model_attempts.sql"), "utf8");
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const example = readFileSync(join(root, ".dev.vars.example"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const model = readFileSync(join(root, "src/ingest/editor-model.ts"), "utf8");
  const automation = readFileSync(join(root, "src/ingest/automation.ts"), "utf8");
  assert.ok(migration.includes("enrichment_fingerprint"));
  assert.ok(migration.includes("enrichment_attempted_at"));
  assert.ok(migration.includes("enrichment_outcome"));
  assert.ok(migration.includes("enrichment_error"));
  assert.ok(migration.includes("enrichment_attempt_count"));
  assert.equal(DEFAULT_EDITOR_MODEL, "meta/muse-spark-1.2-contributor");
  assert.ok(model.includes("muse-spark-1.2-contributor"));
  assert.ok(model.includes('"relevanceScore":0'));
  assert.ok(model.includes("Every affectedOrgId and productId must come verbatim"));
  assert.ok(wrangler.includes('"crons": ["0 * * * *"]'));
  assert.ok(example.includes("EDITOR_MODEL_BUDGET=4"));
  assert.ok(readme.includes("EDITOR_MODEL_BUDGET"));
  assert.ok(readme.includes("waitUntil"));
  assert.ok(readme.includes("There is no automatic fallback to standard Muse"));
  assert.ok(automation.includes("selectEditorModelWork"));
  assert.ok(automation.includes("markIngestRunSucceeded"));
  assert.ok(automation.includes("releaseAutomationLock"));
});

function boxesIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function eventRailBoxes(viewport: number, fontScale: number) {
  const pad = viewport <= 720 ? 20 : 56;
  const stacked = viewport < 768;
  const columns = viewport >= 768 ? 3 : 1;
  const gap = viewport >= 768 ? 48 : 0;
  const content = viewport - pad * 2;
  const col = columns === 1 ? content : (content - gap * (columns - 1)) / columns;
  const chipW = 92 * fontScale;
  const chipH = 18 * fontScale;
  const titleH = 44 * fontScale;
  if (stacked) {
    return {
      content: col,
      chip: { x: 0, y: 0, w: Math.min(chipW, col), h: chipH },
      title: { x: 0, y: chipH + 8, w: col, h: titleH },
    };
  }
  return {
    content: col,
    chip: { x: 0, y: 0, w: chipW, h: chipH },
    title: { x: chipW + 12, y: 0, w: col - chipW - 12, h: titleH },
  };
}

test("homepage event rows stack on mobile, DateChip cannot wrap, and 200% zoom does not clip", () => {
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const dateChip = css.slice(css.indexOf(".DateChip"), css.indexOf(".StatusChip"));
  assert.ok(dateChip.includes("white-space: nowrap"));
  assert.ok(dateChip.includes("flex: none"));
  assert.ok(!/height:\s*18px/.test(dateChip));
  assert.ok(css.includes("grid-template-columns: minmax(0, 1fr)"));
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.DeskRow\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.ok(css.includes("@media (max-width: 767px)"));
  assert.ok(css.includes("overflow-x: clip"));
  for (const width of [320, 375, 390, 412, 768]) {
    for (const scale of [1, 2]) {
      const { content, chip, title } = eventRailBoxes(width, scale);
      assert.ok(chip.w <= content + 0.01, `${width}@${scale} chip overflow`);
      assert.ok(title.w <= content + 0.01, `${width}@${scale} title overflow`);
      assert.ok(title.x + title.w <= content + 0.01, `${width}@${scale} horizontal scroll`);
      assert.ok(!boxesIntersect(chip, title), `${width}@${scale} intersecting rectangles`);
    }
  }
});

test("signed facts stay inside the item org graph; text and product similarity cannot attach another system", () => {
  const penn = catalog.find((item) => item.slug === "penn-in-house-ai-scribe");
  assert.ok(penn);
  const hits = itemSignedFacts(penn, entityRows);
  assert.equal(hits.some((hit) => hit.orgId === "org-temple" || hit.orgId.startsWith("org-temple")), false);
  assert.ok(!JSON.stringify(hits).includes("2,574,187,207"));
  assert.ok(!JSON.stringify(hits).includes("TUH Inc."));
  const allowed = itemOrgGraph(penn, entityRows);
  assert.ok(allowed.has("org-penn"));
  assert.ok(!allowed.has("org-temple"));
  const comparable = {
    ...penn,
    title: "Penn in-house scribe versus Temple Dragon Copilot",
    impactSentence: "Temple Dragon counts are not this count.",
  };
  const stillPenn = itemSignedFacts(comparable, entityRows);
  assert.equal(stillPenn.some((hit) => hit.orgId === "org-temple"), false);
  const products = matchingProductUses(penn);
  assert.ok(products.every((row) => row.orgIds.includes("org-penn")));
  assert.ok(!products.some((row) => row.orgIds.includes("org-temple") || row.id.includes("temple")));
  const chop = catalog.find((item) => item.slug === "chop-orca-cds");
  const chopHits = itemSignedFacts(chop!, entityRows);
  assert.ok(chopHits.every((hit) => itemOrgGraph(chop!, entityRows).has(hit.orgId)));
});

test("event times distinguish date-only, timed, and time-TBD without inventing midnight or duration", () => {
  const lspa = catalog.find((item): item is EventItem => item.slug === "lspa-open-house-2026-09-02")!;
  const hap = catalog.find((item): item is EventItem => item.slug === "hap-patient-safety-symposium-2026-09-02")!;
  const future = catalog.find((item): item is EventItem => item.slug === "life-sciences-future-2026-09-30")!;
  const ache = catalog.find((item): item is EventItem => item.slug === "ache-eastern-pa-fall-symposium-2026-09-30")!;
  const wistar = catalog.find((item): item is EventItem => item.slug === "wistar-drug-discovery-forum-2026-09-09")!;
  const bionj = catalog.find((item): item is EventItem => item.slug === "bionj-entrepreneurs-exchange-2026-09-23")!;
  const dha = catalog.find((item): item is EventItem => item.slug === "dha-healthcare-forum-2026-10-29")!;
  const cafe = catalog.find((item): item is EventItem => item.slug === "bionj-members-cafe-2026-09-15")!;
  assert.equal(eventSchedule(lspa).kind, "time-tbd");
  assert.equal(eventSchedule(wistar).kind, "time-tbd");
  assert.equal(eventSchedule(bionj).kind, "time-tbd");
  assert.equal(eventSchedule(ache).kind, "time-tbd");
  assert.equal(eventSchedule(dha).kind, "time-tbd");
  assert.equal(eventSchedule(hap).kind, "date-only");
  assert.equal(eventSchedule(future).kind, "date-only");
  assert.equal(eventSchedule(cafe).kind, "timed");
  for (const item of [lspa, hap, future, ache, wistar, bionj, dha]) {
    const when = formatEventWhen(item);
    assert.ok(!/12:00|midnight|AM/i.test(when), item.slug);
  }
  assert.match(formatEventWhen(lspa), /Time not published/);
  assert.match(formatEventWhen(hap), /Sep 2/);
  assert.equal(googleCalendarDates(hap), "20260902/20260904");
  assert.equal(googleCalendarDates(future), "20260930/20261002");
  assert.equal(googleCalendarDates(lspa), "20260902/20260903");
  assert.equal(googleCalendarDates(ache), "20260930/20261001");
  assert.equal(googleCalendarDates(dha), "20261029/20261030");
  const startOnly = EventItem.parse({
    ...base,
    id: "evt-start-only-timed",
    slug: "start-only-timed",
    title: "Start only timed",
    kind: "event",
    status: "published",
    startsAt: "2026-09-23T20:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "BioNJ",
    partner: "other",
    source: { kind: "editorial", origin: "bionj", url: "https://bionj.org/event" },
  });
  assert.equal(eventSchedule(startOnly).kind, "timed");
  assert.match(formatEventWhen(startOnly), /End time not published/);
  assert.equal(googleCalendarDates(startOnly), "20260923T200000Z/20260923T200000Z");
  const dstDate = EventItem.parse({
    ...startOnly,
    id: "evt-dst-date",
    slug: "dst-date",
    startsAt: "2026-11-01T04:00:00.000Z",
    endsAt: "2026-11-02T05:00:00.000Z",
  });
  assert.equal(eventSchedule(dstDate).kind, "date-only");
  assert.equal(googleCalendarDates(dstDate), "20261101/20261103");
  const spring = EventItem.parse({
    ...startOnly,
    id: "evt-dst-spring",
    slug: "dst-spring",
    startsAt: "2026-03-08T05:00:00.000Z",
  });
  assert.equal(eventSchedule(spring).kind, "time-tbd");
  assert.equal(googleCalendarDates(spring), "20260308/20260309");
  assert.equal(eventIsUpcoming(hap, new Date("2026-09-02T10:00:00.000Z")), true);
  assert.equal(eventLifecycle(hap, new Date("2026-09-02T10:00:00.000Z")), "upcoming");
  assert.equal(eventIsUpcoming(hap, new Date("2026-09-04T04:00:00.000Z")), false);
  assert.equal(eventLifecycle(hap, new Date("2026-09-04T04:00:00.000Z")), "completed");
  assert.equal(eventIsUpcoming(dstDate, new Date("2026-11-01T08:00:00.000Z")), true);
  assert.equal(eventLifecycle(dstDate, new Date("2026-11-03T05:00:00.000Z")), "completed");
  assert.equal(eventIsUpcoming(lspa, new Date("2026-09-02T20:00:00.000Z")), true);
  assert.equal(eventLifecycle(lspa, new Date("2026-09-03T04:00:00.000Z")), "completed");
  assert.equal(eventSchedule(cafe).timeZone, "America/New_York");
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(itemPage.includes('Status</strong> Cancelled'));
  assert.ok(itemPage.includes('Status</strong> Completed'));
});

test("idempotent event refresh keeps canonical id/slug and aliases the old published permalink", () => {
  const canonical = catalog.find((item): item is EventItem => item.id === "evt-dvhimss-22958")!;
  assert.equal(canonical.slug, "njdvhimss-fall-conference-october-13th-15th");
  assert.ok(canonical.previousSlugs?.includes("njdvhimss-fall-conference-2026"));
  assert.equal(bySlug(catalog, "njdvhimss-fall-conference-october-13th-15th")?.id, canonical.id);
  assert.equal(byPreviousSlug(catalog, "njdvhimss-fall-conference-2026")?.slug, canonical.slug);
  const refresh = EventItem.parse({
    ...canonical,
    id: "evt-njdvhimss-fall-2026",
    slug: "njdvhimss-fall-conference-2026",
    title: "NJ/DVHIMSS Fall Conference 2026",
    source: {
      kind: "ingest",
      origin: "njhimss-events",
      url: "https://njdvhimssevent.com/",
      externalId: "njdvhimss-fall-2026",
    },
  });
  const first = mergePublishedOverlay([canonical], [refresh]);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.id, canonical.id);
  assert.equal(first[0]?.slug, canonical.slug);
  assert.ok(first[0] && "previousSlugs" in first[0] && first[0].previousSlugs?.includes("njdvhimss-fall-conference-2026"));
  const second = mergePublishedOverlay(first, [refresh]);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.id, canonical.id);
  assert.equal(second[0]?.slug, canonical.slug);
  assert.equal(second[0]?.status, "published");
  const kept = retainPublishedIdentity(canonical, refresh);
  assert.equal(kept.id, canonical.id);
  assert.equal(kept.slug, canonical.slug);
  const worker = readFileSync(join(root, "worker.js"), "utf8");
  assert.ok(worker.includes("publishedSlugRedirects"));
  assert.ok(worker.includes("findPublishedSlugAlias"));
  assert.ok(worker.includes("lookupPublishedSlugAlias"));
  assert.ok(!worker.includes("limit = 100"));
  assert.ok(worker.includes("Response.redirect"));
  assert.ok(worker.includes("Response.redirect(`${url.origin}${redirected}`, 301)"));
  assert.ok(worker.includes(", 301)"));
  const itemPage = readFileSync(join(root, "src/ui/ItemPage.tsx"), "utf8");
  assert.ok(itemPage.includes("byPreviousSlug"));
  assert.ok(itemPage.includes("Navigate"));
});

test("canonical source URLs collapse across feeds and keep discovery provenance", async () => {
  assert.equal(
    normalizeSourceUrl("http://www.Inquirer.com/health/jefferson-loss/?utm_source=rss&utm_medium=feed#comments"),
    "https://inquirer.com/health/jefferson-loss",
  );
  assert.equal(
    normalizeSourceUrl("https://inquirer.com/health/jefferson-loss/"),
    "https://inquirer.com/health/jefferson-loss",
  );
  const health = rssItemToContent(
    {
      title: "Jefferson Health posts a year-end operating loss",
      link: "https://www.inquirer.com/health/jefferson-loss?utm_source=health",
      description: "Health desk.",
      pubDate: "Fri, 14 Aug 2026 12:00:00 GMT",
      guid: "health-guid",
    },
    "Inquirer Health",
    "2026-08-26T12:00:00.000Z",
  );
  const business = rssItemToContent(
    {
      title: "Jefferson Health posts a year-end operating loss",
      link: "http://inquirer.com/health/jefferson-loss/#print",
      description: "Business desk.",
      pubDate: "Fri, 14 Aug 2026 12:00:00 GMT",
      guid: "business-guid",
    },
    "Inquirer Business",
    "2026-08-26T12:00:00.000Z",
  );
  assert.equal(health.source.url, "https://inquirer.com/health/jefferson-loss");
  assert.equal(sourceIdentityKey(health), sourceIdentityKey(business));
  const collapsed = collapseBySourceIdentity([health, business]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]?.item.id, health.id);
  assert.ok(collapsed[0]?.discoveries.some((row) => row.origin === health.source.origin));
  assert.ok(collapsed[0]?.discoveries.some((row) => row.origin === business.source.origin));
  assert.ok(collapsed[0]?.item.citations?.some((citation) => citation.name === "Inquirer Business"));

  const rss = (link: string) => `<?xml version="1.0"?><rss><channel><item><title>Shared article</title><link>${link}</link><guid>${link}</guid><description>Penn named a local deployment.</description><pubDate>Wed, 26 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const ingested = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), async (input) => {
    const url = String(input);
    if (url.includes("inquirer.com") && url.includes("health")) {
      return new Response(rss("https://www.inquirer.com/health/shared?utm_source=health"), { status: 200 });
    }
    if (url.includes("inquirer.com") && url.includes("business")) {
      return new Response(rss("https://inquirer.com/health/shared/"), { status: 200 });
    }
    return new Response("", { status: 503 });
  });
  const shared = ingested.items.filter((item) => item.source.url?.includes("/health/shared"));
  assert.equal(shared.length, 1);
  assert.ok(shared[0]?.citations?.some((citation) => citation.name.includes("Inquirer")));
});

test("publication identity stays stable, aliases 301, and collisions quarantine one item", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const first = officialChapterEvent("evt-identity-keep");
  const renamed = EventItem.parse({
    ...first,
    title: "Official Chapter Forum renamed",
    slug: "official-chapter-forum-renamed",
    publishedAt: "2026-08-26T18:00:00.000Z",
    updatedAt: "2026-08-26T18:00:00.000Z",
  });
  await persistIngestRun(db, {
    fetchedAt: now.toISOString(),
    rss: [],
    events: [first],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item: first, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{ item: first, enrichment: null, decision: evaluateCandidate(first, null, now) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  const firstPublished = database.prepare(
    "SELECT id, slug, first_published_at FROM published_content WHERE candidate_id = ?",
  ).get(first.id) as { id: string; slug: string; first_published_at: string };
  assert.equal(firstPublished.id, first.id);
  assert.equal(firstPublished.slug, first.slug);

  const later = new Date("2026-08-26T18:00:00.000Z");
  await persistIngestRun(db, {
    fetchedAt: later.toISOString(),
    rss: [],
    events: [renamed],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item: renamed, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{ item: renamed, enrichment: null, decision: evaluateCandidate(renamed, null, later) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    later,
  );
  const kept = database.prepare(
    "SELECT id, slug, first_published_at, content_json FROM published_content WHERE candidate_id = ?",
  ).get(first.id) as { id: string; slug: string; first_published_at: string; content_json: string };
  assert.equal(kept.id, first.id);
  assert.equal(kept.slug, first.slug);
  assert.equal(kept.first_published_at, firstPublished.first_published_at);
  assert.equal(JSON.parse(kept.content_json).publishedAt, first.publishedAt ?? now.toISOString());
  assert.deepEqual(
    database.prepare("SELECT alias_slug FROM content_slug_aliases WHERE content_id = ?").all(first.id).map((row) => row.alias_slug),
    ["official-chapter-forum-renamed"],
  );
  const alias = await findPublishedSlugAlias(db, "event", "official-chapter-forum-renamed");
  assert.equal(alias?.kind, "event");
  assert.equal(alias?.slug, first.slug);
  assert.equal((await findPublishedContent(db, "event", first.slug))?.id, first.id);

  const duplicate = EventItem.parse({
    ...officialChapterEvent("evt-identity-collision"),
    slug: first.slug,
    source: { kind: "ingest", origin: "dvhimss-events", url: "https://dvhimss.org/event/collision" },
  });
  await persistIngestRun(db, {
    fetchedAt: later.toISOString(),
    rss: [],
    events: [duplicate],
    social: [],
    notes: { rss: 0, events: 1, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item: duplicate, enrichment: null }]);
  const counts = await persistEditorialDecisions(
    db,
    [{ item: duplicate, enrichment: null, decision: evaluateCandidate(duplicate, null, later) }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    later,
  );
  assert.equal(counts.quarantined, 1);
  assert.equal(counts.published, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM published_content").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM identity_quarantine").get().count, 1);
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(first.id).queue_status, "approved");
  database.close();
});

test("rejected candidates re-enter on fingerprint change and keep audit history", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = new Date("2026-08-26T12:00:00.000Z");
  const item = reviewNews("news-reenter", "Penn deployment evidence");
  await persistIngestRun(db, {
    fetchedAt: now.toISOString(),
    rss: [item],
    events: [],
    social: [],
    notes: { rss: 1, events: 0, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item, enrichment: null }]);
  await persistEditorialDecisions(
    db,
    [{
      item,
      enrichment: null,
      decision: {
        action: "reject",
        rule: "fixture-reject",
        confidence: 1,
        reasons: ["fixture"],
        content: { ...item, status: "review", featured: false },
      },
    }],
    DEFAULT_EDITOR_MODEL,
    DEFAULT_EDITOR_BASE_URL,
    now,
  );
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(item.id).queue_status, "rejected");
  const auditBefore = database.prepare(
    "SELECT COUNT(*) AS count FROM candidate_decisions WHERE candidate_id = ?",
  ).get(item.id).count;

  await persistIngestRun(db, {
    fetchedAt: "2026-08-26T13:00:00.000Z",
    rss: [item],
    events: [],
    social: [],
    notes: { rss: 1, events: 0, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item, enrichment: null }]);
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(item.id).queue_status, "rejected");

  const changed = reviewNews("news-reenter", "Penn deployment evidence changed materially");
  await persistIngestRun(db, {
    fetchedAt: "2026-08-26T14:00:00.000Z",
    rss: [changed],
    events: [],
    social: [],
    notes: { rss: 1, events: 0, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item: changed, enrichment: null }]);
  assert.equal(database.prepare("SELECT queue_status FROM content_candidates WHERE id = ?").get(item.id).queue_status, "review");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM candidate_decisions WHERE candidate_id = ?").get(item.id).count,
    auditBefore,
  );
  database.close();
});

test("same URL from two ingest ids collapses to one candidate with both discoveries", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const health = reviewNews("rss-health-shared", "Penn shared article");
  const business = reviewNews("rss-business-shared", "Penn shared article");
  const url = "https://www.inquirer.com/health/shared?utm_campaign=desk";
  const healthItem = { ...health, source: { ...health.source, origin: "Inquirer Health", url } };
  const businessItem = {
    ...business,
    source: { ...business.source, origin: "Inquirer Business", url: "https://inquirer.com/health/shared/" },
    citations: [{ name: "Inquirer Business", url: "https://inquirer.com/health/shared/" }],
  };
  await persistIngestRun(db, {
    fetchedAt: "2026-08-26T12:00:00.000Z",
    rss: [healthItem, businessItem],
    events: [],
    social: [],
    notes: { rss: 2, events: 0, linkedin: { count: 0 }, x: { count: 0 } },
  }, [{ item: healthItem, enrichment: null }, { item: businessItem, enrichment: null }]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM content_candidates").get().count, 1);
  const row = database.prepare("SELECT id, source_identity FROM content_candidates").get() as { id: string; source_identity: string };
  assert.equal(row.id, healthItem.id);
  assert.equal(row.source_identity, sourceIdentityKey({ ...healthItem, source: { ...healthItem.source, url: "https://inquirer.com/health/shared" } }));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM candidate_discoveries").get().count, 2);
  database.close();
});

test("published overlay pagination returns the complete D1 set past the old 200 cap", async () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const db = sqliteD1(database);
  const now = "2026-08-26T12:00:00.000Z";
  database.prepare("INSERT INTO ingest_runs (id, started_at, state, item_count) VALUES ('run-page', ?, 'succeeded', 201)").run(now);
  const insertCandidate = database.prepare(`
    INSERT INTO content_candidates (
      id, fingerprint, kind, title, source_origin, source_url, item_status, queue_status,
      content_json, first_seen_at, last_seen_at, last_run_id, source_identity
    ) VALUES (?, ?, 'event', ?, 'dvhimss-events', ?, 'published', 'approved', ?, ?, ?, 'run-page', ?)
  `);
  const insertPublished = database.prepare(`
    INSERT INTO published_content (
      candidate_id, id, kind, slug, content_json, policy_version, decision_json,
      first_published_at, updated_at
    ) VALUES (?, ?, 'event', ?, ?, 'tvd-auto-editor-v2', '{}', ?, ?)
  `);
  for (let index = 0; index < 201; index += 1) {
    const item = EventItem.parse({
      ...officialChapterEvent(`evt-page-${index}`),
      slug: `page-event-${index}`,
      status: "published",
      publishedAt: now,
      source: { kind: "ingest", origin: "dvhimss-events", url: `https://dvhimss.org/event/page-${index}` },
    });
    insertCandidate.run(
      item.id,
      `fp-${item.id}`,
      item.title,
      item.source.url,
      JSON.stringify(item),
      now,
      now,
      sourceIdentityKey(item),
    );
    insertPublished.run(item.id, item.id, item.slug, JSON.stringify(item), now, `${now.slice(0, 19)}.${String(index).padStart(3, "0")}Z`);
  }
  const items = await readPublishedContent(db);
  assert.equal(items.length, 201);
  assert.ok(items.every((item) => item.status === "published"));
  database.close();
});

test("identity migration is compatible with existing rows and unique only when identity is present", () => {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_automation.sql",
    "0002_review_audit.sql",
    "0003_editor_publication.sql",
    "0004_source_reconciliation.sql",
    "0005_publication_invariants.sql",
    "0006_editor_model_attempts.sql",
  ]) database.exec(readFileSync(join(root, "migrations", name), "utf8"));
  database.prepare("INSERT INTO ingest_runs (id, started_at, state, item_count) VALUES ('run-legacy', '2026-08-26T12:00:00.000Z', 'succeeded', 2)").run();
  const insert = database.prepare(`
    INSERT INTO content_candidates (
      id, fingerprint, kind, title, source_origin, source_url, item_status, queue_status,
      content_json, first_seen_at, last_seen_at, last_run_id
    ) VALUES (?, 'fp', 'news', 'Legacy', 'rss', ?, 'review', 'review', '{}', '2026-08-26T12:00:00.000Z', '2026-08-26T12:00:00.000Z', 'run-legacy')
  `);
  insert.run("legacy-a", "https://example.com/a");
  insert.run("legacy-b", "https://example.com/b");
  database.exec(readFileSync(join(root, "migrations/0007_publication_identity.sql"), "utf8"));
  assert.equal(database.prepare("SELECT source_identity FROM content_candidates WHERE id = 'legacy-a'").get().source_identity, null);
  database.prepare("UPDATE content_candidates SET source_identity = NULL").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM content_candidates WHERE source_identity IS NULL").get().count, 2);
  database.prepare("UPDATE content_candidates SET source_identity = 'url:https://example.com/a' WHERE id = 'legacy-a'").run();
  assert.throws(() => {
    database.prepare("UPDATE content_candidates SET source_identity = 'url:https://example.com/a' WHERE id = 'legacy-b'").run();
  });
  database.close();
});

test("event anti-FOMO copy rejects adapter boilerplate and title restatements", () => {
  const scrape = EventItem.parse({
    ...base,
    id: "evt-scrape-why",
    slug: "scrape-why",
    title: "NJ/DVHIMSS Fall Conference 2026",
    kind: "event",
    status: "published",
    body: "Best-effort scrape of the NJ/DVHIMSS conference page.",
    whyAttend: "Ingested from the DVHIMSS Events Calendar REST feed.",
    startsAt: "2026-10-13T20:30:00.000Z",
    timezone: "America/New_York",
    hostOrg: "NJDVHIMSS",
    city: "Atlantic City",
    partner: "njhimss",
    source: { kind: "ingest", origin: "njhimss-events", url: "https://njdvhimssevent.com/" },
  });
  assert.equal(isBoilerplateEventCopy(scrape.body), true);
  assert.equal(eventWhyCopy(scrape), undefined);
  assert.equal(eventWhyLine(scrape), "Details not yet published.");
  assert.equal(evaluateCandidate(scrape, null, new Date("2026-08-26T12:00:00.000Z")).rule, "reader-copy-exposes-ingestion");
  const restatement = EventItem.parse({
    ...scrape,
    id: "evt-restatement",
    slug: "restatement",
    whyAttend: "NJ/DVHIMSS Fall Conference 2026",
    body: "NJ/DVHIMSS Fall Conference 2026 in Atlantic City",
  });
  assert.equal(eventWhyCopy(restatement), undefined);
  const hap = catalog.find((item): item is EventItem => item.slug === "hap-patient-safety-symposium-2026-09-02")!;
  assert.match(eventWhyLine(hap), /patient safety/i);
  const eventsPage = readFileSync(join(root, "src/ui/EventsPage.tsx"), "utf8");
  assert.ok(eventsPage.includes("eventWhyLine"));
  assert.ok(!eventsPage.includes("item.whyAttend || item.healthSystemRelevance || item.body"));
});

test("reader copy permanently normalizes repository headlines and blocks collection notes", () => {
  assert.equal(professionalizeHeadline("CHOP ORCA repo for Epic downtime order sets"), "CHOP publishes ORCA repo");
  assert.equal(professionalizeHeadline("Penn FHIR repository for exchange examples"), "Penn publishes FHIR repo");
  assert.equal(professionalizeHeadline("Jefferson completes MyChart cutover"), "Jefferson completes MyChart cutover");
  for (const copy of [
    "Best-effort scrape of the conference page.",
    "Scraped from njdvhimssevent.com.",
    "Ingested from the DVHIMSS REST feed.",
    "The RSS adapter found this event.",
  ]) assert.equal(hasInternalProcessLanguage(copy), true, copy);
  assert.equal(hasInternalProcessLanguage("The official chapter page confirms the event in Atlantic City."), false);
});

test("public skip link, 404 recovery, URL wrap, and twice-daily edition are wired", () => {
  const layout = readFileSync(join(root, "src/ui/Layout.tsx"), "utf8");
  const notFound = readFileSync(join(root, "src/ui/NotFound.tsx"), "utf8");
  const home = readFileSync(join(root, "src/ui/HomePage.tsx"), "utf8");
  const desk = readFileSync(join(root, "src/ui/home/Desk.tsx"), "utf8");
  const lead = readFileSync(join(root, "src/ui/home/Lead.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  const facts = readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8");
  const skip = readFileSync(join(root, "src/ui/SkipLink.tsx"), "utf8");
  const labShell = readFileSync(join(root, "src/ui/lab/LabShell.tsx"), "utf8");
  const horizon = readFileSync(join(root, "src/ui/lab/LabHorizonPage.tsx"), "utf8");
  assert.ok(layout.includes("SiteSkip"));
  assert.ok(layout.includes('href="#main-content"'));
  assert.ok(layout.includes('id="main-content"'));
  assert.ok(layout.includes("tabIndex={-1}"));
  assert.ok(skip.includes("target.focus"));
  assert.ok(labShell.includes('href="#lab-content"'));
  assert.ok(labShell.includes("tabIndex={-1}"));
  assert.equal(notFound.match(/This page is not published\./g)?.length, 1);
  assert.ok(notFound.includes("<h1>"));
  assert.ok(notFound.includes("Back to the desk"));
  assert.ok(css.includes("overflow-wrap: anywhere"));
  const llms = readFileSync(join(root, "public/llms.txt"), "utf8");
  assert.match(llms, /^# The Valley Desk/m);
  assert.ok(llms.includes("/feed.json"));
  assert.ok(css.includes('.Rail[data-rail="news"] h2 {\n  color: var(--admiral)'));
  assert.ok(css.includes(".OrgTick.is-help {\n  position: relative;\n  width: 24px;\n  height: 24px;"));
  assert.ok(facts.includes("ItemEntityLinks"));
  assert.ok(facts.includes("View data"));
  assert.ok(!home.includes("editionStamp"));
  assert.ok(!home.includes("isStaleLead"));
  assert.ok(desk.includes("Quiet edition"));
  assert.ok(lead.includes("LATEST NEWS"));
  assert.ok(!lead.includes("Held from an earlier edition"));
  const morning = lastEditionAt(new Date("2026-08-26T12:00:00.000Z"));
  assert.equal(morning.toISOString(), "2026-08-26T10:00:00.000Z");
  assert.equal(nextEditionAt(new Date("2026-08-26T12:00:00.000Z")).toISOString(), "2026-08-26T21:00:00.000Z");
  const stamp = editionStamp(new Date("2026-08-26T12:00:00.000Z"));
  assert.equal(stamp.currentName, "Morning edition");
  assert.equal(stamp.nextName, "Evening edition");
  const cc = catalog.find((item) => item.slug === "christianacare-epic-go-live")!;
  assert.equal(isStaleLead(cc, new Date("2026-08-26T12:00:00.000Z")), true);
  assert.ok(horizon.includes("inWindow[inWindow.length - 1]"));
  assert.ok(horizon.includes("After 30 days"));
  assert.ok(horizon.includes("selectedOnAxis"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
});

test("editorial taxonomy is deterministic: one display label, richer topics, never a tag cloud", () => {
  const loss = catalog.find((i) => i.id === "news-jefferson-fy2026-loss")!;
  const penn = catalog.find((i) => i.id === "news-penn-ai-scribe")!;
  const hap = catalog.find((i) => i.slug === "hap-cms-0057-f-enforce-rfi")!;
  const mychart = catalog.find((i) => i.slug === "jefferson-einstein-mychart-2026-09-26")!;
  const chestnut = catalog.find((i) => i.slug === "temple-chestnut-hill-jhp-2026-09-30")!;
  const chop = catalog.find((i) => i.slug === "chop-orca-cds")!;
  const cc = catalog.find((i) => i.slug === "christianacare-epic-go-live")!;
  const tower = catalog.find((i) => i.slug === "tower-ai-tax")!;
  const dragon = catalog.find((i) => i.slug === "temple-dragon-copilot-400")!;
  const de340b = catalog.find((i) => i.slug === "de-340b-hs1-hb383-2024")!;
  assert.equal(primaryNewsLabel(loss), "FINANCE");
  assert.equal(kindChip(loss), "FINANCE");
  assert.equal(chipKind(loss), "news");
  assert.notEqual(kindChip(loss), loss.topics[0]);
  assert.equal(kindChip(penn), "AI");
  assert.equal(chipKind(penn), "ai");
  assert.equal(kindChip(hap), "POLICY");
  assert.equal(chipKind(hap), "policy");
  assert.ok(hap.topics.includes("interop"));
  assert.equal(kindChip(mychart), "EHR");
  assert.equal(kindChip(cc), "EHR");
  assert.equal(kindChip(chop), "EHR");
  assert.equal(kindChip(chestnut), "FINANCE");
  assert.equal(kindChip(tower), "AI");
  assert.equal(kindChip(dragon), "AI");
  assert.equal(kindChip(de340b), "POLICY");
  assert.equal(kindChip({ kind: "news", topics: ["product-watch", "AI"], title: "Ambient", dek: "", body: "" }), "AI");
  assert.notEqual(kindChip({ kind: "news", topics: ["product-watch"], title: "Watch", dek: "", body: "" }), "product-watch");
  assert.equal(KIND_CHIP.news, "HIT");

  const honor = catalog.find((i) => i.slug === "temple-honor-roll-2026")!;
  const johnson = catalog.find((i) => i.slug === "inspira-johnson-epic-day-6-2026-07-30")!;
  const mansue = catalog.find((i) => i.slug === "inspira-mansue-epic-2026-07-27")!;
  const mlh = catalog.find((i) => i.slug === "mlh-cloud-analytics-2026-08-17")!;
  const vuong = catalog.find((i) => i.slug === "hsx-vuong-hitrust-r2-2026-06-02")!;
  const lupi = catalog.find((i) => i.slug === "hsx-lupinetti-pbj-award-2026-06-22")!;
  const schoenbaum = catalog.find((i) => i.slug === "penn-schoenbaum-ambient-ai-2026-08-18")!;
  const santiago = catalog.find((i) => i.slug === "christianacare-santiago-home-care-cloud-2026-06-29")!;
  const mahoney = catalog.find((i) => i.slug === "penn-mahoney-muller-endowments-2026-08-04")!;
  assert.equal(honor.kind, "voice");
  assert.equal(kindChip(honor), "EHR");
  assert.equal(chipKind(honor), "voice");
  assert.equal(kindChip(johnson), "EHR");
  assert.equal(kindChip(mansue), "AI");
  assert.equal(kindChip(mlh), "OPERATIONS");
  assert.equal(kindChip(vuong), "SECURITY");
  const datedVoiceTitle = /\b(?:Jan\.?|Feb\.?|Mar\.?|Apr\.?|May|June|July|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+\d{1,2},\s+\d{4}\b/i;
  for (const item of latestVoices(catalog, Number.MAX_SAFE_INTEGER)) {
    assert.equal(datedVoiceTitle.test(item.title), false, item.slug);
  }
  assert.equal(lupi.status, "draft");
  assert.equal(kindChip(lupi), "INTEROP");
  assert.equal(kindChip(schoenbaum), "AI");
  assert.equal(kindChip(santiago), "SECURITY");
  assert.equal(kindChip(mahoney), "FINANCE");
  assert.notEqual(kindChip(honor), "VOICE");
  assert.equal(primaryVoiceLabel({ role: "CEO", person: "X", title: "Epic go-live", dek: "", body: "", topics: ["EHR"], org: "Inspira", platform: "site" }), "EHR");
  assert.equal(KIND_CHIP.voice, "OPERATIONS");

  const conference = catalog.find((i) => i.slug === "njdvhimss-fall-conference-october-13th-15th")!;
  const webinar = catalog.find((i) => i.slug === "hap-i-transfer-sepsis-webinar-2026-09-18")!;
  const acheFall = catalog.find((i) => i.slug === "ache-greater-philly-fall-symposium-2026-09-14")!;
  assert.equal(kindChip(conference), "CHAPTER");
  assert.equal(primaryEventLabel(webinar as Extract<typeof webinar, { kind: "event" }>), "WEBINAR");
  assert.equal(kindChip(webinar), "WEBINAR");
  assert.equal(kindChip(acheFall), "CHAPTER");
  assert.equal(chipKind(conference), "event");

  const publishedNews = catalog.filter((i) => (i.kind === "news" || i.kind === "policy" || i.kind === "ai") && i.status === "published");
  for (const item of publishedNews) {
    assert.equal(kindChip(item), primaryDisplayLabel(item), item.slug);
    assert.equal(kindChip(item).split(/\s+/).length, 1, item.slug);
  }
  const publishedVoices = catalog.filter((i) => i.kind === "voice" && i.status === "published");
  for (const item of publishedVoices) {
    assert.notEqual(kindChip(item), "VOICE", item.slug);
    assert.equal(chipKind(item), "voice", item.slug);
  }
});

test("published events require live registration, DV relevance, and no defensive copy", () => {
  const publishedEvents = catalog.filter((i) => i.kind === "event" && i.status === "published");
  assert.ok(publishedEvents.length >= 16);
  for (const item of publishedEvents) {
    assert.equal(item.kind, "event");
    assert.ok(item.registrationUrl, item.slug);
    assert.ok(item.registrationUrl.startsWith("https://"), item.slug);
    assert.ok(!/[{}]/.test(item.registrationUrl), item.slug);
    assert.ok(Number.isFinite(Date.parse(item.startsAt)), item.slug);
    assert.ok(item.timezone, item.slug);
    for (const value of [item.title, item.dek, item.body, item.whyAttend, item.impactSentence]) {
      assert.equal(hasDefensiveEditorialAside(value), false, `${item.slug}: ${value}`);
    }
  }
  const acheFall = publishedEvents.find((i) => i.slug === "ache-greater-philly-fall-symposium-2026-09-14");
  const webinar = publishedEvents.find((i) => i.slug === "hap-i-transfer-sepsis-webinar-2026-09-18");
  const hapEm = publishedEvents.find((i) => i.slug === "hap-emergency-management-2026-09-16");
  const builds = publishedEvents.find((i) => i.slug === "builds-bio-philly-2026-09-15");
  assert.ok(acheFall && acheFall.kind === "event");
  assert.equal(acheFall.registrationUrl, "https://www.eventbrite.com/e/2026-fall-symposium-tickets-1995143903122");
  assert.equal(acheFall.city, "Philadelphia");
  assert.ok(acheFall.whyAttend?.includes("University City"));
  assert.ok(webinar && webinar.kind === "event");
  assert.equal(webinar.format, "virtual");
  assert.ok(webinar.orgs.includes("org-penn"));
  assert.ok(hapEm && hapEm.kind === "event");
  assert.ok(hapEm.body.includes("Penn Medicine"));
  assert.ok(hapEm.body.includes("Tower Health"));
  assert.ok(builds && builds.kind === "event" && builds.registrationUrl?.includes("buildsbio.org"));
  assert.notEqual(catalog.find((i) => i.slug === "ache-eastern-pa-fall-symposium-2026-09-30")?.status, "published");
  assert.equal(itemJsonLd(acheFall)?.["@type"], "Event");
  const newsLd = itemJsonLd(catalog.find((i) => i.slug === "hap-cms-0057-f-enforce-rfi")!, entityRows);
  assert.ok(Array.isArray(newsLd?.keywords));
  assert.ok((newsLd?.keywords as string[]).includes("POLICY"));
});

test("new HSX, Penn, and ChristianaCare voices are cited, labeled, and off the news rail", () => {
  const slugs = [
    "hsx-vuong-hitrust-r2-2026-06-02",
    "penn-schoenbaum-ambient-ai-2026-08-18",
    "christianacare-santiago-home-care-cloud-2026-06-29",
  ];
  const voices = latestVoices(catalog, Number.MAX_SAFE_INTEGER);
  const news = latestNews(catalog, Number.MAX_SAFE_INTEGER, seedIds);
  for (const slug of slugs) {
    const item = catalog.find((i) => i.slug === slug);
    assert.ok(item, slug);
    assert.equal(item.kind, "voice");
    assert.equal(item.status, "published");
    assert.equal(item.featured, false);
    assert.ok(item.impactSentence?.trim(), slug);
    assert.ok(item.source.url?.startsWith("https://"), slug);
    assert.ok((item.citations ?? []).some((c) => c.url === item.source.url), slug);
    assert.ok(hasLiveSeedOrg(item.orgs, seedIds), slug);
    assert.ok(voices.some((row) => row.slug === slug), slug);
    assert.ok(!news.some((row) => row.slug === slug), slug);
    assert.equal(itemJsonLd(item), undefined);
    assert.equal(canonicalPath(item), `/voices/${slug}`);
    assert.equal(hasDefensiveEditorialAside(`${item.title} ${item.dek} ${item.body} ${item.impactSentence}`), false, slug);
  }
  const vuong = catalog.find((i) => i.slug === slugs[0])!;
  assert.equal(vuong.kind === "voice" ? vuong.person : "", "Alice Vuong");
  assert.equal(kindChip(vuong), "SECURITY");
  const schoenbaum = catalog.find((i) => i.slug === "penn-schoenbaum-ambient-ai-2026-08-18")!;
  assert.equal(schoenbaum.kind === "voice" ? schoenbaum.person : "", "Anna Schoenbaum");
  assert.ok(schoenbaum.body.includes("1,300"));
  assert.ok(!/["“]/.test(`${schoenbaum.dek} ${schoenbaum.body}`));
});

test("entity cards cover fact-bearing rows with local images, public roles, and text fallback", () => {
  assert.equal(entityRows.length, 92);
  const bearing = factBearingEntities(entityRows);
  assert.ok(bearing.some((e) => e.id === "org-hsx"));
  assert.ok(bearing.some((e) => e.id === "person-hojjat-salmasian"));
  assert.ok(bearing.some((e) => e.id === "person-jeffrey-pennington"));
  assert.ok(bearing.some((e) => e.id === "person-mitchell-schnall"));
  for (const entity of bearing) {
    assert.ok(entity.facts.length > 0, entity.id);
    assert.ok(entity.facts.every((fact) => fact.citation.url?.startsWith("https://")), entity.id);
    assert.ok(!/do not merge|not enterprise|not a merge/i.test(`${entity.role ?? ""} ${entity.facts.map((f) => f.label).join(" ")}`), entity.id);
    assert.equal(hasDefensiveEditorialAside(entity.role), false, entity.id);
    if (entity.image) {
      assert.ok(entity.image.startsWith("/entity-"), entity.id);
      assert.ok(!entity.image.startsWith("http"), entity.id);
      assert.ok(existsSync(join(root, "public", entity.image.slice(1))), entity.image);
    }
  }
  for (const [id, path] of Object.entries(VERIFIED_ENTITY_MEDIA)) {
    assert.ok(path.startsWith("/entity-") && path.endsWith(".webp"), id);
    assert.ok(existsSync(join(root, "public", path.slice(1))), path);
  }
  assert.equal(
    publicEntityRole("CMIO, Temple University Hospital only — not enterprise CMIO"),
    "CMIO, Temple University Hospital",
  );
  assert.equal(
    publicEntityContext("SVP and CIO — joined 2020; leads IT and Cybersecurity", "Main Line Health"),
    "SVP and CIO, Main Line Health",
  );
  const mention = readFileSync(join(root, "src/ui/MentionText.tsx"), "utf8");
  const factsUi = readFileSync(join(root, "src/ui/ItemFacts.tsx"), "utf8");
  const css = readFileSync(join(root, "src/styles/home.css"), "utf8");
  assert.ok(mention.includes("EntityDisclosure"));
  assert.ok(mention.includes("OrgTick"));
  assert.ok(mention.includes("canInsert"));
  assert.ok(mention.includes("match(/^\\s*[–—:-]\\s*/)") || mention.includes("match(/^\\s*[–—:-]\\s*/)?.[0]"));
  assert.ok(factsUi.includes("onError"));
  assert.ok(factsUi.includes("imageFailed") || factsUi.includes("setImageFailed"));
  assert.ok(factsUi.includes("slice(0, 1)"));
  assert.ok(!factsUi.includes("http://"));
  const cardCss = css.slice(css.indexOf(".EntityDisclosure-card"), css.indexOf(".EntityDisclosure.is-align-right"));
  assert.ok(cardCss.includes("white-space: normal"));
});
