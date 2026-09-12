import assert from "node:assert/strict";
import test from "node:test";
import { AcceptedFactRecord, SubjectAcceptance, WatchPublicRecord, acceptedFactDigest, canonicalJson, sha256 } from "../src/content/watch-schema";
import { compileWatchDelivery, compiledWatchDeliveryValue, deliveryDependencyKey, deliveryEasternDay,
  shapeWatchDelivery, validateDeliveryBinding, WatchDeliveryManifest, WATCH_DELIVERY_MANIFEST_BYTES } from "../src/content/watch-delivery";
import { projectPolicyDossier, projectTechnologyProfile } from "../src/content/watch-projection";
import { persistCompiledWatchDelivery, recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { applyReviewedWatchProjection, readWatchDirectory, readWatchSubject, WATCH_DIRECTORY_BODY_BYTES } from "../src/ingest/watch-persistence";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import { handleWatchRead } from "../src/ingest/watch-api";
import { pdfDatabase } from "./helpers/policy-pdf";
import { HASH, NOW, OTHER_HASH, syntheticFixture, VERIFIED } from "./fixtures/watch-contracts/synthetic";
import { stageSyntheticDelivery, syntheticDeliveryForRecord } from "./fixtures/watch-delivery/synthetic";

const at = (instant = NOW) => new Date(instant);
type Delivery = Awaited<ReturnType<typeof syntheticDeliveryForRecord>>;
async function fixture(kind: "policy" | "technology" = "policy", id = `${kind}-delivery`, current = false): Promise<Delivery> {
  const source = await syntheticFixture(kind);
  const value = source.draft.kind === "policy" ? await projectPolicyDossier(source.draft, source.context) : await projectTechnologyProfile(source.draft, source.context);
  value.id = id; value.slug = `synthetic-${id}`; value.title = id;
  if (value.kind === "technology") {
    value.artifacts[0]!.value.id = `artifact-${id}`; value.artifacts[0]!.value.resourceId = id;
    value.licenses[0]!.value.artifactId = `artifact-${id}`;
    Object.assign(value.localRelationships[0]!.value, { id: `relationship-${id}`, resourceId: id, artifactId: `artifact-${id}`, entityId: `region-${id}` });
    if (current) Object.assign(value.localRelationships[0]!.value, { temporalStatus: "current", type: "used-at", validFrom: "2026-09-11", validThrough: "2026-09-13T04:00:00.000Z" });
  }
  return syntheticDeliveryForRecord(value);
}
async function stage(db: D1DatabaseLike, delivery: Delivery, id = `review-${delivery.record.id}`) {
  const record = delivery.record, payload = canonicalJson(record);
  await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,?,?,?,1,?,?)")
    .bind(record.id, record.kind, `synthetic:${record.id}`, record.slug, HASH, VERIFIED).run();
  await db.prepare("INSERT INTO watch_reviewed_projections VALUES(?,?,1,?,0,?,?,?,?,?)")
    .bind(id, record.id, HASH, await sha256(payload), payload, "synthetic-editor", delivery.manifest.gateVersion, NOW).run();
  await stageSyntheticDelivery(db, id, delivery.handle);
  return id;
}
async function updateHead(db: D1DatabaseLike, delivery: Delivery, kind: string, field?: string, digest: string | null = OTHER_HASH) {
  const dependency = delivery.manifest.groups.filter(group => !field || group.field === field).flatMap(group => group.dependencies).find(value => value.kind === kind)!;
  assert.ok(dependency, `${field ?? "any"}:${kind}`);
  const previous = await db.prepare("SELECT revision FROM watch_dependency_heads WHERE dependency_key=?").bind(dependency.key).first<{ revision: number }>();
  await recordWatchDependencyHead(db, { key: dependency.key, kind: dependency.kind, revision: (previous?.revision ?? 0) + 1,
    digest, immutableRecordId: `synthetic-update-${dependency.key}-${(previous?.revision ?? 0) + 1}`, changedAt: VERIFIED });
}
const validity = (delivery: Delivery, invalidField?: string) => new Map(delivery.manifest.groups.map(group => [group.key, group.field !== invalidField]));

