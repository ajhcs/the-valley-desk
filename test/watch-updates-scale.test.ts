import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { projectPolicyDossier } from "../src/content/watch-projection";
import { readWatchUpdates } from "../src/ingest/watch-updates-api";
import { applyReviewedWatchProjection } from "../src/ingest/watch-persistence";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { stageSyntheticDelivery, syntheticDeliveryForRecord } from "./fixtures/watch-delivery/synthetic";
import type { D1DatabaseLike } from "../src/ingest/persistence";

// Offline synthetic scale qualification, not editorial/source/model evaluation.
test("Watch Updates: 1000 synthetic accepted subjects preserve bounded pages and pre-LIMIT invalidation", { timeout: 240000 }, async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const fixture = await syntheticFixture("policy");
  const base = await projectPolicyDossier(fixture.draft, fixture.context);
  const now = new Date(NOW), started = performance.now();
  const actionDependencies: Array<{ key: string; kind: "evidence"; expectedDigest: string }> = [];
  for (let index = 0; index < 1000; index++) {
    const id = `scale-policy-${String(index).padStart(4, "0")}`;
    const record = structuredClone(base); record.id = id; record.slug = id; record.title = `Synthetic policy ${index}`;
    assert.ok(record.latestAction);
    record.latestAction.value.id = `${id}-action`;
    record.latestAction.value.sourceOccurredAt = { precision: "day", value: "2026-09-01", timezone: null,
      timezoneReason: "Synthetic scale fixture has day precision", evidenceIds: record.latestAction.evidenceIds };
    const delivery = await syntheticDeliveryForRecord(record);
    const json = canonicalJson(delivery.record), hash = await sha256(json), decision = `scale-review-${index}`;
    await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,'policy',?,?,1,?,?)")
      .bind(id, `synthetic:${id}`, id, hash, NOW).run();
    await db.prepare("INSERT INTO watch_reviewed_projections(id,subject_id,input_revision,input_sha256,expected_public_revision,payload_sha256,payload_json,reviewer_id,gate_version,reviewed_at) VALUES(?,?,1,?,0,?,?,'synthetic-editor','synthetic-qualified-gates-v1',?)")
      .bind(decision, id, hash, hash, json, NOW).run();
    await stageSyntheticDelivery(db, decision, delivery.handle);
    await applyReviewedWatchProjection(db, decision, now);
    const dependency = delivery.manifest.groups.find(group => group.field === "latest-action")!.dependencies.find(dep => dep.kind === "evidence")!;
    actionDependencies.push({ ...dependency, kind: "evidence" });
  }
  // Source history includes invalidation/restoration, without forging current heads.
  for (let index = 0; index < 100; index++) {
    const dependency = actionDependencies[index]!;
    for (const [revision, digest] of [[2, null], [3, dependency.expectedDigest]] as const)
      await recordWatchDependencyHead(db, { key: dependency.key, kind: dependency.kind, revision, digest,
        immutableRecordId: `scale-history-${index}-${revision}`, changedAt: NOW });
  }
  const seedMilliseconds = performance.now() - started;
  const queries: Array<{ milliseconds: number; rows: number; plan: unknown[] }> = [];
  const measured: D1DatabaseLike = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!sql.startsWith("WITH clock AS")) return statement;
      return {
        ...statement,
        bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return {
            first: bound.first.bind(bound), run: bound.run.bind(bound), bind: bound.bind.bind(bound),
            async all<T>() {
              const plan = sqlite.prepare("EXPLAIN QUERY PLAN " + sql).all(...values as never[]);
              const before = performance.now(), result = await bound.all<T>();
              queries.push({ milliseconds: performance.now() - before, rows: result.results?.length ?? 0, plan });
              return result;
            },
          };
        },
        first: statement.first.bind(statement), run: statement.run.bind(statement), all: statement.all.bind(statement),
      };
    },
  };
  const samples: Array<{ milliseconds: number; bytes: number; items: number }> = [];
  let cursor: string | undefined;
  for (let index = 0; index < 3; index++) {
    const before = performance.now();
    const page = await readWatchUpdates(measured, { kind: "policy", limit: 50, ...(cursor ? { cursor } : {}) }, now);
    const bytes = new TextEncoder().encode(JSON.stringify(page)).length;
    samples.push({ milliseconds: performance.now() - before, bytes, items: page.items.length });
    assert.ok(bytes <= 1000000); assert.ok(page.items.length > 0 && page.items.length <= 50); assert.ok(page.nextCursor);
    cursor = page.nextCursor!;
  }
  // The first 60 sorts are held: a page must still fill from later valid rows.
  for (let index = 0; index < 60; index++) {
    const dependency = actionDependencies[index]!;
    await recordWatchDependencyHead(db, { key: dependency.key, kind: dependency.kind, revision: 4, digest: null,
      immutableRecordId: `scale-held-${index}`, changedAt: NOW });
  }
  const held = await readWatchUpdates(measured, { kind: "policy", limit: 1 }, now);
  assert.deepEqual(held.items.map(item => item.subjectId), ["scale-policy-0060"]);
  assert.ok(held.nextCursor);
  assert.ok(queries.every(query => query.rows <= 51));
  console.log(JSON.stringify({ qualification: "offline-synthetic-sqlite-not-cloudflare-cpu", subjects: 1000,
    node: process.version, sqlite: sqlite.prepare("SELECT sqlite_version() AS version").get(),
    publicRevisions: sqlite.prepare("SELECT count(*) AS count FROM watch_public_revisions").get(),
    dependencyRecords: sqlite.prepare("SELECT count(*) AS count FROM watch_dependency_records").get(),
    seedMilliseconds, samples, queries: queries.map(({ milliseconds, rows }) => ({ milliseconds, rows })),
    queryPlan: queries[0]!.plan }, null, 2));
});
