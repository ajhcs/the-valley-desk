import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { acceptsLegacyUtcDatetime, acceptsLegacyUrl, legacyUtcDatetime, legacyOffsetDatetime, legacyUrl } from "../src/lib/schema-compat.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AiItem, BriefingItem, ContentCatalog, ContentItem, EventItem, InterviewItem,
  Kind, NewsItem, PolicyItem, Region, SourceKind, Status, VoiceItem,
} from "../src/content/schema.ts";
import { mergePublishedOverlay, retainPublishedIdentity } from "../src/content/merge.ts";
import { loadCatalog } from "../src/content/store.ts";
import {
  byPreviousSlug, bySlug, featuredLead, latestNews, latestVoices, newsIndexItems, upcomingEvents,
} from "../src/content/queries.ts";
import { canonicalSitemapPath, sitemapEntriesForFeed } from "../src/content/sitemap.ts";
import { FeedDocument, toFeed } from "../src/ingest/feed-contract.ts";
import {
  canonicalPath as feedCanonicalPath, feedXml, mergePublishedContent,
} from "../src/ingest/public-feed.ts";
import { canonicalPath, canonicalUrl } from "../src/lib/canonical.ts";
import { KIND_PATH, itemHref } from "../src/lib/kind.ts";
import { canonicalHostRedirect } from "../src/lib/ops.ts";
import { FIXTURE_TIME, syntheticV1Items } from "./fixtures/watch-legacy/items.ts";
import {
  FrozenV1ContentItem, FrozenV1FeedDocument, FrozenV1Variants,
} from "./fixtures/watch-legacy/v1-schema.ts";

const origin = "https://thevalleydesk.org";
const variants = {
  News: NewsItem, Event: EventItem, Voice: VoiceItem, Policy: PolicyItem,
  Ai: AiItem, Briefing: BriefingItem, Interview: InterviewItem,
};
const kindNames = ["news", "event", "voice", "policy", "ai", "briefing", "interview"];

// A finite Zod 4 visitor compares the current and frozen declaration shapes.
// Refinement bodies are not serialized; behavioral matrices below exercise them.
// Fail on unknown checks rather than silently dropping a newly added constraint.
function describeChecks(schema: z.ZodType): unknown[] {
  return (schema._zod.def.checks ?? []).map(check => {
    const def = check._zod.def as unknown as Record<string, unknown>;
    if (def.check === "custom" && def.fn === acceptsLegacyUrl) return { check: "string_format", format: "url", pattern: null, flags: null, offset: undefined, local: undefined, precision: undefined };
    if (def.check === "custom" && def.fn === acceptsLegacyUtcDatetime) return { check: "legacy-utc-datetime" };
    if (def.check === "custom") return { check: "custom" };
    if (def.check === "min_length") return { check: def.check, minimum: def.minimum };
    if (def.check === "max_length") return { check: def.check, maximum: def.maximum };
    if (def.check === "length_equals") return { check: def.check, length: def.length };
    if (def.check === "string_format") {
      if (!["url", "datetime", "regex"].includes(String(def.format))) throw new Error(`Unreviewed v1 format: ${def.format}`);
      // Only the identified default UTC datetime has a compatibility validator;
      // its acceptance/output is fixed independently by the Zod 3 golden below.
      if (def.format === "datetime" && def.offset === false && def.local === false && def.precision === null) return { check: "legacy-utc-datetime" };
      return { check: def.check, format: def.format, pattern: def.pattern instanceof RegExp ? def.pattern.source : null,
        flags: def.pattern instanceof RegExp ? def.pattern.flags : null,
        offset: def.offset, local: def.local, precision: def.precision };
    }
    throw new Error(`Unreviewed v1 check: ${def.check}`);
  });
}
function describeSchema(schema: z.ZodType): unknown {
  const checks = describeChecks(schema);
  if (schema instanceof z.ZodObject) {
    return { type: "object", checks, unknownKeys: schema._zod.def.catchall ? "explicit-catchall" : "strip",
      catchall: schema._zod.def.catchall ? describeSchema(schema._zod.def.catchall as z.ZodType) : null,
      fields: Object.fromEntries(Object.entries(schema.shape).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, describeSchema(value as z.ZodType)])) };
  }
  if (schema instanceof z.ZodDiscriminatedUnion) return { type: "discriminatedUnion", checks,
    discriminator: schema._zod.def.discriminator, options: schema.options.map(option => describeSchema(option as z.ZodType)) };
  if (schema instanceof z.ZodOptional) return { type: "optional", checks, inner: describeSchema(schema.unwrap()) };
  if (schema instanceof z.ZodDefault) return { type: "default", checks, value: schema._zod.def.defaultValue, inner: describeSchema(schema.unwrap()) };
  if (schema instanceof z.ZodArray) return { type: "array", checks, item: describeSchema(schema.element as z.ZodType) };
  if (schema instanceof z.ZodString) return { type: "string", checks };
  if (schema instanceof z.ZodEnum) return { type: "enum", checks, values: schema.options };
  if (schema instanceof z.ZodLiteral) return { type: "literal", checks, value: schema.value };
  if (schema instanceof z.ZodBoolean) return { type: "boolean", checks };
  if (schema instanceof z.ZodNever) return { type: "never", checks };
  throw new Error(`Unreviewed v1 schema node: ${schema._zod.def.type}`);
}