test("source qualification expiry removes public delivery at the boundary without a collector write", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await fixture();
  await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  const permission = delivery.manifest.groups.flatMap(group => group.dependencies).find(item => item.kind === "source-permission")!;
  await db.prepare("INSERT INTO watch_dependency_expirations VALUES(?,?)").bind(permission.key, "2026-09-13T00:00:00.000Z").run();
  assert.equal((await readWatchDirectory(db, { kind: "policy" }, at())).items.length, 1);
  assert.deepEqual((await readWatchDirectory(db, { kind: "policy" }, at("2026-09-13T00:00:00.000Z"))).items, []);
  await assert.rejects(readWatchSubject(db, "policy", delivery.record.id, "id", at("2026-09-13T00:00:00.000Z")), /watch-evidence-changed/);
});

test("delivery compiler accepts only its own opaque capability and qualified source/regional context", async () => {
  const delivery = await fixture("technology");
  assert.throws(() => compiledWatchDeliveryValue({} as never), /server-compiled-delivery-required/);
  await assert.rejects(compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, sourcePermissionDigests: new Map() }), /delivery-source-permission-required/);
  await assert.rejects(compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, regionalFactIds: new Map() }), /delivery-regional-provenance-required/);
  const regionalId = [...delivery.context.regionalFactIds.values()][0]!;
  const original = delivery.fixture.facts.get(regionalId)!;
  const regional = AcceptedFactRecord.parse({ ...original, verification: { ...original.verification, kind: "source-rule" } });
  delivery.fixture.facts.set(regionalId, regional);
  const acceptance = SubjectAcceptance.parse(delivery.context.acceptance);
  acceptance.factDigests.find(binding => binding.id === regionalId)!.sha256 = await acceptedFactDigest(regional);
  await assert.rejects(compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, acceptance }), /delivery-regional-provenance-conflict/);
});

test("delivery manifest binds every field value, fact digest, citation and filter identity", async () => {
  const delivery = await fixture("technology");
  await validateDeliveryBinding(delivery.record, delivery.manifest);
  for (const change of [
    (manifest: typeof delivery.manifest) => { manifest.groups[0]!.factDigest = OTHER_HASH; },
    (manifest: typeof delivery.manifest) => { manifest.groups[0]!.valueDigest = OTHER_HASH; },
    (manifest: typeof delivery.manifest) => { manifest.groups[0]!.citationIds = [delivery.record.sources.at(-1)!.id]; },
    (manifest: typeof delivery.manifest) => { manifest.groups.find(group => group.artifact)!.artifact!.availability = "private-link"; },
    (manifest: typeof delivery.manifest) => { manifest.groups.find(group => group.local)!.regionalTerm!.validTo = "2030-01-01"; },
    (manifest: typeof delivery.manifest) => { manifest.groups = manifest.groups.filter(group => group.field !== "purpose"); },
  ]) {
    const manifest = structuredClone(delivery.manifest); change(manifest);
    await assert.rejects(validateDeliveryBinding(delivery.record, manifest), /delivery-/);
  }
  const oversized = structuredClone(delivery.manifest);
  for (const group of oversized.groups) group.dependencies = Array.from({ length: 400 }, (_, index) => ({
    kind: "accepted-fact", key: `${index}-${"x".repeat(230)}`, expectedDigest: HASH,
  }));
  assert.ok(new TextEncoder().encode(canonicalJson(oversized)).byteLength > WATCH_DELIVERY_MANIFEST_BYTES);
  assert.equal(WatchDeliveryManifest.safeParse(oversized).success, false);
});

