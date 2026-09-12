import assert from "node:assert/strict";
import test from "node:test";
import { WatchPublicRecord, canonicalJson, sha256 } from "../src/content/watch-schema";
import { projectPolicyDossier, projectTechnologyProfile } from "../src/content/watch-projection";
import { applyReviewedWatchProjection, expireWatchGenerations, readWatchDirectory, readWatchSubject,
  WatchDirectoryQuery, WatchStorageError, withdrawWatchSubject } from "../src/ingest/watch-persistence";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { handleWatchRead } from "../src/ingest/watch-api";
import worker from "../worker.js";

const at = () => new Date(NOW);
const policyFixture = await syntheticFixture("policy");
const policy = await projectPolicyDossier(policyFixture.draft, policyFixture.context);
const technologyFixture = await syntheticFixture("technology");
const technology = await projectTechnologyProfile(technologyFixture.draft, technologyFixture.context);
const fingerprint = await sha256("synthetic-persisted-input-v1");
const changedFingerprint = await sha256("synthetic-persisted-input-v2");
const errorCode = (code: string) => (error: unknown) => error instanceof WatchStorageError && error.code === code;

// SQL-layer fixtures intentionally manufacture reviewed records. This is not
// an editorial approval path; the projection suite tests accepted fact binding.
function record(id: string, title = id, kind: "policy" | "technology" = "policy") {
  return WatchPublicRecord.parse({ ...structuredClone(kind === "policy" ? policy : technology), id,
    slug: `synthetic-${id}`, title });
}
async function review(db: D1DatabaseLike, value: WatchPublicRecord, decisionId = `review-${value.id}`,
  inputRevision = 1, publicRevision = 0, inputHash = fingerprint, payload: unknown = value) {
  await db.prepare(`INSERT OR IGNORE INTO watch_subjects
    (id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(value.id, value.kind, `synthetic:${value.id}`, value.slug, inputRevision, inputHash, NOW).run();
  const json = canonicalJson(payload);
  await db.prepare(`INSERT INTO watch_reviewed_projections
    (id,subject_id,input_revision,input_sha256,expected_public_revision,payload_sha256,payload_json,reviewer_id,gate_version,reviewed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(decisionId, value.id, inputRevision, inputHash, publicRevision,
      await sha256(json), json, "synthetic-editor", "synthetic-qualified-gates-v1", NOW).run();
  return decisionId;
}
async function publish(db: D1DatabaseLike, id: string, title = id, kind: "policy" | "technology" = "policy") {
  const value = record(id, title, kind);
  await applyReviewedWatchProjection(db, await review(db, value), at());
  return value;
}
function count(sqlite: ReturnType<typeof pdfDatabase>["sqlite"], table: string) {
  return Number(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
}

test("Watch migration is additive and unaccepted subjects never enter public reads", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await review(db, record("unaccepted"));
  assert.deepEqual(await readWatchDirectory(db, { kind: "policy" }), {
    version: "watch-directory-1", generation: 0, asOf: null, items: [], nextCursor: null,
  });
  assert.equal(await readWatchSubject(db, "policy", "unaccepted"), null);
  for (const table of ["policy_instruments", "policy_versions", "policy_pdf_artifacts", "published_content"]) assert.equal(count(sqlite, table), 0);
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("accepted revision, audit and generation commit together and exact replay is idempotent", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const value = await publish(db, "one", "One source-backed subject");
  assert.deepEqual(await applyReviewedWatchProjection(db, "review-one", at()), { outcome: "unchanged", generation: 1 });
  assert.deepEqual(await readWatchSubject(db, "policy", "one"), value);
  assert.deepEqual(await readWatchSubject(db, "policy", value.slug, "slug"), value);
  assert.equal(await readWatchSubject(db, "policy", value.slug), null);
  assert.equal(await readWatchSubject(db, "technology", "one"), null);
  assert.equal(count(sqlite, "watch_publication_decisions"), 1);
  assert.equal(count(sqlite, "watch_public_revisions"), 1);
  assert.equal(sqlite.prepare("SELECT public_revision FROM watch_subjects").get()!.public_revision, 1);
});

test("current subject evidence and revision are rechecked inside the transaction", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await review(db, record("stale"));
  const interleaved: D1DatabaseLike = { prepare: query => db.prepare(query), async batch(statements) {
    await db.prepare("UPDATE watch_subjects SET input_revision=2,input_sha256=? WHERE id='stale'").bind(changedFingerprint).run();
    return db.batch(statements);
  } };
  await assert.rejects(applyReviewedWatchProjection(interleaved, "review-stale", at()), errorCode("watch-stale-acceptance"));
  assert.equal(count(sqlite, "watch_public_revisions"), 0);
  assert.equal(count(sqlite, "watch_publication_decisions"), 0);
  assert.equal(sqlite.prepare("SELECT generation FROM watch_read_state").get()!.generation, 0);
});

test("a second decision for the same old public revision cannot overwrite acceptance", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const value = record("racing");
  await review(db, value, "first-review"); await review(db, value, "second-review");
  await applyReviewedWatchProjection(db, "first-review", at());
  await assert.rejects(applyReviewedWatchProjection(db, "second-review", at()), errorCode("watch-stale-acceptance"));
  assert.equal(count(sqlite, "watch_public_revisions"), 1);
  assert.equal(sqlite.prepare("SELECT generation FROM watch_read_state").get()!.generation, 1);
});

test("failure in the final write rolls back earlier revision and generation changes", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await review(db, record("atomic"));
  sqlite.exec("CREATE TABLE synthetic_failure(value INTEGER CHECK(value=1))");
  const failing: D1DatabaseLike = { prepare: query => db.prepare(query),
    batch: statements => db.batch([...statements, db.prepare("INSERT INTO synthetic_failure VALUES(0)")]) };
  await assert.rejects(applyReviewedWatchProjection(failing, "review-atomic", at()));
  assert.equal(count(sqlite, "watch_public_revisions"), 0);
  assert.equal(count(sqlite, "watch_publication_decisions"), 0);
  assert.equal(count(sqlite, "watch_generations"), 1);
  assert.equal(sqlite.prepare("SELECT generation FROM watch_read_state").get()!.generation, 0);
});