function fixture<K extends ContentItem["kind"]>(kind: K): Extract<ContentItem, { kind: K }> {
  const item = syntheticV1Items.find((row) => row.kind === kind);
  assert.ok(item, `Missing synthetic ${kind} fixture`);
  return structuredClone(item) as Extract<ContentItem, { kind: K }>;
}

type Path = Array<string | number>;
function pathsOf(value: unknown, path: Path = []): Path[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const next = [...path, Array.isArray(value) ? Number(key) : key];
    return [next, ...pathsOf(child, next)];
  });
}

function withValue(value: unknown, path: Path, replacement: unknown): unknown {
  const copy = structuredClone(value) as Record<string | number, unknown>;
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  parent[path.at(-1)!] = replacement;
  return copy;
}

function outcome(schema: z.ZodTypeAny, value: unknown) {
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: result.error.issues.map(issue => {
      // Format checker codes/messages changed in v4. Preserve their rejection,
      // exact field path and all non-format refinements in this comparison.
      if ((issue.code === "invalid_format" && issue.format === "url") || (issue.code === "custom" && issue.message === "Invalid url")) return { code: "legacy-url", path: issue.path };
      if ((issue.code === "invalid_format" && issue.format === "datetime") || (issue.code === "custom" && issue.message === "Invalid datetime")) return { code: "legacy-datetime", path: issue.path };
      return { code: issue.code, path: issue.path, message: issue.message };
    }) };
}

function enumPaths(schema: z.ZodTypeAny, path: Path = []): Array<{ path: Path; values: string[] }> {
  if (schema instanceof z.ZodOptional) return enumPaths(schema.unwrap(), path);
  if (schema instanceof z.ZodDefault) return enumPaths(schema.removeDefault(), path);
  if (schema instanceof z.ZodArray) return enumPaths(schema.element, [...path, 0]);
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, child]) => enumPaths(child as z.ZodTypeAny, [...path, key]));
  }
  return schema instanceof z.ZodEnum ? [{ path, values: [...schema.options] }] : [];
}

