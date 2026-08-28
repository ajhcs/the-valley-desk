import assert from "node:assert/strict";
import { test } from "node:test";
import { AiItem, EventItem, NewsItem, PolicyItem, VoiceItem, type ContentItem } from "../src/content/schema.ts";
import {
  DEFAULT_EDITOR_LANE_BUDGETS,
  DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
  EDITOR_LANE_ORDER,
  editorLaneForItem,
  selectEditorModelWorkWithLanes,
  type EditorModelState,
} from "../src/ingest/editor-work.ts";

const base = {
  kind: "news" as const,
  dek: "A regional development.",
  body: "A regional development with enough source evidence for selection.",
  status: "review" as const,
  updatedAt: "2026-08-28T10:00:00.000Z",
  topics: [],
  orgs: ["org-penn"],
  region: "PA" as const,
  authors: [],
  source: {
    kind: "ingest" as const,
    origin: "penn-medicine-newsroom",
    url: "https://example.com/source",
  },
  featured: false,
};

function news(id: string, source: Partial<ContentItem["source"]> = {}): ContentItem {
  return NewsItem.parse({
    ...base,
    id,
    slug: id,
    title: `Penn development ${id}`,
    source: { ...base.source, ...source },
    relatedEventIds: [],
    relatedVoiceIds: [],
  });
}

function event(id: string): ContentItem {
  return EventItem.parse({
    ...base,
    id,
    slug: id,
    title: `Regional event ${id}`,
    kind: "event",
    startsAt: "2026-09-20T16:00:00.000Z",
    timezone: "America/New_York",
    hostOrg: "Regional health association",
    registrationUrl: "https://example.com/register",
    partner: "other",
  });
}

function voice(id: string): ContentItem {
  return VoiceItem.parse({
    ...base,
    id,
    slug: id,
    title: `Executive post ${id}`,
    kind: "voice",
    person: "Regional executive",
    platform: "linkedin",
    originalUrl: "https://www.linkedin.com/posts/example",
    source: { ...base.source, origin: "linkedin", url: "https://www.linkedin.com/posts/example" },
  });
}

function policy(id: string): ContentItem {
  return PolicyItem.parse({
    ...base,
    id,
    slug: id,
    title: `Policy update ${id}`,
    kind: "policy",
    jurisdiction: "PA",
    issuer: "PA-DOH",
    changeType: "guidance",
  });
}

function product(id: string): ContentItem {
  return AiItem.parse({
    ...base,
    id,
    slug: id,
    title: `Product update ${id}`,
    kind: "ai",
    vendor: "Epic",
    product: "Epic",
    announcedAt: "2026-08-28T10:00:00.000Z",
  });
}

function modelState(partial: Partial<EditorModelState> & Pick<EditorModelState, "id">): EditorModelState {
  return {
    fingerprint: `fingerprint-${partial.id}`,
    enrichmentFingerprint: null,
    outcome: null,
    attemptedAt: null,
    attemptCount: 0,
    firstSeenAt: "2026-08-28T09:00:00.000Z",
    contentChangedAt: null,
    lastSeenAt: "2026-08-28T10:00:00.000Z",
    queueStatus: "review",
    hasSuccessfulEnrichment: false,
    ...partial,
  };
}

function rows(items: ContentItem[]) {
  return items.map((item) => ({ item, fingerprint: `fingerprint-${item.id}` }));
}

test("official registry metadata preserves specialist categories after generic conversion", () => {
  assert.equal(editorLaneForItem(news("official-policy", { origin: "official-ofs-pa-health" })), "policy");
  assert.equal(editorLaneForItem(news("official-finance", { origin: "official-ofs-penn-finance" })), "finance");
  assert.equal(editorLaneForItem(news("official-procurement", { origin: "official-ofs-penn-procurement" })), "procurement");
  assert.equal(editorLaneForItem(news("official-product", { origin: "official-ofs-epic-newsroom" })), "product");
  assert.equal(editorLaneForItem(news("ordinary")), "news");
});

test("explicit content kinds and leadership candidates route deterministically", () => {
  assert.equal(editorLaneForItem(event("event")), "events");
  assert.equal(editorLaneForItem(voice("voice")), "voices");
  assert.equal(editorLaneForItem(policy("policy")), "policy");
  assert.equal(editorLaneForItem(product("product")), "product");
  assert.equal(editorLaneForItem(news("leadership", { origin: "executive-leadership-monitor" })), "leadership");
});

test("each nonempty lane gets an initial slot before unused quota is redistributed", () => {
  const candidates = [
    ...Array.from({ length: 8 }, (_, index) => news(`news-${index}`)),
    policy("policy-0"),
    event("event-0"),
  ];
  const result = selectEditorModelWorkWithLanes(rows(candidates), new Map(), {
    laneBudgets: { news: 4, policy: 2, events: 2 },
    totalBudget: 5,
    now: new Date("2026-08-28T10:00:00.000Z"),
  });
  assert.equal(result.items.length, 5);
  assert.equal(result.selectedByLane.news.length, 3);
  assert.equal(result.selectedByLane.policy.length, 1);
  assert.equal(result.selectedByLane.events.length, 1);
  assert.deepEqual(
    result.items.slice(0, 3).map((item) => editorLaneForItem(item)),
    ["news", "policy", "events"],
  );
});

