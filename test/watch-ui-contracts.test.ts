import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isWatchSlug, parseWatchQuery, WATCH_CURSOR_LIMIT, WATCH_PAGE_LIMIT, WATCH_QUERY_TEXT_LIMIT, watchDirectoryPath, watchQuerySearch } from "../src/content/watch-query.ts";
import { projectPolicyDossier, projectTechnologyProfile } from "../src/content/watch-projection.ts";
import { MAX_PUBLIC_WATCH_BYTES } from "../src/content/watch-schema.ts";
import { parsePlainSearch, stringifyPlainSearch } from "../src/lib/plain-search.ts";
import { parseWatchResponse, readWatch, WatchReadError, watchDetailApiPath, watchDirectoryApiPath } from "../src/ui/watch/watch-api.ts";
import { instantLabel, sourceDateLabel } from "../src/ui/watch/watch-labels.ts";
import { createWatchSaveStore, parseWatchSaves, WATCH_SAVE_LIMIT, WATCH_SAVES_KEY } from "../src/ui/watch/watch-saves.ts";
import { NOW, OTHER_HASH, syntheticFixture } from "./fixtures/watch-contracts/synthetic.ts";

// The root config contains project references; rendered components need the app's JSX transform.
const rendered = register({ namespace: "watch-ui-render-contracts", tsconfig: fileURLToPath(new URL("../tsconfig.app.json", import.meta.url)) });
const { PolicyDossier } = await rendered.import("../src/ui/watch/PolicyDossier.tsx", import.meta.url);
const { TechnologyDossier } = await rendered.import("../src/ui/watch/TechnologyDossier.tsx", import.meta.url);
const { WatchDataStatus, WatchSources } = await rendered.import("../src/ui/watch/WatchShared.tsx", import.meta.url);
after(() => rendered.unregister());

async function policy() { const fixture = await syntheticFixture("policy"); return projectPolicyDossier(fixture.draft, fixture.context); }
async function technology() { const fixture = await syntheticFixture("technology"); return projectTechnologyProfile(fixture.draft, fixture.context); }
const directory = (items: unknown[] = [], nextCursor: string | null = null) => ({ version: "watch-directory-1", generation: 1, asOf: NOW, items, nextCursor });

test("artifact source dates must bind to their accepted artifact fact in projection and transport", async () => {
  const fixture = await syntheticFixture("technology");
  const artifact = fixture.facts.get("f-artifact")!;
  artifact.value = { ...(artifact.value as object), sourceOccurredAt: { precision: "instant", value: "2026-09-10T00:00:00.000Z", evidenceIds: ["evidence-f-artifact"] } };
  await fixture.refresh();
  const projected = await projectTechnologyProfile(fixture.draft, fixture.context);
  assert.doesNotThrow(() => parseWatchResponse(directory([projected]), "technology"));
  const invalid = structuredClone(projected);
  invalid.artifacts[0]!.value.sourceOccurredAt = { precision: "instant", value: "2026-09-10T00:00:00.000Z", evidenceIds: ["evidence-f-title"] };
  assert.throws(() => parseWatchResponse(directory([invalid]), "technology"));
  artifact.value = { ...(artifact.value as object), sourceOccurredAt: invalid.artifacts[0]!.value.sourceOccurredAt };
  await fixture.refresh();
  await assert.rejects(projectTechnologyProfile(fixture.draft, fixture.context), /date-evidence-not-bound/);
});
const detail = (item: unknown) => ({ version: "watch-detail-1", item, asOf: NOW });
const json = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json", ...headers } });
const fetchReturning = (response: Response): typeof fetch => async () => response;
const readError = (code: string) => (error: unknown) => error instanceof WatchReadError && error.code === code;

test("Watch query grammar separates policy and technology filters and keeps all regional jurisdictions", () => {
  assert.deepEqual(parseWatchQuery("", "policy"), { values: {}, errors: [], active: false });
  for (const jurisdiction of ["federal", "PA", "NJ", "DE", "regional"]) {
    assert.deepEqual(parseWatchQuery(`?jurisdiction=${jurisdiction}&stage=active`, "policy").errors, []);
  }
  for (const type of ["software", "paper", "dataset", "database-engine", "data-platform", "standard", "commercial-product"]) {
    assert.deepEqual(parseWatchQuery(`?type=${type}&organization=regional-lab&license=restricted-source`, "technology").errors, []);
  }
  assert.ok(parseWatchQuery("?type=software", "policy").errors.length);
  assert.ok(parseWatchQuery("?jurisdiction=PA", "technology").errors.length);
});