// Captured using an isolated published Zod 3.25.76 package before comparison.
// This independent baseline prevents two schemas moving together onto v4 from
// concealing an acceptance/default/output change. Library error wording is not a contract.
const zod3Golden = JSON.parse(readFileSync(new URL("./fixtures/watch-legacy/zod3-semantics.json", import.meta.url), "utf8"));
const goldenHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function taggedValue(value: unknown): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (Array.isArray(value)) return ["array", value.map(taggedValue)];
  if (typeof value === "object") return ["object", Object.keys(value).sort().map(key => [key, taggedValue((value as Record<string, unknown>)[key])])];
  return [typeof value, value];
}
function semanticOutcome(value: unknown) {
  const result = ContentItem.safeParse(value);
  return result.success ? { success: true, data: taggedValue(result.data) } : { success: false };
}
test("Zod 4 retains independently captured Zod 3 legacy acceptance and normalized output", () => {
  assert.equal(goldenHash(readFileSync(new URL("./fixtures/watch-legacy/v1-schema.ts", import.meta.url))), zod3Golden.schemaFileSha256);
  assert.equal(goldenHash(readFileSync(new URL("./fixtures/watch-legacy/items.ts", import.meta.url))), zod3Golden.itemsFileSha256);
  const replacements = [undefined, null, false, 42, "", " ", "x", "xy", {}, [], ["synthetic"]];
  for (const item of syntheticV1Items) {
    const outcomes = pathsOf(item).flatMap(path => replacements.map(replacement => semanticOutcome(withValue(item, path, replacement))));
    const expected = zod3Golden.matrix.find((row: { kind: string }) => row.kind === item.kind);
    assert.ok(expected, item.kind); assert.equal(outcomes.length, expected.caseCount, item.kind);
    assert.equal(goldenHash(JSON.stringify(outcomes)), expected.sha256, item.kind);
  }
  for (const edge of zod3Golden.edges) {
    const item = fixture("news"), candidate = edge.field === "updatedAt" ? { ...item, updatedAt: edge.input } : { ...item, source: { ...item.source, url: edge.input } };
    const outcome = semanticOutcome(candidate);
    assert.deepEqual(outcome.success ? { success: true, sha256: goldenHash(JSON.stringify(outcome.data)) } : { success: false }, edge.outcome, `${edge.field}: ${edge.input}`);
  }
});

test("compatibility helpers retain independently captured UTC, offset and raw URL boundaries", () => {
  const schemas = { utc: legacyUtcDatetime(), offset: legacyOffsetDatetime(), url: legacyUrl() };
  for (const [kind, schema] of Object.entries(schemas)) {
    for (const edge of zod3Golden.helperEdges[kind]) {
      const result = schema.safeParse(edge.input);
      assert.deepEqual(result.success ? { success: true, value: result.data } : { success: false }, edge.outcome, `${kind}: ${JSON.stringify(edge.input)}`);
    }
    for (const value of [undefined, null, false, 0, {}, []]) assert.equal(schema.safeParse(value).success, false, kind);
  }
});

test("Watch cannot widen any v1 variant, nested field, constraint, default, or feed envelope", () => {
  assert.deepEqual(Object.keys(variants), Object.keys(FrozenV1Variants));
  for (const name of Object.keys(variants) as Array<keyof typeof variants>) {
    assert.deepEqual(describeSchema(variants[name]), describeSchema(FrozenV1Variants[name]), name);
  }
  assert.deepEqual(describeSchema(ContentItem), describeSchema(FrozenV1ContentItem));
  assert.deepEqual(describeSchema(FeedDocument), describeSchema(FrozenV1FeedDocument));
  assert.deepEqual(Kind.options, kindNames);
  assert.deepEqual(Region.options, ["PA", "NJ", "DE", "regional", "federal"]);
  assert.deepEqual(Status.options, ["draft", "review", "published", "unpublished"]);
  assert.deepEqual(SourceKind.options, ["editorial", "ingest"]);
});

for (const [name, frozenSchema] of Object.entries(FrozenV1Variants)) {
  const kind = frozenSchema.shape.kind.value;
  test(`v1 ${kind}: complete records and field mutations retain validation behavior`, () => {
    const item = fixture(kind);
    assert.deepEqual(ContentItem.parse(item), item);
    const replacements = [undefined, null, false, 42, "", " ", "x", "xy", {}, [], ["synthetic"]];
    let cases = 0;
    for (const path of pathsOf(item)) {
      for (const replacement of replacements) {
        const candidate = withValue(item, path, replacement);
        assert.deepEqual(outcome(ContentItem, candidate), outcome(FrozenV1ContentItem, candidate),
          `${name}.${path.join(".")} = ${JSON.stringify(replacement)}`);
        cases += 1;
      }
    }
    assert.ok(cases > 300, `Behavior matrix unexpectedly small: ${cases}`);
  });

  test(`v1 ${kind}: every nested enum accepts exactly its frozen values`, () => {
    const item = { ...fixture(kind), annotations: [] };
    for (const { path, values } of enumPaths(frozenSchema)) {
      // An annotation member is restored when its nested enum is being checked.
      const input = path[0] === "annotations" ? fixture(kind) : item;
      for (const value of values) {
        assert.equal(ContentItem.safeParse(withValue(input, path, value)).success, true, `${path.join(".")}: ${value}`);
      }
      assert.equal(ContentItem.safeParse(withValue(input, path, "watch-v2-only")).success, false, path.join("."));
    }
  });
}