test("changed meaning removes only its optional field and orphaned citation, not accepted metadata", async () => {
  const delivery = await fixture();
  const output = await shapeWatchDelivery(delivery.record, delivery.manifest, validity(delivery, "interpretation"), NOW);
  assert.ok(output?.kind === "policy");
  assert.equal(output.title, delivery.record.title);
  assert.equal(output.interpretation.readiness, "evidence-changed");
  assert.equal(output.interpretation.summary, null);
  assert.ok(!output.sources.some(source => source.id === "evidence-f-interpretation"));
  assert.equal(await shapeWatchDelivery(delivery.record, delivery.manifest, validity(delivery, "title"), NOW), null);
  await assert.rejects(shapeWatchDelivery(delivery.record, delivery.manifest, new Map(), NOW), /delivery-validity-incomplete/);
});

test("current regional evidence expires without becoming historical; accepted history survives only while its own evidence is current", async () => {
  const current = await fixture("technology", "current", true);
  assert.ok(await shapeWatchDelivery(current.record, current.manifest, validity(current), NOW));
  assert.equal(await shapeWatchDelivery(current.record, current.manifest, validity(current), "2026-09-13T04:00:00.000Z"), null);
  const historical = await fixture("technology", "historical");
  assert.ok(await shapeWatchDelivery(historical.record, historical.manifest, validity(historical), "2028-01-01T00:00:00.000Z"));
  assert.equal(await shapeWatchDelivery(historical.record, historical.manifest, validity(historical, "local-relationship"), NOW), null);
});

test("regional membership terms expire at the Eastern civil-day boundary", async () => {
  const delivery = await fixture("technology", "term", true);
  const regionalId = [...delivery.context.regionalFactIds.values()][0]!;
  const regional = delivery.fixture.facts.get(regionalId)!;
  (regional.value as { validTo: string }).validTo = "2026-09-12";
  const acceptance = SubjectAcceptance.parse(delivery.context.acceptance);
  acceptance.factDigests.find(binding => binding.id === regionalId)!.sha256 = await acceptedFactDigest(regional);
  const handle = await compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, acceptance });
  const { record, manifest } = compiledWatchDeliveryValue(handle);
  const groups = new Map(manifest.groups.map(group => [group.key, true]));
  assert.equal(deliveryEasternDay("2026-09-12T03:59:59.999Z"), "2026-09-11");
  assert.ok(await shapeWatchDelivery(record, manifest, groups, "2026-09-12T03:59:59.999Z"));
  assert.equal(await shapeWatchDelivery(record, manifest, groups, "2026-09-12T04:00:00.000Z"), null);
});

test("dependency heads are typed, immutable-history-backed, monotonic and retractable without deletion", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const key = await deliveryDependencyKey("source-permission", ["synthetic-test-source"]);
  const head = { key, kind: "source-permission", revision: 1, digest: HASH, immutableRecordId: "synthetic-head-one", changedAt: VERIFIED };
  assert.deepEqual(await recordWatchDependencyHead(db, head), { outcome: "recorded" });
  assert.deepEqual(await recordWatchDependencyHead(db, head), { outcome: "unchanged" });
  for (const update of [{ digest: OTHER_HASH }, { revision: 2, kind: "evidence" }, { revision: 2, changedAt: "2026-09-10T00:00:00.000Z" }])
    await assert.rejects(recordWatchDependencyHead(db, { ...head, ...update, immutableRecordId: "synthetic-bad-head" }), /watch-dependency-revision-conflict/);
  await recordWatchDependencyHead(db, { ...head, revision: 2, digest: null, immutableRecordId: "synthetic-retraction" });
  assert.throws(() => sqlite.exec("DELETE FROM watch_dependency_heads"), /watch-dependency-retraction-required/);
  assert.throws(() => sqlite.exec("UPDATE watch_dependency_records SET digest=NULL"), /watch-dependency-record-immutable/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_dependency_records").get()!.n, 2);
});

test("review-to-apply dependency race and exact temporal expiry reject atomically", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await fixture(); const decision = await stage(db, delivery);
  const racing: D1DatabaseLike = { prepare: query => db.prepare(query), async batch(statements) {
    await updateHead(db, delivery, "policy-definition"); return db.batch(statements);
  } };
  await assert.rejects(applyReviewedWatchProjection(racing, decision, at()), /watch-stale-acceptance/);
  assert.equal(sqlite.prepare("SELECT generation FROM watch_read_state").get()!.generation, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM watch_delivery_application_clocks").get()!.n, 0);
  const current = await fixture("technology", "expires-at-apply", true);
  const currentDecision = await stage(db, current);
  await assert.rejects(applyReviewedWatchProjection(db, currentDecision, at("2026-09-13T04:00:00.000Z")), /watch-stale-acceptance/);
  assert.equal(sqlite.prepare("SELECT generation FROM watch_read_state").get()!.generation, 0);
});