test("unknown, duplicate, malformed and overlong filters remain invalid instead of broadening", () => {
  for (const query of ["?q=one&q=two", "?limit=10&limit=20", "?q=&q=", "?utm_source=feed", "?county=Philadelphia", "?stage=passed", "?jurisdiction=NY", "?limit=0", "?limit=01", "?limit=1.5", "?limit=1e1", "?limit=51", "?limit=+1+", "?q=%00", "?q=%0A", "?q=a%0Ab", `?q=${"x".repeat(WATCH_QUERY_TEXT_LIMIT + 1)}`, `?cursor=${"x".repeat(WATCH_CURSOR_LIMIT + 1)}`]) {
    assert.ok(parseWatchQuery(query, "policy").errors.length, query.slice(0, 80));
  }
  for (const query of ["?type=tool", "?license=MIT", "?organization=has+spaces", "?organization=__proto__"]) assert.ok(parseWatchQuery(query, "technology").errors.length, query);
  for (const key of ["__proto__", "constructor", "prototype"]) assert.ok(parseWatchQuery(`?${key}=yes`, "technology").errors.length);
  assert.equal(({} as Record<string, unknown>).yes, undefined);
});

test("literal search, opaque cursors and exact-ID filters round-trip through the router", () => {
  for (const q of ["100", '"quoted"', '{"type":"software"}', "C++ & data"]) {
    const values = { q, type: "database-engine", organization: "org:123", license: "unknown", limit: "50", cursor: "discard-me" };
    const search = watchQuerySearch(values, "technology", "opaque+cursor/=01");
    const serialized = stringifyPlainSearch(search);
    const query = parseWatchQuery(stringifyPlainSearch(parsePlainSearch(serialized)), "technology");
    assert.equal(query.values.q, q);
    assert.equal(query.values.cursor, "opaque+cursor/=01");
    assert.deepEqual(query.errors, []);
    assert.equal(watchQuerySearch(values, "technology").cursor, undefined);
  }
  assert.equal(watchDirectoryPath("policy"), "/policy-watch");
  assert.equal(watchDirectoryPath("technology", { q: " C++ " }), "/technology-watch?q=C%2B%2B");
  assert.equal(watchDirectoryApiPath("policy", { jurisdiction: "NJ", cursor: "abc" }), "/api/v2/watch/policy?jurisdiction=NJ&cursor=abc");
  assert.throws(() => watchQuerySearch({ stage: "passed" }, "policy"), TypeError);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const normalized = stringifyPlainSearch(parsePlainSearch(`?${key}=discarded&invalid_search_field=`));
    assert.ok(parseWatchQuery(normalized, "policy").errors.length);
    assert.equal(normalized.includes("discarded"), false);
  }
});

test("pagination limits are bounded canonical integers and pagination alone is not an active filter", () => {
  for (let limit = 1; limit <= WATCH_PAGE_LIMIT; limit++) assert.deepEqual(parseWatchQuery(`?limit=${limit}`, "policy").errors, []);
  assert.equal(parseWatchQuery("?limit=20&cursor=abc", "policy").active, false);
  assert.equal(parseWatchQuery("?q=health&cursor=abc", "policy").active, true);
  const long = parseWatchQuery(`?q=${"x".repeat(17_000)}`, "policy");
  assert.ok(long.errors.length); assert.deepEqual(long.values, {});
});

test("slug lookup is explicit and reserved updates is never a dossier", () => {
  assert.equal(watchDetailApiPath("policy", "synthetic-policy"), "/api/v2/watch/policy/synthetic-policy?lookup=slug");
  for (const slug of ["updates", "", "UPPER", "../policy", "a/b", "a?lookup=id", "a-", "a--b", "a".repeat(101)]) {
    assert.equal(isWatchSlug(slug), false, slug);
    assert.throws(() => watchDetailApiPath("technology", slug), TypeError);
  }
});