test("directory cursors keep the old revision and membership across title edits and inserts", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "a", "Alpha"); await publish(db, "b", "Beta"); await publish(db, "z", "Zeta");
  const first = await readWatchDirectory(db, { kind: "policy", limit: 1 });
  assert.deepEqual(first.items.map(row => row.title), ["Alpha"]); assert.ok(first.nextCursor);
  await db.prepare("UPDATE watch_subjects SET input_revision=2,input_sha256=? WHERE id='b'").bind(changedFingerprint).run();
  await review(db, record("b", "Aardvark"), "review-b-v2", 2, 1, changedFingerprint);
  await applyReviewedWatchProjection(db, "review-b-v2", at());
  await publish(db, "new", "Between");
  const second = await readWatchDirectory(db, { kind: "policy", limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(row => row.title), ["Beta"]); assert.equal(second.generation, first.generation);
  const third = await readWatchDirectory(db, { kind: "policy", limit: 1, cursor: second.nextCursor });
  assert.deepEqual(third.items.map(row => row.title), ["Zeta"]); assert.equal(third.nextCursor, null);
  assert.deepEqual((await readWatchDirectory(db, { kind: "policy" })).items.map(row => row.title), ["Aardvark", "Alpha", "Between", "Zeta"]);
});

test("equal titles use immutable subject ID as a tie-breaker", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "c", "Same"); await publish(db, "a", "Same"); await publish(db, "b", "Same");
  const one = await readWatchDirectory(db, { kind: "policy", limit: 2 });
  const two = await readWatchDirectory(db, { kind: "policy", limit: 2, cursor: one.nextCursor });
  assert.deepEqual([...one.items, ...two.items].map(row => row.id), ["a", "b", "c"]);
});

test("current tombstones override old cursors and ingestion cannot restore a withdrawn subject", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "a", "Alpha"); await publish(db, "b", "Beta"); await publish(db, "c", "Charlie");
  const first = await readWatchDirectory(db, { kind: "policy", limit: 1 });
  const withdrawal = { subjectId: "b", reason: "Synthetic withdrawal", reviewerId: "fixture-editor", withdrawnAt: NOW };
  assert.deepEqual(await withdrawWatchSubject(db, withdrawal), { outcome: "withdrawn" });
  assert.deepEqual(await withdrawWatchSubject(db, withdrawal), { outcome: "unchanged" });
  const next = await readWatchDirectory(db, { kind: "policy", limit: 1, cursor: first.nextCursor });
  assert.deepEqual(next.items.map(row => row.id), ["c"]);
  assert.equal(await readWatchSubject(db, "policy", "b"), null);
  await review(db, record("b", "Restored?"), "review-b-again", 1, 1);
  await assert.rejects(applyReviewedWatchProjection(db, "review-b-again", at()), errorCode("watch-stale-acceptance"));
  assert.equal(count(sqlite, "watch_delivery_tombstones"), 1);
});

