import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleReviewApi, isReviewApiPath } from "../src/ingest/review-api";
import { regionalEvidenceReviewPayload } from "../src/ingest/regional-evidence-review";
import { coveragePack } from "../src/ingest/coverage-pack";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence";
const path = "/api/automation/status/regional-review";
const request = (method = "GET", suffix = path) => new Request("https://thevalleydesk.com" + suffix, { method });
const trusted = { trustedAccessEmail: "clyons@ajhcs.org" };
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE source_health(source_id TEXT, state TEXT, last_checked_at TEXT, last_success_at TEXT); CREATE TABLE scheduled_source_state(source_id TEXT, state TEXT, last_success_at TEXT, last_attempted_at TEXT, next_attempt_at TEXT, consecutive_failures INTEGER)");
  const queries: string[] = [];
  const statement = (query: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...args: unknown[]) => statement(query, args),
    first: async <T>() => (sqlite.prepare(query).get(...values as never[]) as T) ?? null,
    all: async <T>() => { queries.push(query); assert.match(query.trim(), /^SELECT /); return { results: sqlite.prepare(query).all(...values as never[]) as T[] }; },
    run: async () => { throw new Error("unexpected write"); },
  });
  const db: D1DatabaseLike = { prepare: query => statement(query), batch: async () => { throw new Error("unexpected batch"); } };
  return { sqlite, db, queries };
}
test("regional review is recognized but unauthorized and forged operator requests read nothing", async () => {
  assert.equal(isReviewApiPath(path), true);
  const db = { prepare: () => { throw new Error("unauthorized database access"); } } as unknown as D1DatabaseLike;
  for (const options of [{}, { trustedAccessEmail: "someone@example.com" }]) {
    const response = await handleReviewApi(request(), { VALLEY_DESK_DB: db }, options);
    assert.equal(response.status, 404);
  }
});
test("trusted review reports gaps and unknown evidence without writes or outbound collection", async () => {
  const { sqlite, db, queries } = database(); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected outbound request"); };
  try {
    const response = await handleReviewApi(request(), { VALLEY_DESK_DB: db }, trusted);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json(); assert.equal(result.status, "review-only"); assert.equal(result.publicationAuthorized, false);
    assert.equal(result.counts.coreInstitutions, 16); assert.equal(result.counts.coreInstitutionsWithNewsRegistryAttribution, 14);
    assert.equal(result.counts.coreNewsAttributionGaps, 2); assert.equal(result.counts.freshDistinctSourceHealthReceipts, 0);
    assert.equal(result.counts.qualifiedInstitutionCoverage, null); assert.equal(result.counts.peopleWithCurrentEmployment, null);
    assert.ok(result.relationships.every((row: any) => row.institutionCoverageFreshness === "unknown" && row.contentAttributionQualified === false));
    assert.equal(queries.length, 2); assert.ok(queries.every(query => !/last_error|markup|email|profile|content_candidates/.test(query)));
    assert.ok(Math.abs(Date.now() - Date.parse(result.asOf)) < 5000);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
test("Access prefix, HEAD and rejected POST preserve read-only behavior", async () => {
  const { sqlite, db, queries } = database();
  try {
    const response = await handleReviewApi(request("HEAD", "/ops/api/automation/status/regional-review"), { VALLEY_DESK_DB: db }, { ...trusted, routePrefix: "/ops/api" });
    assert.equal(response.status, 200); assert.equal(await response.text(), ""); assert.equal(queries.length, 2);
    const post = await handleReviewApi(request("POST"), { VALLEY_DESK_DB: db }, trusted);
    assert.equal(post.status, 405); assert.equal(post.headers.get("allow"), "GET, HEAD"); assert.equal(queries.length, 2);
  } finally { sqlite.close(); }
});
test("fresh parent source health never qualifies subsidiary attribution or employment", async () => {
  const { sqlite, db } = database(); const at = "2026-10-06T19:00:00Z";
  try {
    sqlite.prepare("INSERT INTO source_health VALUES (?, ?, ?, ?)").run("ofs-penn-news", "healthy", at, at);
    const result = await regionalEvidenceReviewPayload(db, at);
    assert.equal(result.counts.freshDistinctSourceHealthReceipts, 1);
    for (const id of ["inst-penn-princeton", "inst-penn-doylestown"]) {
      const row = result.coreNews.find(row => row.institutionId === id)!;
      assert.equal(row.attributionState, "attribution-gap"); assert.equal(row.institutionCoverageFreshness, "unknown"); assert.equal(row.contentAttributionQualified, false);
    }
    assert.equal(result.counts.peopleWithCurrentEmployment, null);
  } finally { sqlite.close(); }
});
test("daily operational and generic freshness clocks remain separate", async () => {
  const { sqlite, db } = database(); const source = coveragePack.sources.find(row => row.cadence === "daily" && !row.kind.startsWith("linkedin"))!;
  const success = "2026-10-05T16:00:00Z", at = "2026-10-06T19:00:00Z";
  try {
    sqlite.prepare("INSERT INTO source_health VALUES (?, ?, ?, ?)").run(source.id, "healthy", success, success);
    sqlite.prepare("INSERT INTO scheduled_source_state VALUES (?, ?, ?, ?, ?, ?)").run(source.id, "healthy", success, success, "2026-10-07T16:00:00Z", 0);
    const result = await regionalEvidenceReviewPayload(db, at); const row = result.sources.find(row => row.sourceId === source.id)!;
    assert.equal(row.sourceHealth.freshness, "fresh"); assert.equal(row.leadershipOperational!.freshness, "stale");
    assert.equal(row.leadershipOperational!.budgetMs, 26 * 3600000); assert.equal(row.sourceHealth.budgetMs, 48 * 3600000);
  } finally { sqlite.close(); }
});
test("invalid receipt state fails closed without raw provider errors", async () => {
  const { sqlite, db } = database();
  try {
    sqlite.prepare("INSERT INTO source_health VALUES (?, ?, ?, ?)").run("ofs-penn-news", "private-secret-marker", "2026-10-06T19:00:00Z", null);
    const response = await handleReviewApi(request(), { VALLEY_DESK_DB: db }, trusted);
    assert.equal(response.status, 503); const text = await response.text(); assert.ok(!text.includes("private-secret-marker")); assert.match(text, /regional-evidence-review-unavailable/);
  } finally { sqlite.close(); }
});
test("oversized receipts fail closed rather than imply complete coverage", async () => {
  const { sqlite, db } = database();
  try {
    const insert = sqlite.prepare("INSERT INTO source_health VALUES (?, 'healthy', '2026-10-06T19:00:00Z', NULL)");
    for (let i = 0; i < 1001; i++) insert.run("source-extra-" + i);
    const response = await handleReviewApi(request(), { VALLEY_DESK_DB: db }, trusted);
    assert.equal(response.status, 503);
  } finally { sqlite.close(); }
});