test("accepted synthetic projection records survive strict UI transport parsing", async () => {
  const p = await policy(), t = await technology();
  assert.deepEqual(parseWatchResponse(directory([p]), "policy"), directory([p]));
  assert.deepEqual(parseWatchResponse(detail(t), "technology", t.slug), detail(t));
  assert.deepEqual(parseWatchResponse({ ...directory(), generation: 0, asOf: null }, "policy"), { ...directory(), generation: 0, asOf: null });
});

test("wrong kind, slug, duplicate identity, missing provenance and unknown response fields fail closed", async () => {
  const p = await policy(), t = await technology();
  for (const payload of [directory([t]), directory([p, p]), { ...directory([p]), internalReview: "private" }, directory([{ ...p, sources: [] }]), directory([{ ...p, sources: p.sources.filter(source => !p.summary!.evidenceIds.includes(source.id)) }]), directory([{ ...p, summary: { ...p.summary, evidenceIds: ["missing"] } }])]) {
    assert.throws(() => parseWatchResponse(payload, "policy"), readError("invalid-response"));
  }
  assert.throws(() => parseWatchResponse(detail(p), "policy", "different-record"), readError("invalid-response"));
  assert.throws(() => parseWatchResponse({ ...detail(p), item: { ...p, slug: "updates" } }, "policy", "updates"), readError("invalid-response"));
  assert.throws(() => parseWatchResponse(directory(Array.from({ length: 51 }, () => p)), "policy"), readError("invalid-response"));
  assert.throws(() => parseWatchResponse(directory([], "a\nb"), "policy"), readError("invalid-response"));
});

test("policy state and dated action evidence must agree with public facts", async () => {
  const p = await policy();
  for (const update of [
    { jurisdiction: "NJ" }, { lifecycle: "adopted" }, { legalEffect: "in-effect" },
    { interpretation: { readiness: "evidence-changed", summary: p.interpretation.summary, reason: "Held" } },
    { latestAction: { ...p.latestAction, value: { ...p.latestAction!.value, sourceOccurredAt: { precision: "instant", value: NOW, evidenceIds: ["missing-date-evidence"] } } } },
    { latestAction: { ...p.latestAction, value: { ...p.latestAction!.value, sourceOccurredAt: { precision: "instant", value: NOW, evidenceIds: p.identity.evidenceIds } } } },
  ]) assert.throws(() => parseWatchResponse(directory([{ ...p, ...update }]), "policy"), readError("invalid-response"));
});

test("technology local connections and license assessments must bind to the displayed artifact/version", async () => {
  const t = await technology();
  for (const update of [
    { organizationIds: ["unverified-local-organization"] },
    { artifacts: t.artifacts.map(fact => ({ ...fact, value: { ...fact.value, resourceId: "wrong-resource" } })) },
    { localRelationships: t.localRelationships.map(fact => ({ ...fact, value: { ...fact.value, artifactId: "other-artifact" } })) },
    { licenses: t.licenses.map(fact => ({ ...fact, value: { ...fact.value, artifactVersion: "v2" } })) },
  ]) assert.throws(() => parseWatchResponse(detail({ ...t, ...update }), "technology", t.slug), readError("invalid-response"));
});

test("read-only API calls use fixed paths, no credentials, no cached fallback and no redirects", async () => {
  const p = await policy();
  let seen: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, options) => { assert.equal(url, watchDetailApiPath("policy", p.slug)); seen = options; return json(detail(p)); };
  const result = await readWatch(watchDetailApiPath("policy", p.slug), "policy", new AbortController().signal, p.slug, fetcher);
  assert.equal(result.stale, false);
  assert.equal(seen?.method, "GET"); assert.equal(seen?.credentials, "omit"); assert.equal(seen?.cache, "no-store"); assert.equal(seen?.redirect, "error");
  for (const url of ["https://example.test/api/v2/watch/policy", "/api/v2/watch/technology", `/api/v2/watch/policy/${p.slug}`]) {
    await assert.rejects(readWatch(url, "policy", new AbortController().signal, p.slug, fetcher), TypeError);
  }
});