test("retention expires cursors explicitly and preserves current accepted rows", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "a", "Alpha"); await publish(db, "b", "Beta");
  const page = await readWatchDirectory(db, { kind: "policy", limit: 1 });
  await publish(db, "c", "Charlie");
  await expireWatchGenerations(db, 3);
  await assert.rejects(readWatchDirectory(db, { kind: "policy", limit: 1, cursor: page.nextCursor }), errorCode("watch-cursor-expired"));
  assert.equal((await readWatchDirectory(db, { kind: "policy" })).items.length, 3);
  assert.deepEqual(await expireWatchGenerations(db, 1), { minimumGeneration: 3 });
  await assert.rejects(expireWatchGenerations(db, 4), errorCode("watch-invalid-retention-generation"));
});

test("filter binding prevents reusing a cursor for another query, size or desk", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "a", "Alpha"); await publish(db, "b", "Beta");
  const page = await readWatchDirectory(db, { kind: "policy", limit: 1 });
  for (const query of [{ kind: "technology", limit: 1 }, { kind: "policy", limit: 2 }, { kind: "policy", limit: 1, q: "Beta" }]) {
    await assert.rejects(readWatchDirectory(db, { ...query, cursor: page.nextCursor }), errorCode("watch-cursor-filter-conflict"));
  }
  for (const cursor of ["%", "not-json", "x".repeat(2048)]) await assert.rejects(readWatchDirectory(db, { kind: "policy", cursor }), errorCode("watch-invalid-cursor"));
});

test("directory queries reject unknown/cross-desk filters and out-of-bounds limits", () => {
  for (const change of [{ limit: 0 }, { limit: 51 }, { limit: "1e1" }, { limit: "01" }, { limit: " 1" }, { limit: true }, { q: "x".repeat(121) },
    { jurisdiction: "NY" }, { stage: "enacted-ish" }, { organization: "local" }, { unknown: "value" }]) {
    assert.equal(WatchDirectoryQuery.safeParse({ kind: "policy", ...change }).success, false, JSON.stringify(change));
  }
  assert.equal(WatchDirectoryQuery.parse({ kind: "policy", limit: "20" }).limit, 20);
});

test("search treats SQL wildcards literally and technology filters use accepted DTO fields", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "percent", "100%_ backed"); await publish(db, "normal", "100xy backed");
  assert.deepEqual((await readWatchDirectory(db, { kind: "policy", q: "%_" })).items.map(row => row.id), ["percent"]);
  await publish(db, "tech", "Synthetic local research", "technology");
  assert.equal((await readWatchDirectory(db, { kind: "technology", type: "software", organization: "regional-lab", license: "restricted-source" })).items.length, 1);
  assert.equal((await readWatchDirectory(db, { kind: "technology", license: "osi-open-source" })).items.length, 0);
  assert.equal((await readWatchDirectory(db, { kind: "policy", jurisdiction: "NJ" })).items.length, 0);
});

test("unreviewed IDs, private fields, bad checksums and future review times cannot publish", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await assert.rejects(applyReviewedWatchProjection(db, "missing", at()), errorCode("watch-review-not-found"));
  const value = record("private");
  await review(db, value, "private-review", 1, 0, fingerprint, { ...value, internalNotes: "must not escape" });
  await assert.rejects(applyReviewedWatchProjection(db, "private-review", at()), errorCode("watch-projection-invalid"));
  await review(db, record("future"));
  await db.prepare(`INSERT INTO watch_reviewed_projections
    SELECT 'bad-checksum',subject_id,input_revision,input_sha256,expected_public_revision,?,payload_json,reviewer_id,gate_version,reviewed_at
    FROM watch_reviewed_projections WHERE id='review-future'`).bind(changedFingerprint).run();
  await assert.rejects(applyReviewedWatchProjection(db, "bad-checksum", at()), errorCode("watch-projection-invalid"));
  await assert.rejects(applyReviewedWatchProjection(db, "review-future", new Date("2026-09-10T00:00:00.000Z")), errorCode("watch-review-time-conflict"));
  assert.equal(count(sqlite, "watch_public_revisions"), 0);
  assert.throws(() => sqlite.exec("UPDATE watch_reviewed_projections SET gate_version='changed'"), /watch-review-immutable/);
});