test("live policy fields and filters redact after a dependency change while metadata remains stable", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await fixture(); await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  await updateHead(db, delivery, "policy-definition");
  const item = await readWatchSubject(db, "policy", delivery.record.id, "id", at());
  assert.ok(item?.kind === "policy"); assert.equal(item.interpretation.readiness, "evidence-changed");
  assert.equal(item.title, delivery.record.title);
  await updateHead(db, delivery, "accepted-fact", "lifecycle", null);
  assert.equal((await readWatchDirectory(db, { kind: "policy", stage: "active" }, at())).items.length, 0);
  assert.equal((await readWatchDirectory(db, { kind: "policy", stage: "unknown" }, at())).items.length, 1);
  await updateHead(db, delivery, "source-permission", undefined, null);
  await assert.rejects(readWatchSubject(db, "policy", delivery.record.id, "id", at()), /watch-evidence-changed/);
  assert.deepEqual((await readWatchDirectory(db, { kind: "policy" }, at())).items, []);
  assert.equal((await handleWatchRead(new Request(`https://thevalleydesk.org/api/v2/watch/policy/${delivery.record.id}`),
    { VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true" })).status, 409);
});

test("current local evidence changes before LIMIT and historical cursors cannot restore it", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const deliveries = await Promise.all([fixture("technology", "a", true), fixture("technology", "b", true), fixture("technology", "c", true)]);
  for (const delivery of deliveries) await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  const first = await readWatchDirectory(db, { kind: "technology", limit: 1 }, at());
  assert.deepEqual(first.items.map(item => item.id), ["a"]); assert.ok(first.nextCursor);
  await updateHead(db, deliveries[1]!, "regional-current", undefined, null);
  const next = await readWatchDirectory(db, { kind: "technology", limit: 1, cursor: first.nextCursor }, at());
  assert.deepEqual(next.items.map(item => item.id), ["c"]); assert.equal(next.nextCursor, null);
  assert.deepEqual((await readWatchDirectory(db, { kind: "technology", organization: "region-b" }, at())).items, []);
  await assert.rejects(readWatchSubject(db, "technology", "b", "id", at()), /watch-evidence-changed/);
});

test("license-byte changes remove OSS and organization filters use surviving local edges", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const initial = await fixture("technology", "oss"); assert.ok(initial.record.kind === "technology");
  const value = initial.record;
  Object.assign(value.licenses[0]!.value, { classification: "osi-open-source", spdxId: "MIT", conditions: [] });
  value.licenseClassifications = ["osi-open-source"]; value.oss = true;
  const second = structuredClone(value.localRelationships[0]!);
  Object.assign(second.value, { id: "relationship-second", entityId: "region-second" }); value.localRelationships.push(second);
  const delivery = await syntheticDeliveryForRecord(value);
  await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  assert.equal((await readWatchDirectory(db, { kind: "technology", license: "osi-open-source" }, at())).items.length, 1);
  await updateHead(db, delivery, "artifact-license");
  const item = await readWatchSubject(db, "technology", "oss", "id", at());
  assert.ok(item?.kind === "technology"); assert.equal(item.oss, false); assert.deepEqual(item.licenses, []);
  assert.deepEqual(item.licenseClassifications, ["unknown"]);
  assert.deepEqual((await readWatchDirectory(db, { kind: "technology", license: "osi-open-source" }, at())).items, []);
  assert.equal((await readWatchDirectory(db, { kind: "technology", license: "unknown" }, at())).items.length, 1);
  await updateHead(db, delivery, "local-relationship");
  const survivors = await readWatchDirectory(db, { kind: "technology", organization: "region-second" }, at());
  assert.equal(survivors.items.length, 1);
  assert.ok(survivors.items[0]?.kind === "technology"); assert.deepEqual(survivors.items[0].organizationIds, ["region-second"]);
  assert.deepEqual((await readWatchDirectory(db, { kind: "technology", organization: "region-oss" }, at())).items, []);
});

test("an institution move cannot erase accepted historical provenance but a correction can", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const historical = await fixture("technology", "historical-move");
  await applyReviewedWatchProjection(db, await stage(db, historical), at());
  await recordWatchDependencyHead(db, { key: await deliveryDependencyKey("regional-current", ["region-historical-move"]),
    kind: "regional-current", revision: 1, digest: null, immutableRecordId: "synthetic-institution-moved", changedAt: VERIFIED });
  assert.ok(await readWatchSubject(db, "technology", historical.record.id, "id", at()));
  await updateHead(db, historical, "regional-historical", undefined, null);
  await assert.rejects(readWatchSubject(db, "technology", historical.record.id, "id", at()), /watch-evidence-changed/);
});