test("v1 published impact, event registration, and annotation refinements stay closed", () => {
  for (const kind of ["news", "policy", "ai", "interview"] as const) {
    for (const impactSentence of [undefined, "", " \t "]) {
      assert.equal(ContentItem.safeParse({ ...fixture(kind), impactSentence }).success, false, kind);
    }
    assert.equal(ContentItem.safeParse({ ...fixture(kind), status: "review", annotations: [], impactSentence: undefined }).success, true);
  }
  assert.equal(ContentItem.safeParse({ ...fixture("event"), registrationUrl: undefined }).success, false);
  assert.equal(ContentItem.safeParse({ ...fixture("event"), status: "review", annotations: [], registrationUrl: undefined }).success, true);
  for (const status of ["draft", "review", "unpublished"]) {
    assert.equal(ContentItem.safeParse({ ...fixture("news"), status }).success, false);
    assert.equal(ContentItem.safeParse({ ...fixture("news"), status, annotations: [] }).success, true);
  }
  assert.equal(ContentCatalog.safeParse([
    { ...fixture("news"), featured: true },
    { ...fixture("news"), id: "synthetic-second-lead", slug: "synthetic-second-lead", featured: true },
  ]).success, false);
});

test("v1 does not acquire Watch kinds, policy stages, or precision-aware dates", () => {
  for (const kind of ["technology", "technology-development", "policy-subject", "representative"]) {
    const input = { ...fixture("news"), kind };
    assert.equal(ContentItem.safeParse(input).success, false, kind);
    assert.equal(FeedDocument.safeParse({ product: "the-valley-desk", version: "1", generatedAt: FIXTURE_TIME, items: [input] }).success, false, kind);
  }
  const policy = fixture("policy");
  for (const stage of ["withdrawn", "vetoed", "expired", "superseded", "effective", "passed-chamber", "signed"]) {
    const input = { ...policy, policyIdentity: { ...policy.policyIdentity, stage } };
    assert.equal(ContentItem.safeParse(input).success, false, stage);
    assert.equal(FeedDocument.safeParse({ product: "the-valley-desk", version: "1", generatedAt: FIXTURE_TIME, items: [input] }).success, false, stage);
  }
  for (const invalidDate of ["2026-09-12", "2026-09-12T12:00:00-04:00", { precision: "day", day: "2026-09-12" }, { precision: "unknown" }]) {
    assert.equal(ContentItem.safeParse({ ...policy, policyIdentity: { ...policy.policyIdentity, developmentAt: invalidDate } }).success, false);
    assert.equal(ContentItem.safeParse({ ...fixture("event"), startsAt: invalidDate }).success, false);
  }
  assert.equal(ContentItem.safeParse({ ...policy, policyIdentity: { ...policy.policyIdentity, session: undefined } }).success, true,
    "Do not silently tighten legacy optional session when adding strict Watch identities");
  assert.equal(ContentItem.safeParse({ ...policy, effectiveDate: "source says date is unconfirmed" }).success, true,
    "Legacy effectiveDate is unconstrained text, not a verified Watch date");
});