test("the OSS directory filter requires accepted code eligibility, not a data-only license", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const dataOnly = record("data-only-osi", "Data-only licensed artifact", "technology");
  assert.equal(dataOnly.kind, "technology");
  if (dataOnly.kind !== "technology") throw new Error("fixture kind");
  dataOnly.licenses[0]!.value.scope = "data";
  dataOnly.licenses[0]!.value.classification = "osi-open-source";
  dataOnly.licenses[0]!.value.spdxId = "MIT";
  dataOnly.licenseClassifications = ["osi-open-source"];
  dataOnly.oss = false;
  await applyReviewedWatchProjection(db, await review(db, dataOnly), at());
  assert.equal((await readWatchDirectory(db, { kind: "technology" })).items.length, 1);
  assert.deepEqual((await readWatchDirectory(db, { kind: "technology", license: "osi-open-source" })).items, []);
});

test("accepted history cannot be overwritten and database errors are not healthy empty results", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "one");
  assert.throws(() => sqlite.exec("UPDATE watch_public_revisions SET title_key='changed'"), /watch-public-revision-immutable/);
  const unavailable: D1DatabaseLike = { prepare() { throw Error("synthetic database unavailable"); }, batch() { throw Error("unavailable"); } };
  await assert.rejects(readWatchDirectory(unavailable, { kind: "policy" }), /database unavailable/);
});

test("Watch API is disabled by default and never treats missing database as empty", async () => {
  const request = new Request("https://thevalleydesk.org/api/v2/watch/policy");
  const closed = await handleWatchRead(request, {});
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error.code, "watch-not-enabled");
  assert.equal((await handleWatchRead(request, { WATCH_PUBLIC_ENABLED: "true" })).status, 503);
  assert.equal((await handleWatchRead(new Request(request.url, { method: "POST" }), {})).status, 405);
});

test("Watch API returns strict accepted directory/detail envelopes and proper HEAD responses", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const value = await publish(db, "api", "Accepted API fixture");
  const env = { VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true" };
  const list = await handleWatchRead(new Request("https://thevalleydesk.org/api/v2/watch/policy?jurisdiction=PA"), env);
  assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store");
  assert.equal(list.headers.get("x-watch-data-state"), "unknown");
  assert.deepEqual((await list.json()).items, [value]);
  const detailUrl = `https://thevalleydesk.org/api/v2/watch/policy/${value.slug}?lookup=slug`;
  const detail = await handleWatchRead(new Request(detailUrl), env);
  assert.equal(detail.status, 200);
  const detailPayload = await detail.json();
  assert.deepEqual(detailPayload.item, value);
  assert.equal(detailPayload.asOf, NOW);
  assert.notEqual(detailPayload.asOf, value.verifiedAt);
  const head = await handleWatchRead(new Request(detailUrl, { method: "HEAD" }), env);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal((await handleWatchRead(new Request("https://thevalleydesk.org/api/v2/watch/policy/missing"), env)).status, 404);
});

test("Watch API rejects duplicate/unknown filters and hides internal database errors", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const env = { VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true" };
  for (const query of ["q=one&q=two", "limit=51", "kind=technology", "unknown=value", "jurisdiction=NY", "__proto__=x"]) {
    assert.equal((await handleWatchRead(new Request(`https://thevalleydesk.org/api/v2/watch/policy?${query}`), env)).status, 400, query);
  }
  const unavailable = { ...env, VALLEY_DESK_DB: { prepare() { throw Error("private-database-detail"); }, async batch() { return []; } } };
  const failure = await handleWatchRead(new Request("https://thevalleydesk.org/api/v2/watch/policy"), unavailable);
  assert.equal(failure.status, 503); assert.equal((await failure.text()).includes("private-database-detail"), false);
});

test("Worker wires Watch reads without touching v1 feed or requiring a write credential", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await publish(db, "worker", "Worker accepted fixture");
  const response = await worker.fetch(new Request("https://thevalleydesk.org/api/v2/watch/policy"), {
    VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true", PUBLIC_ORIGIN: "https://thevalleydesk.org",
  }, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].id, "worker");
  assert.equal(count(sqlite, "published_content"), 0);
});
