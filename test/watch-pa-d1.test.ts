import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { launchCandidate } from "../fixtures/watch-launch-candidates";
import { qualifyCapturedWatchSource } from "../scripts/lib/watch-source-qualification";
import { configureWatchCollectionSource } from "../src/ingest/watch/collection-storage";
import { runWatchCollection } from "../src/ingest/watch/collector";
import { readWatchDirectory } from "../src/ingest/watch-persistence";
import type { D1DatabaseLike } from "../src/ingest/persistence";

test("historical PA bytes with synthetic authority traverse real local D1 native acceptance, search and unchanged refresh", { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ WATCH_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL("./fixtures/watch-d1/wrangler.jsonc", import.meta.url)),
    envFiles: [], persist: false, remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const db = proxy.env.WATCH_TEST_DB, migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name, migrations), "utf8")).map(sql => db.prepare(sql)));
  }
  const candidate = launchCandidate("candidate-pa-hb1925").source;
  const bytes = new Uint8Array(readFileSync(new URL("./fixtures/pa-legislation/captured-hb1925-20260906.html", import.meta.url)));
  const at = "2026-09-30T12:00:00.000Z";
  // These repeated historical bytes and named approvals are synthetic test state,
  // never current access qualification or evidence of production PA coverage.
  const qualified = await qualifyCapturedWatchSource({ ...candidate, id: "synthetic-pa-d1", name: "Synthetic PA D1 qualification" },
    ["2026-09-28T00:00:00.000Z", "2026-09-29T00:00:00.000Z"].map(capturedAt => ({ endpoint: candidate.endpoints[0], capturedAt, bytes })),
    { engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor",
      statement: "Synthetic offline approvals for retained historical PA bytes in an ephemeral local D1 regression only.",
      reviewedAt: at, expiresAt: "2026-10-01T00:00:00.000Z", rightsDecision: "accepted", accessDecision: "public-or-authorized-read" });
  const { source, qualification, review } = qualified;
  await db.prepare("INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)").bind(review.id,
    review.engineeringOwnerId, review.editorialOwnerId, review.evidenceSha256, review.qualificationSha256, review.acceptedAt).run();
  await configureWatchCollectionSource(db, { source, qualification, activationId: "synthetic-pa-d1-activation",
    cadenceSeconds: 60, expectedRevision: 0 }, at);
  const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(at),
    fetchImpl: async () => new Response(bytes, { headers: { etag: '"synthetic-d1-pa"' } }) });
  assert.equal(result.sources[0].state, "healthy", JSON.stringify(result));
  assert.equal(result.sources[0].health.lastSuccessAt, at);
  for (const q of ["HB1925", "HB 1925", "artificial intelligence"]) {
    const page = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA", q }, new Date(at));
    assert.equal(page.items.length, 1, q);
    assert.ok(page.items[0].kind === "policy");
    assert.equal(page.items[0].legalEffect, "unknown"); assert.equal(page.items[0].lifecycle, "unknown");
  }
  const later = "2026-09-30T12:02:00.000Z";
  await db.prepare("UPDATE watch_collection_state SET next_due_at=?").bind(later).run();
  const refreshed = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(later),
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("if-none-match"), '"synthetic-d1-pa"');
      return new Response(null, { status: 304 });
    } });
  assert.equal(refreshed.sources[0].state, "healthy"); assert.equal(refreshed.sources[0].health.lastSuccessAt, later);
  const page = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA" }, new Date(later));
  assert.equal(page.items.length, 1); assert.equal(page.asOf, at); assert.equal(page.items[0].verifiedAt, at);
  for (const table of ["policy_watch_captures", "watch_editorial_drafts", "watch_editorial_decisions", "watch_public_revisions"]) {
    assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n, 1, table);
  }
  assert.equal((await db.prepare("SELECT retrieved_at FROM policy_watch_captures").first<{ retrieved_at: string }>())!.retrieved_at, at);
  assert.equal((await readWatchDirectory(db, { kind: "policy" }, new Date("2026-10-01T00:00:00.000Z"))).items.length, 0);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
});