test("v1 unknown fields are stripped at every object boundary without coercing values", () => {
  for (const item of syntheticV1Items) {
    let candidate: unknown = { ...item, privateReview: "synthetic-private-field" };
    for (const path of pathsOf(item)) {
      let value: unknown = item;
      for (const key of path) value = (value as Record<string | number, unknown>)[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        candidate = withValue(candidate, [...path, "privateReview"], "synthetic-private-field");
      }
    }
    assert.deepEqual(ContentItem.parse(candidate), item);
  }
  assert.equal(ContentItem.safeParse({ ...fixture("news"), featured: "false" }).success, false);
  assert.equal(ContentItem.safeParse({ ...fixture("news"), status: "PUBLISHED" }).success, false);
  const { featured: _featured, ...withoutFeatured } = fixture("news");
  assert.equal(ContentItem.parse(withoutFeatured).featured, false);
  const { autoPublish: _autoPublish, ...withoutAutoPublish } = fixture("event");
  assert.equal((ContentItem.parse(withoutAutoPublish) as EventItem).autoPublish, false);
});

test("HTTPS refinement is enforced for source, citation, event, voice, and nested policy evidence URLs", () => {
  for (const item of syntheticV1Items) {
    let urlCount = 0;
    for (const path of pathsOf(item)) {
      let current: unknown = item;
      for (const key of path) current = (current as Record<string | number, unknown>)[key];
      if (typeof current !== "string" || !current.startsWith("https://")) continue;
      for (const invalidUrl of [current.replace("https:", "http:"), "mailto:synthetic@example.invalid", "/synthetic-relative"]) {
        assert.equal(ContentItem.safeParse(withValue(item, path, invalidUrl)).success, false,
          `${item.kind}.${path.join(".")} must remain HTTPS`);
      }
      urlCount += 1;
    }
    assert.ok(urlCount >= 2, `${item.kind} must exercise source and citation URLs`);
  }
});

test("v1 feed preserves the complete published envelope and registration, cancellation, attribution", () => {
  const items = syntheticV1Items.map((item) => ContentItem.parse(item));
  const feed = toFeed(items, FIXTURE_TIME);
  assert.deepEqual(feed, { product: "the-valley-desk", version: "1", generatedAt: FIXTURE_TIME, items });
  assert.deepEqual(FeedDocument.parse(JSON.parse(JSON.stringify(feed))), FrozenV1FeedDocument.parse(feed));
  assert.deepEqual(feed.items.find((item) => item.kind === "voice"), fixture("voice"));
  assert.equal(FeedDocument.safeParse({ ...feed, version: "2" }).success, false);
  assert.equal(FeedDocument.safeParse({ ...feed, version: 1 }).success, false);
  assert.equal(FeedDocument.safeParse({ ...feed, product: "watch-v2" }).success, false);
  assert.equal(FeedDocument.safeParse({ ...feed, generatedAt: "2026-09-12" }).success, false);
  const cancelled = { ...fixture("event"), cancelled: true };
  assert.equal(toFeed([cancelled], FIXTURE_TIME).items[0]?.kind, "event");
  assert.equal((toFeed([cancelled], FIXTURE_TIME).items[0] as EventItem).registrationUrl, cancelled.registrationUrl);
});

test("v1 feed delivery excludes unpublished, uncited, and unsafe rows but preserves citation fallback", () => {
  const news = fixture("news");
  const nonPublic = ["draft", "review", "unpublished"].map((status) => ContentItem.parse({ ...news, status, annotations: [] }));
  const uncited = { ...news, source: { ...news.source, url: undefined }, citations: [] };
  const invalidSource = { ...news, source: { ...news.source, url: "http://source.invalid/synthetic" }, citations: [] };
  const badEvent = { ...fixture("event"), endsAt: "2026-10-09T12:00:00.000Z" };
  assert.deepEqual(toFeed([...nonPublic, uncited, invalidSource, badEvent], FIXTURE_TIME).items, []);
  const citationOnly = { ...news, source: { ...news.source, url: undefined } };
  assert.deepEqual(toFeed([citationOnly], FIXTURE_TIME).items, [citationOnly]);
  assert.equal(FeedDocument.safeParse({ product: "the-valley-desk", version: "1", generatedAt: FIXTURE_TIME, items: nonPublic }).success, true,
    "Structural parsing and publication authorization remain different boundaries");
});