test("404, 409 hold, 503 unavailable and expired cursors are distinct from an empty directory", async () => {
  for (const [status, code] of [[404, "not-found"], [409, "held"], [503, "unavailable"], [400, "invalid-query"], [410, "cursor-expired"], [500, "unavailable"]] as const) {
    await assert.rejects(readWatch("/api/v2/watch/policy", "policy", new AbortController().signal, undefined,
      fetchReturning(new Response(JSON.stringify({ error: { code: status === 409 ? "watch-evidence-changed" : "synthetic-error", message: "Not for display" } }), { status }))), readError(code));
  }
  const empty = await readWatch("/api/v2/watch/policy", "policy", new AbortController().signal, undefined, fetchReturning(json(directory())));
  assert.equal(empty.response.version, "watch-directory-1");
});

test("only an explicit stale header marks a valid accepted fallback", async () => {
  for (const [header, expected] of [[undefined, false], ["fresh", false], ["stale", true]] as const) {
    const result = await readWatch("/api/v2/watch/policy", "policy", new AbortController().signal, undefined,
      fetchReturning(json({ ...directory(), asOf: "2020-01-01T00:00:00.000Z" }, header ? { "X-Watch-Data-State": header } : {})));
    assert.equal(result.stale, expected);
  }
});

test("malformed, non-JSON, over-budget and invalid-UTF8 responses never become records", async () => {
  const p = await policy();
  const responses = [new Response("<html>unavailable</html>", { headers: { "content-type": "text/html" } }),
    new Response("{bad json", { headers: { "content-type": "application/json" } }),
    json(detail(p), { "content-length": String(MAX_PUBLIC_WATCH_BYTES + 16_385) }),
    new Response(" ".repeat(MAX_PUBLIC_WATCH_BYTES + 16_385), { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })];
  for (const response of responses) await assert.rejects(readWatch(watchDetailApiPath("policy", p.slug), "policy", new AbortController().signal, p.slug, fetchReturning(response)), readError("invalid-response"));
  const networkFailure: typeof fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(readWatch("/api/v2/watch/policy", "policy", new AbortController().signal, undefined, networkFailure), readError("network"));
});

test("date-only, instant and unknown dates retain their source precision", () => {
  assert.equal(sourceDateLabel({ precision: "day", value: "2026-11-01", timezone: "America/New_York", timezoneReason: null, evidenceIds: ["e"] }), "2026-11-01 (date only; America/New_York)");
  assert.equal(sourceDateLabel({ precision: "day", value: "2026-03-08", timezone: null, timezoneReason: "Source does not specify a zone.", evidenceIds: ["e"] }), "2026-03-08 (date only; time zone not established: Source does not specify a zone.)");
  assert.equal(sourceDateLabel({ precision: "unknown", reason: "No dated action supplied." }), "Date not established: No dated action supplied.");
  assert.equal(sourceDateLabel({ precision: "instant", value: NOW, evidenceIds: ["e"] }), "2026-09-12 13:00:00 UTC");
  assert.equal(instantLabel("2026-09-12T13:00:00.123Z"), "2026-09-12 13:00:00.123 UTC");
});

test("policy rendering keeps lifecycle, legal effect and held interpretation distinct", async () => {
  const p = await policy();
  const html = renderToStaticMarkup(createElement(PolicyDossier, { item: p }));
  assert.match(html, /Lifecycle/); assert.match(html, /Active/); assert.match(html, /Legal effect/); assert.match(html, /Not in effect/);
  assert.match(html, /2026-09-10 \(date only; America\/New_York\)/);
  assert.doesNotMatch(html, /2026-09-10T00:00/);
  const fixture = await syntheticFixture("policy");
  fixture.currentInterpretations.set("f-interpretation", { ...fixture.currentInterpretations.get("f-interpretation") as object, artifactSha256: OTHER_HASH });
  const held = await projectPolicyDossier(fixture.draft, fixture.context);
  const heldHtml = renderToStaticMarkup(createElement(PolicyDossier, { item: held }));
  assert.match(heldHtml, /Interpretation held: evidence changed/);
  assert.doesNotMatch(heldHtml, /Synthetic reviewed meaning/);
});