test("current resources checked on different days share stable regional membership without invalidating each other", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const first = await fixture("technology", "shared-region-first", true);
  const second = await fixture("technology", "shared-region-second", true);
  for (const [index, delivery] of [first, second].entries()) {
    assert.ok(delivery.record.kind === "technology");
    Object.assign(delivery.record.localRelationships[0]!.value, { entityId: "shared-regional-institution", validFrom: "2026-09-01",
      checkedAt: index === 0 ? "2026-09-10T13:00:00.000Z" : VERIFIED });
    Object.assign(delivery, await syntheticDeliveryForRecord(delivery.record));
  }
  const regional = (delivery: Delivery) => delivery.manifest.groups.flatMap(group => group.dependencies).find(value => value.kind === "regional-current")!;
  assert.equal(regional(first).key, regional(second).key); assert.equal(regional(first).expectedDigest, regional(second).expectedDigest);
  for (const delivery of [first, second]) await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  assert.equal((await readWatchDirectory(db, { kind: "technology", organization: "shared-regional-institution" }, at())).items.length, 2);
  await updateHead(db, first, "regional-current", undefined, null);
  assert.deepEqual((await readWatchDirectory(db, { kind: "technology" }, at())).items, []);
});

test("distinct accepted policy provision frames have fact-scoped heads and shared definition invalidation", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await fixture();
  const summary = delivery.fixture.facts.get("f-summary")!;
  summary.verification.kind = "human-review";
  summary.interpretationDependencies = { ...structuredClone(delivery.fixture.facts.get("f-interpretation")!.interpretationDependencies!),
    provisionEvidenceSha256: OTHER_HASH, reviewDecisionId: "synthetic-summary-review" };
  delivery.fixture.currentInterpretations.set(summary.id, summary.interpretationDependencies);
  const acceptance = SubjectAcceptance.parse(delivery.context.acceptance);
  acceptance.factDigests.find(binding => binding.id === summary.id)!.sha256 = await acceptedFactDigest(summary);
  const handle = await compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, acceptance });
  Object.assign(delivery, { handle, ...compiledWatchDeliveryValue(handle) });
  const frames = delivery.manifest.groups.flatMap(group => group.dependencies).filter(value => value.kind === "policy-interpretation");
  assert.equal(frames.length, 2); assert.notEqual(frames[0]!.key, frames[1]!.key); assert.notEqual(frames[0]!.expectedDigest, frames[1]!.expectedDigest);
  await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  let item = await readWatchSubject(db, "policy", delivery.record.id, "id", at());
  assert.ok(item?.kind === "policy" && item.summary && item.interpretation.summary);
  await updateHead(db, delivery, "policy-interpretation", "summary");
  item = await readWatchSubject(db, "policy", delivery.record.id, "id", at());
  assert.ok(item?.kind === "policy"); assert.equal(item.summary, null); assert.ok(item.interpretation.summary);
  await updateHead(db, delivery, "policy-definition");
  item = await readWatchSubject(db, "policy", delivery.record.id, "id", at());
  assert.ok(item?.kind === "policy"); assert.equal(item.interpretation.summary, null);
});

