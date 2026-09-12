import assert from "node:assert/strict";
import test from "node:test";
import { WatchPublicRecord, canonicalJson, sha256, watchDraftDigest, acceptedFactDigest } from "../src/content/watch-schema";
import { projectPolicyDossier, projectTechnologyProfile } from "../src/content/watch-projection";
import { readWatchUpdates, handleWatchUpdatesRead } from "../src/ingest/watch-updates-api";
import { applyReviewedWatchProjection, expireWatchGenerations, withdrawWatchSubject } from "../src/ingest/watch-persistence";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { compileWatchDelivery, compiledWatchDeliveryValue } from "../src/content/watch-delivery";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { stageSyntheticDelivery, syntheticDeliveryForRecord } from "./fixtures/watch-delivery/synthetic";
import type { D1DatabaseLike } from "../src/ingest/persistence";
const policyFixture = await syntheticFixture("policy");
const policy = await projectPolicyDossier(policyFixture.draft, policyFixture.context);
const techFixture = await syntheticFixture("technology");
const technology = await projectTechnologyProfile(techFixture.draft, techFixture.context);
const now = new Date(NOW);
async function publish(db: D1DatabaseLike, id: string, day: string, kind: "policy" | "technology" = "policy", dated = true) {
  const value = WatchPublicRecord.parse({ ...structuredClone(kind === "policy" ? policy : technology), id, slug: "synthetic-" + id, title: id });
  if (value.kind === "policy") {
    assert.ok(value.latestAction);
    value.latestAction.value.sourceOccurredAt = { ...value.latestAction.value.sourceOccurredAt, precision: "day", value: day } as typeof value.latestAction.value.sourceOccurredAt;
    value.timeline = [structuredClone(value.latestAction)];
  } else {
    const artifact = value.artifacts[0].value;
    const oldId = artifact.id; artifact.id = id + "-artifact";
    for (const item of value.localRelationships) {
      item.value.id = id + "-relationship";
      if (item.value.artifactId === oldId) item.value.artifactId = artifact.id;
    }
    for (const item of value.licenses) if (item.value.artifactId === oldId) item.value.artifactId = artifact.id;
    artifact.artifactType = "release";
    if (dated) artifact.sourceOccurredAt = { precision: "day", value: day, timezone: null, timezoneReason: "Synthetic source has day precision", evidenceIds: ["evidence-f-artifact"] };
    else artifact.artifactType = "repository";
  }
  let delivery = await syntheticDeliveryForRecord(value);
  if (delivery.fixture.draft.kind === "policy") {
    const timelineFact = { ...structuredClone(delivery.fixture.facts.get("f-action")!), id: "f-timeline", field: "timeline-action" };
    delivery.fixture.facts.set(timelineFact.id, timelineFact);
    delivery.fixture.draft.timelineFactIds = [timelineFact.id];
    delivery.context.acceptance = { ...delivery.context.acceptance!, draftSha256: await watchDraftDigest(delivery.fixture.draft),
      factDigests: [...delivery.context.acceptance!.factDigests, { id: timelineFact.id, sha256: await acceptedFactDigest(timelineFact) }] };
    const handle = await compileWatchDelivery(delivery.fixture.draft, delivery.context);
    delivery = { ...delivery, handle, ...compiledWatchDeliveryValue(handle) };
  }
  const json = canonicalJson(delivery.record), hash = await sha256(json), decision = "review-" + id;
  await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,?,?,?,1,?,?)")
    .bind(id, kind, "synthetic:" + id, value.slug, hash, NOW).run();
  await db.prepare("INSERT INTO watch_reviewed_projections(id,subject_id,input_revision,input_sha256,expected_public_revision,payload_sha256,payload_json,reviewer_id,gate_version,reviewed_at) VALUES(?,?,1,?,0,?,?,?,'synthetic-qualified-gates-v1',?)")
    .bind(decision, id, hash, hash, json, "synthetic-editor", NOW).run();
  await stageSyntheticDelivery(db, decision, delivery.handle);
  await applyReviewedWatchProjection(db, decision, now);
  return delivery;
}
test("Latest orders accepted source actions, deduplicates timeline/latest, and holds invalid evidence before LIMIT", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  assert.equal((await readWatchUpdates(db, { kind: "policy" }, now)).items.length, 0);
  await publish(db, "older", "2026-09-01");
  await publish(db, "newer", "2026-09-02");
  await publish(db, "future", "2027-01-01");
  const first = await readWatchUpdates(db, { kind: "policy", limit: 1 }, now);
  assert.deepEqual(first.items.map(item => item.subjectId), ["newer"]); assert.ok(first.nextCursor);
  const second = await readWatchUpdates(db, { kind: "policy", limit: 1, cursor: first.nextCursor }, now);
  assert.deepEqual(second.items.map(item => item.subjectId), ["older"]); assert.equal(second.nextCursor, null);
  await assert.rejects(readWatchUpdates(db, { kind: "technology", cursor: first.nextCursor }, now), /filter-conflict/);
  const bad = await publish(db, "held", "2026-09-03");
  const group = bad.manifest.groups.find(group => group.field === "latest-action")!;
  const dep = group.dependencies.find(dep => dep.kind === "evidence")!;
  const head = sqlite.prepare("SELECT revision FROM watch_dependency_heads WHERE dependency_key=?").get(dep.key)!;
  await recordWatchDependencyHead(db, { key: dep.key, kind: dep.kind, digest: null, revision: Number(head.revision) + 1,
    immutableRecordId: "synthetic-held-action", changedAt: NOW });
  assert.equal((await readWatchUpdates(db, { kind: "policy", limit: 1 }, now)).items[0].subjectId, "newer");
  await withdrawWatchSubject(db, { subjectId: "newer", reason: "Synthetic withdrawal", reviewerId: "synthetic-editor", withdrawnAt: NOW });
  assert.equal((await readWatchUpdates(db, { kind: "policy", limit: 1 }, now)).items[0].subjectId, "older");
  await expireWatchGenerations(db, 4);
  await assert.rejects(readWatchUpdates(db, { kind: "policy", cursor: first.nextCursor }, now), /expired/);
});
test("Latest technology requires accepted release source date and live regional authority", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await publish(db, "release", "2026-09-01", "technology");
  await publish(db, "baseline", "2026-09-03", "technology", false);
  await publish(db, "future-release", "2027-01-01", "technology");
  const page = await readWatchUpdates(db, { kind: "technology" }, now);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].type, "software-release");
  assert.equal(page.items[0].sourceOccurredAt.precision, "day");
  const group = delivery.manifest.groups.find(group => group.field === "local-relationship")!;
  const dep = group.dependencies.find(dep => dep.kind === "accepted-fact")!;
  const head = sqlite.prepare("SELECT revision FROM watch_dependency_heads WHERE dependency_key=?").get(dep.key)!;
  await recordWatchDependencyHead(db, { key: dep.key, kind: dep.kind, digest: null, revision: Number(head.revision) + 1,
    immutableRecordId: "synthetic-held-region", changedAt: NOW });
  assert.equal((await readWatchUpdates(db, { kind: "technology" }, now)).items.length, 0);
});
test("Updates query runs on real local D1 with accepted manifest authority", { timeout: 120000 }, async t => {
  const proxy = await getPlatformProxy<{ WATCH_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL("./fixtures/watch-d1/wrangler.jsonc", import.meta.url)), envFiles: [], persist: false, remoteBindings: false });
  t.after(() => proxy.dispose()); const db = proxy.env.WATCH_TEST_DB;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort())
    await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name, migrations), "utf8")).map(sql => db.prepare(sql)));
  await publish(db, "d1-policy", "2026-09-01");
  const page = await readWatchUpdates(db, { kind: "policy", limit: 1 }, now);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].subjectId, "d1-policy");
  assert.equal(page.nextCursor, null);
});
test("Updates endpoint is read-only, bounded, strict, and does not disclose storage errors", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const env = { VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true" };
  const url = "https://example.test/api/v2/watch/policy/updates";
  assert.equal((await handleWatchUpdatesRead(new Request(url), {})).status, 503);
  assert.equal((await handleWatchUpdatesRead(new Request(url, { method: "POST" }), env)).status, 405);
  for (const query of ["?q=noop", "?limit=0", "?limit=1&limit=2", "?cursor=broken"])
    assert.equal((await handleWatchUpdatesRead(new Request(url + query), env)).status, 400);
  const response = await handleWatchUpdatesRead(new Request(url + "?limit=1"), env);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const head = await handleWatchUpdatesRead(new Request(url, { method: "HEAD" }), env);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});