test("an active specialist borrows every unused slot without losing its reserved capacity", () => {
  const candidates = Array.from({ length: 40 }, (_, index) => news(`news-${index}`));
  const result = selectEditorModelWorkWithLanes(rows(candidates), new Map(), {
    laneBudgets: { news: 12 },
    totalBudget: 32,
    now: new Date("2026-08-28T10:00:00.000Z"),
  });
  assert.equal(result.items.length, 32);
  assert.equal(result.selectedByLane.news.length, 32);
  assert.equal(result.metricsByLane.news.selectedCount, 32);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 32);
});

test("specialists receive reserved work before a busy news lane borrows the remainder", () => {
  const candidates = [
    ...Array.from({ length: 12 }, (_, index) => news(`news-${index}`)),
    policy("policy-0"),
    event("event-0"),
  ];
  const result = selectEditorModelWorkWithLanes(rows(candidates), new Map(), {
    laneBudgets: { news: 2, policy: 1, events: 1 },
    totalBudget: 8,
    now: new Date("2026-08-28T10:00:00.000Z"),
  });
  assert.equal(result.items.length, 8);
  assert.equal(result.selectedByLane.policy.length, 1);
  assert.equal(result.selectedByLane.events.length, 1);
  assert.equal(result.selectedByLane.news.length, 6);
  assert.deepEqual(
    result.items.slice(0, 3).map((item) => editorLaneForItem(item)),
    ["news", "policy", "events"],
  );
});

test("a reserved news quota preserves source-origin diversity before borrowing", () => {
  const candidates = [
    ...Array.from({ length: 5 }, (_, index) => news(`penn-${index}`, { origin: "penn-medicine-newsroom" })),
    ...Array.from({ length: 5 }, (_, index) => news(`cooper-${index}`, { origin: "cooper-newsroom" })),
  ];
  const result = selectEditorModelWorkWithLanes(rows(candidates), new Map(), {
    laneBudgets: { news: 2 },
    totalBudget: 8,
    now: new Date("2026-08-28T10:00:00.000Z"),
  });
  assert.deepEqual(
    new Set(result.selectedByLane.news.slice(0, 2).map((item) => item.source.origin)),
    new Set(["penn-medicine-newsroom", "cooper-newsroom"]),
  );
  assert.equal(
    Object.values(result.metricsByLane.news.selectedOriginCounts).reduce((sum, count) => sum + count, 0),
    result.selectedByLane.news.length,
  );
});

test("a disabled specialist cannot borrow unused capacity", () => {
  const result = selectEditorModelWorkWithLanes(rows([news("disabled-news")]), new Map(), {
    laneBudgets: { news: 0 },
    totalBudget: 8,
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.selectedByLane.news.length, 0);
  assert.deepEqual(result.metricsByLane.news.selectedOriginCounts, {});
});

test("hard total cap is enforced even when lane quotas sum higher", () => {
  const candidates = [news("news-0"), news("news-1"), policy("policy-0"), event("event-0")];
  const result = selectEditorModelWorkWithLanes(rows(candidates), new Map(), {
    laneBudgets: { news: 8, policy: 8, events: 8 },
    totalBudget: 3,
  });
  assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map((item) => item.id)).size, 3);
  assert.equal(result.metricsByLane.news.selectedCount, 1);
  assert.equal(result.metricsByLane.policy.selectedCount, 1);
  assert.equal(result.metricsByLane.events.selectedCount, 1);
});

test("freshness and existing model backoff behavior are preserved inside each lane", () => {
  const now = new Date("2026-08-28T10:00:00.000Z");
  const stale = news("stale", { origin: "penn-medicine-newsroom" });
  const fresh = news("fresh", { origin: "cooper-newsroom" });
  const failed = news("failed", { origin: "christianacare-newsroom" });
  const records = new Map<string, EditorModelState>([
    [stale.id, modelState({ id: stale.id, firstSeenAt: "2026-08-20T10:00:00.000Z" })],
    [fresh.id, modelState({ id: fresh.id, firstSeenAt: "2026-08-28T09:00:00.000Z" })],
    [failed.id, modelState({
      id: failed.id,
      enrichmentFingerprint: `fingerprint-${failed.id}`,
      attemptedAt: now.toISOString(),
      outcome: "failure",
      attemptCount: 1,
    })],
  ]);
  const result = selectEditorModelWorkWithLanes(rows([stale, fresh, failed]), records, {
    laneBudgets: { news: 1 },
    totalBudget: 1,
    now,
  });
  assert.deepEqual(result.items.map((item) => item.id), [fresh.id]);
  assert.equal(result.items.some((item) => item.id === failed.id), false);
});

test("default lane configuration has a positive quota and bounded total ceiling", () => {
  for (const lane of EDITOR_LANE_ORDER) assert.ok(DEFAULT_EDITOR_LANE_BUDGETS[lane] > 0);
  assert.ok(DEFAULT_EDITOR_LANE_TOTAL_BUDGET > 0);
  assert.ok(DEFAULT_EDITOR_LANE_TOTAL_BUDGET <= 64);
});