test("legacy rows without manifests remain held, and manifest persistence rejects client-shaped handles", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const delivery = await fixture(); const decision = await stage(db, delivery);
  assert.deepEqual(await persistCompiledWatchDelivery(db, decision, delivery.handle), { outcome: "unchanged" });
  await assert.rejects(persistCompiledWatchDelivery(db, decision, {} as never), /server-compiled-delivery-required/);
  // Rebuild only the synthetic database to represent a pre-0030 reviewed row.
  sqlite.exec("DROP TRIGGER watch_delivery_manifest_no_delete; DELETE FROM watch_delivery_manifests");
  await assert.rejects(applyReviewedWatchProjection(db, decision, at()), /watch-delivery-manifest-required/);
});

test("directory SQL response has one aggregate body budget and a compact, non-skipping lookahead", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  // Expand genuine accepted interpretation dependencies, not serialized padding.
  for (let index = 0; index < 32; index++) {
    const delivery = await fixture("policy", `large-${String(index).padStart(2, "0")}`);
    const fact = delivery.fixture.facts.get("f-interpretation")!;
    for (const key of ["definitions", "exceptions", "references", "amendments"] as const)
      fact.interpretationDependencies![key] = Array.from({ length: 60 }, (_, dependency) => ({ id: `synthetic-${key}-${dependency}-${"x".repeat(90)}`, sha256: HASH }));
    delivery.fixture.currentInterpretations.set("f-interpretation", fact.interpretationDependencies);
    const acceptance = SubjectAcceptance.parse(delivery.context.acceptance);
    acceptance.factDigests.find(binding => binding.id === fact.id)!.sha256 = await acceptedFactDigest(fact);
    const handle = await compileWatchDelivery(delivery.fixture.draft, { ...delivery.context, acceptance });
    Object.assign(delivery, { handle, ...compiledWatchDeliveryValue(handle) });
    await applyReviewedWatchProjection(db, await stage(db, delivery), at());
  }
  let largestBody = 0, compactRows = 0;
  const observed: D1DatabaseLike = { batch: statements => db.batch(statements), prepare(query) {
    const wrap = (statement: ReturnType<D1DatabaseLike["prepare"]>): ReturnType<D1DatabaseLike["prepare"]> => ({
      bind: (...values) => wrap(statement.bind(...values)), first: () => statement.first(), run: () => statement.run(),
      async all<T>() {
        const result = await statement.all<T>();
        if (query.includes("budgeted AS MATERIALIZED")) {
          const rows = result.results as Array<Record<string, unknown>>;
          const bytes = rows.reduce((total, row) => total + new TextEncoder().encode(JSON.stringify(row)).byteLength, 0);
          largestBody = Math.max(largestBody, bytes);
          assert.ok(bytes <= WATCH_DIRECTORY_BODY_BYTES + 8_000, `SQL serialized body ${bytes}`);
          for (const row of rows.filter(row => row.has_body === 0)) {
            compactRows++; assert.equal(row.payload_json, null); assert.equal(row.manifest_json, null); assert.equal(row.group_validity, null);
          }
        }
        return result;
      },
    });
    return wrap(db.prepare(query));
  } };
  const first = await readWatchDirectory(observed, { kind: "policy", limit: 50 }, at());
  assert.ok(first.items.length > 0 && first.items.length < 32); assert.ok(first.nextCursor);
  const items = [...first.items]; let cursor = first.nextCursor, pages = 1;
  while (cursor) {
    assert.ok(pages++ < 32, "Each bounded page must advance");
    const page = await readWatchDirectory(observed, { kind: "policy", limit: 50, cursor }, at());
    items.push(...page.items); cursor = page.nextCursor;
  }
  assert.deepEqual(items.map(item => item.id), Array.from({ length: 32 }, (_, index) => `large-${String(index).padStart(2, "0")}`));
  assert.equal(compactRows, pages - 1); assert.ok(largestBody > 500_000);
});