test("technology rendering shows usage context and independent license scopes without inventing readiness", async () => {
  const t = await technology();
  const html = renderToStaticMarkup(createElement(TechnologyDossier, { item: t }));
  for (const text of ["Purpose", "Intended users", "Delaware Valley Connections", "Historical connection", "Workflow", "Inputs", "Outputs", "Steps", "Setup", "Maintainer documented", "v1", "Artifacts", "Restricted source", "Code", "No accepted data license assessment", "No accepted weights license assessment", "Limitations", "Clinical use requires separate authorization."]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Desk tested|OSI open source|Current at verification|Production ready/);
  assert.match(html, /https:\/\/code.example.test\/project\/docs/);
});

test("literal evidence is escaped, disclosures contain provenance, and old as-of is not called fresh", async () => {
  const p = await policy();
  p.sources[0] = { ...p.sources[0]!, quote: "<script>not executable</script> & exact evidence", locator: "PDF page 2" };
  const html = renderToStaticMarkup(createElement(WatchSources, { item: p }));
  assert.match(html, /<details/); assert.match(html, /<summary/); assert.match(html, /PDF page 2/);
  assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  const ordinary = renderToStaticMarkup(createElement(WatchDataStatus, { asOf: NOW, stale: false }));
  assert.match(ordinary, /Source-check freshness is not established/); assert.doesNotMatch(ordinary, /Retained snapshot/);
  assert.match(renderToStaticMarkup(createElement(WatchDataStatus, { asOf: null, stale: true })), /Retained snapshot/);
});

test("local saves persist only stable typed IDs and survive a new store and clear", () => {
  let raw: string | null = null;
  const storage = { getItem: (key: string) => { assert.equal(key, WATCH_SAVES_KEY); return raw; }, setItem: (key: string, value: string) => { assert.equal(key, WATCH_SAVES_KEY); raw = value; } };
  const store = createWatchSaveStore(storage);
  let notices = 0; const unsubscribe = store.subscribe(() => { notices++; });
  store.setSaved("policy", "same-id", true); store.setSaved("technology", "same-id", true);
  assert.deepEqual(JSON.parse(raw!), { version: "watch-saves-1", items: [{ kind: "policy", id: "same-id" }, { kind: "technology", id: "same-id" }] });
  assert.equal(createWatchSaveStore(storage).getSnapshot().items.length, 2);
  store.setSaved("policy", "same-id", false); assert.equal(store.getSnapshot().items[0]?.kind, "technology");
  store.receive(null); assert.equal(store.getSnapshot().items.length, 0);
  assert.equal(notices, 4); unsubscribe();
});

test("denied/quota-exceeded local storage remains usable for this visit and reports the limitation", () => {
  for (const storage of [undefined, { getItem: () => { throw new Error("Denied"); }, setItem: () => {} }, { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } }]) {
    const store = createWatchSaveStore(storage);
    store.setSaved("technology", "resource-1", true);
    assert.equal(store.getSnapshot().items.length, 1); assert.equal(store.getSnapshot().sessionOnly, true);
    assert.match(store.getSnapshot().message ?? "", /this visit only/);
    store.setSaved("technology", "resource-1", false); assert.equal(store.getSnapshot().items.length, 0);
  }
});

test("malformed, oversized and untyped saved data are ignored and the save count is bounded", () => {
  for (const raw of ["{", "x".repeat(160_001), JSON.stringify({ version: "old", items: [] }), JSON.stringify({ version: "watch-saves-1", items: [{ kind: "policy", id: "a", title: "Do not cache facts" }] })]) assert.deepEqual(parseWatchSaves(raw), []);
  const store = createWatchSaveStore();
  for (let i = 0; i <= WATCH_SAVE_LIMIT; i++) store.setSaved("policy", `id-${i}`, true);
  assert.equal(store.getSnapshot().items.length, WATCH_SAVE_LIMIT);
  assert.match(store.getSnapshot().message ?? "", /limit has been reached/);
  assert.equal(store.getSnapshot().items.some(item => item.id === `id-${WATCH_SAVE_LIMIT}`), false);
  assert.throws(() => store.setSaved("policy", "invalid id", true));
});