test("canonical paths agree across links, JSON/RSS, and sitemap for every legacy kind", () => {
  const prefixes = { news: "/news", policy: "/news", ai: "/news", interview: "/news", event: "/events", voice: "/voices", briefing: "/briefing" };
  const feed = toFeed(syntheticV1Items, FIXTURE_TIME);
  const rss = feedXml(feed, origin);
  const entries = sitemapEntriesForFeed(feed.items, FIXTURE_TIME, origin);
  for (const item of feed.items) {
    const path = `${prefixes[item.kind]}/${item.slug}`;
    for (const resolve of [canonicalPath, canonicalSitemapPath, feedCanonicalPath, itemHref]) {
      assert.equal(resolve(item), path, `${item.kind} ${resolve.name}`);
    }
    assert.equal(KIND_PATH[item.kind], prefixes[item.kind]);
    assert.equal(canonicalUrl(item, origin), origin + path);
    assert.equal(entries.filter((entry) => entry.loc === origin + path).length, 1);
    assert.ok(rss.includes(`<link>${origin}${path}</link>`));
    assert.ok(rss.includes(`<guid isPermaLink="true">${origin}${path}</guid>`));
    for (const alias of item.previousSlugs ?? []) assert.ok(!entries.some((entry) => entry.loc.endsWith(`/${alias}`)));
  }
  const redirect = canonicalHostRedirect(new Request("https://www.thevalleydesk.org/voices/synthetic-voice?from=archive"), origin);
  assert.equal(redirect?.status, 308);
  assert.equal(redirect?.headers.get("Location"), `${origin}/voices/synthetic-voice?from=archive`);
});

test("first-published identity, date, and aliases survive repeated ingest refreshes", () => {
  for (const kind of ["news", "event", "voice", "policy", "ai"] as const) {
    const current = fixture(kind);
    const incoming = {
      ...current, id: `${current.id}-new`, slug: `${current.slug}-new`, publishedAt: FIXTURE_TIME,
      previousSlugs: [current.slug, `${current.slug}-old`, `${current.slug}-older`],
      title: "Synthetic corrected headline",
    };
    const first = mergePublishedOverlay([current], [incoming]);
    assert.equal(first.length, 1, kind);
    assert.equal(first[0].id, current.id);
    assert.equal(first[0].slug, current.slug);
    assert.equal(first[0].publishedAt, current.publishedAt);
    assert.deepEqual(first[0].previousSlugs, [`${current.slug}-old`, `${current.slug}-older`, incoming.slug]);
    assert.equal(bySlug(first, current.slug)?.id, current.id);
    assert.equal(byPreviousSlug(first, incoming.slug)?.slug, current.slug);
    assert.equal(byPreviousSlug(first, current.slug), undefined);
    assert.deepEqual(mergePublishedOverlay(first, [incoming]), first);
    assert.deepEqual(retainPublishedIdentity(current, incoming), first[0]);
    assert.deepEqual(mergePublishedContent([current], [incoming]), first);
  }
});

test("overlay cannot take an owned route, rewrite editorial content, or set the featured lead", () => {
  const news = fixture("news");
  const editorial = { ...news, featured: true, source: { ...news.source, kind: "editorial" as const } };
  const incoming = { ...news, title: "Synthetic replacement headline" };
  assert.deepEqual(mergePublishedOverlay([editorial], [incoming]), [editorial]);
  assert.deepEqual(mergePublishedOverlay([], [{ ...incoming, featured: true }]), []);
  const routeOwner = {
    ...news, id: "synthetic-owned-id", slug: "synthetic-owned-route",
    source: { ...news.source, url: "https://source.invalid/synthetic-owned-route" },
  };
  assert.deepEqual(mergePublishedOverlay([news, routeOwner], [{ ...incoming, slug: routeOwner.slug }]), [news, routeOwner]);
  const merged = mergePublishedOverlay([editorial], [{ ...fixture("ai"), featured: false }]);
  assert.equal(featuredLead(merged)?.id, editorial.id);
  assert.equal(featuredLead([{ ...fixture("ai"), featured: true }]), undefined);
  assert.ok(!newsIndexItems(merged).some((item) => item.id === editorial.id));
  assert.ok(!latestNews(merged, 10).some((item) => item.id === editorial.id));
});

