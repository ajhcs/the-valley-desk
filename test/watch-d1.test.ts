import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { canonicalJson, sha256, WatchPublicRecord } from "../src/content/watch-schema";
import { projectPolicyDossier } from "../src/content/watch-projection";
import { applyReviewedWatchProjection, readWatchDirectory, readWatchSubject,
  withdrawWatchSubject } from "../src/ingest/watch-persistence";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";

test("Watch storage uses real local D1 transaction and query semantics", { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ WATCH_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL("./fixtures/watch-d1/wrangler.jsonc", import.meta.url)),
    envFiles: [], persist: false, remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const db = proxy.env.WATCH_TEST_DB;
  const migrations = new URL("../migrations/", import.meta.url);
  // Use Wrangler's own SQL splitter so trigger bodies are not split on semicolons.
  // This test-only unstable API is covered by the repository's locked Wrangler version.
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(name, migrations), "utf8");
    await db.batch(unstable_splitSqlQuery(sql).map(query => db.prepare(query)));
  }
  const fixture = await syntheticFixture("policy");
  const accepted = await projectPolicyDossier(fixture.draft, fixture.context);
  const inputHash = await sha256("local-d1-synthetic-input");
  const changedHash = await sha256("local-d1-changed-input");
  async function stage(id: string, title: string, decisionId = `review-${id}`) {
    const record = WatchPublicRecord.parse({ ...structuredClone(accepted), id, slug: `synthetic-${id}`, title });
    const payload = canonicalJson(record);
    await db.prepare(`INSERT OR IGNORE INTO watch_subjects
      (id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,'policy',?,?,1,?,?)`)
      .bind(id, `synthetic:${id}`, record.slug, inputHash, NOW).run();
    await db.prepare(`INSERT INTO watch_reviewed_projections VALUES(?,?,1,?,0,?,?,?,?,?)`)
      .bind(decisionId, id, inputHash, await sha256(payload), payload, "synthetic-editor", "synthetic-gate", NOW).run();
    return decisionId;
  }
  async function generation() {
    return (await db.prepare("SELECT generation FROM watch_read_state WHERE singleton=1").first<{ generation: number }>())!.generation;
  }

  await t.test("migration chain preserves foreign keys and existing tables", async () => {
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results!;
    for (const name of ["published_content", "policy_versions", "policy_pdf_artifacts", "watch_public_revisions"]) {
      assert.ok(tables.some(row => row.name === name), name);
    }
    assert.equal(await generation(), 0);
  });
  await t.test("a final failed D1 statement rolls the entire acceptance batch back", async () => {
    const decision = await stage("rollback", "Rollback fixture");
    const fail: D1DatabaseLike = { prepare: query => db.prepare(query), batch: statements => db.batch([
      ...statements, db.prepare("INSERT INTO watch_read_state VALUES(2,0,0)"),
    ]) };
    await assert.rejects(applyReviewedWatchProjection(fail, decision, new Date(NOW)));
    assert.equal(await generation(), 0);
    assert.equal(await readWatchSubject(db, "policy", "rollback"), null);
    assert.equal(await db.prepare("SELECT decision_id FROM watch_publication_decisions WHERE decision_id=?").bind(decision).first(), null);
  });
  await t.test("changed inputs are rejected by the database acceptance trigger", async () => {
    const decision = await stage("stale", "Stale fixture");
    await db.prepare("UPDATE watch_subjects SET input_revision=2,input_sha256=? WHERE id='stale'").bind(changedHash).run();
    await assert.rejects(applyReviewedWatchProjection(db, decision, new Date(NOW)), /watch-stale-acceptance/);
    assert.equal(await generation(), 0);
  });
  await t.test("concurrent exact replay publishes only once", async () => {
    const decision = await stage("alpha", "Alpha");
    const results = await Promise.all([applyReviewedWatchProjection(db, decision, new Date(NOW)),
      applyReviewedWatchProjection(db, decision, new Date(NOW))]);
    assert.equal(results.filter(result => result.outcome === "applied").length, 1);
    assert.equal(results.filter(result => result.outcome === "unchanged").length, 1);
    assert.equal(await generation(), 1);
  });
  await t.test("concurrent competing decisions cannot accept the same old public revision", async () => {
    const a = await stage("beta", "Beta", "beta-a");
    const b = await stage("beta", "Beta", "beta-b");
    const results = await Promise.allSettled([applyReviewedWatchProjection(db, a, new Date(NOW)),
      applyReviewedWatchProjection(db, b, new Date(NOW))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const failed = results.find(result => result.status === "rejected");
    assert.ok(failed?.status === "rejected" && String(failed.reason).includes("watch-stale-acceptance"));
    assert.equal(await generation(), 2);
  });
  await t.test("snapshot pagination excludes later inserts and respects current withdrawals", async () => {
    const first = await readWatchDirectory(db, { kind: "policy", limit: 1 });
    assert.deepEqual(first.items.map(item => item.id), ["alpha"]);
    assert.ok(first.nextCursor);
    await applyReviewedWatchProjection(db, await stage("between", "Between"), new Date(NOW));
    const next = await readWatchDirectory(db, { kind: "policy", limit: 1, cursor: first.nextCursor });
    assert.deepEqual(next.items.map(item => item.id), ["beta"]);
    assert.equal(next.nextCursor, null);
    await withdrawWatchSubject(db, { subjectId: "beta", reason: "Synthetic withdrawal", reviewerId: "synthetic-editor", withdrawnAt: NOW });
    assert.deepEqual((await readWatchDirectory(db, { kind: "policy", limit: 1, cursor: first.nextCursor })).items, []);
  });
  await t.test("directory order can use its index without a temporary sorting table", async () => {
    const queryPlan = (await db.prepare(`EXPLAIN QUERY PLAN SELECT r.subject_id,r.title_key
      FROM watch_public_revisions r WHERE r.kind=? AND r.valid_from<=?
      AND (r.valid_to IS NULL OR r.valid_to>?)
      AND NOT EXISTS (SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=r.subject_id)
      ORDER BY r.title_key,r.subject_id LIMIT ?`).bind("policy", await generation(), await generation(), 21)
      .all<{ detail: string }>()).results!.map(row => row.detail).join("\n");
    assert.match(queryPlan, /watch_directory_page/);
    assert.doesNotMatch(queryPlan, /USE TEMP B-TREE FOR ORDER BY/);
  });
});