test("tombstones suppress static and dynamic ingest rows but never signed editorial rows", () => {
  for (const kind of ["news", "event", "voice", "policy", "ai"] as const) {
    const item = fixture(kind);
    const current = mergePublishedOverlay([item], [item], [item.id]);
    assert.deepEqual(current, []);
    assert.equal(bySlug(current, item.slug), undefined);
    assert.equal(byPreviousSlug(current, item.previousSlugs![0]), undefined);
    assert.deepEqual(toFeed(current, FIXTURE_TIME).items, []);
    assert.deepEqual(mergePublishedContent([item], [], [item.id]), []);
    const editorial = { ...item, source: { ...item.source, kind: "editorial" as const } };
    assert.deepEqual(mergePublishedOverlay([editorial], [], [item.id]), [editorial]);
  }
});

test("Voices archive remains separate and event cancellation/completion keep permalinks", () => {
  const voice = fixture("voice");
  const cancelled = { ...fixture("event"), cancelled: true };
  const completed = {
    ...fixture("event"), id: "synthetic-completed-event", slug: "synthetic-completed-event",
    startsAt: "2026-09-01T12:00:00.000Z", endsAt: "2026-09-01T13:00:00.000Z",
  };
  const items = [voice, cancelled, completed];
  assert.deepEqual(latestVoices(items), [voice]);
  assert.deepEqual(newsIndexItems(items), []);
  assert.deepEqual(upcomingEvents(items, new Date(FIXTURE_TIME)), []);
  assert.equal(bySlug(items, cancelled.slug)?.id, cancelled.id);
  assert.equal(bySlug(items, completed.slug)?.id, completed.id);
  assert.equal(byPreviousSlug(items, voice.previousSlugs![0])?.id, voice.id);
});

test("bundled fallback survives absent, malformed, and invalid dynamic hydration", () => {
  const runtime = globalThis as typeof globalThis & {
    __VALLEY_DESK_DYNAMIC_ITEMS__?: unknown; __VALLEY_DESK_WITHDRAWN_IDS__?: unknown;
  };
  const oldItems = Object.getOwnPropertyDescriptor(runtime, "__VALLEY_DESK_DYNAMIC_ITEMS__");
  const oldWithdrawn = Object.getOwnPropertyDescriptor(runtime, "__VALLEY_DESK_WITHDRAWN_IDS__");
  try {
    delete runtime.__VALLEY_DESK_DYNAMIC_ITEMS__;
    delete runtime.__VALLEY_DESK_WITHDRAWN_IDS__;
    const bundled = loadCatalog();
    assert.ok(bundled.length > 0);
    for (const invalidRuntime of [undefined, null, {}, "unavailable", [], [null, { kind: "technology" }]]) {
      runtime.__VALLEY_DESK_DYNAMIC_ITEMS__ = invalidRuntime;
      assert.deepEqual(loadCatalog(), bundled);
    }
    const event = fixture("event");
    runtime.__VALLEY_DESK_DYNAMIC_ITEMS__ = [event];
    assert.equal(loadCatalog().find((item) => item.id === event.id)?.slug, event.slug);
    runtime.__VALLEY_DESK_WITHDRAWN_IDS__ = [event.id, false, null, 9];
    assert.deepEqual(loadCatalog(), bundled);
    const ingest = bundled.find((item) => item.source.kind === "ingest");
    assert.ok(ingest, "The approved bundled baseline must exercise a retractable ingest row");
    runtime.__VALLEY_DESK_DYNAMIC_ITEMS__ = undefined;
    runtime.__VALLEY_DESK_WITHDRAWN_IDS__ = [ingest.id];
    assert.deepEqual(loadCatalog(), bundled.filter((item) => item.id !== ingest.id));
  } finally {
    if (oldItems) Object.defineProperty(runtime, "__VALLEY_DESK_DYNAMIC_ITEMS__", oldItems);
    else delete runtime.__VALLEY_DESK_DYNAMIC_ITEMS__;
    if (oldWithdrawn) Object.defineProperty(runtime, "__VALLEY_DESK_WITHDRAWN_IDS__", oldWithdrawn);
    else delete runtime.__VALLEY_DESK_WITHDRAWN_IDS__;
  }
});
