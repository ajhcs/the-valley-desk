import assert from "node:assert/strict";
import test from "node:test";
import { EditorialProposal, decideEditorialProposal, decideSourceRulePolicyProposal, readEditorialProposal, stageEditorialProposal } from "../src/ingest/watch-editorial";
import { readFileSync } from "node:fs";
import { parseFederalRegisterPolicy } from "../src/ingest/policy-watch-native";
import { persistPolicyWatchCapture, buildPolicyEditorialProposal } from "../src/ingest/policy-watch-workflow";
import { readPolicyWatchCapture } from "../src/ingest/policy-watch-workflow";
import { createWatchEditorialRuntime } from "../src/ingest/watch-editorial-runtime";
import { rssSource } from "./fixtures/watch-adapters/synthetic";
import { sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import { configureWatchCollectionSource } from "../src/ingest/watch/collection-storage";
import { runWatchCollection } from "../src/ingest/watch/collector";
import { canonicalJson } from "../src/content/watch-schema";
import type { EditorialRuntime } from "../src/ingest/watch-editorial";
import { deliveryDependencyKey, verificationRuleDigest } from "../src/content/watch-delivery";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { readWatchDirectory } from "../src/ingest/watch-persistence";
import { sha256, tupleKey } from "../src/content/watch-schema";
import { sourceRuleMayRenewTechnologyDependency } from "../src/ingest/watch-source-rule-renewal";
import { pdfDatabase } from "./helpers/policy-pdf";
import { NOW, syntheticFixture } from "./fixtures/watch-contracts/synthetic";
import { syntheticDeliveryForRecord } from "./fixtures/watch-delivery/synthetic";
import { projectTechnologyProfile } from "../src/content/watch-projection";

async function setup(t: { after: (fn: () => void) => void }) {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  sqlite.exec("CREATE TEMP TABLE test_editorial_guard(valid INTEGER NOT NULL CHECK(valid=1))");
  const fixture = await syntheticFixture("policy");
  const proposal = EditorialProposal.parse({
    externalKey: "synthetic:policy:one", draft: fixture.draft,
    facts: [...fixture.facts.values()].map(({ verification: _verification, evidenceDigests: _digests, ...fact }) => fact),
    evidence: [...fixture.evidence.values()],
  });
  const permission = await sha256("test-only-source-permission");
  await recordWatchDependencyHead(db, {
    key: await deliveryDependencyKey("source-permission", ["synthetic-source"]), kind: "source-permission",
    revision: 1, digest: permission, immutableRecordId: "synthetic-permission-1", changedAt: NOW,
  });
  const runtime: EditorialRuntime = {
    resolveContext: async () => ({ ...fixture.context, sourcePermissionDigests: new Map([["synthetic-source", permission]]),
      regionalFactIds: new Map(), acceptanceGuards: () => [db.prepare("INSERT INTO test_editorial_guard VALUES(1)")] }),
  };
  return { db, sqlite, fixture, proposal, runtime };
}
const now = () => new Date(NOW);

async function nativeSetup(t: { after: (fn: () => void) => void }, tamperCapture = false, authority: "official" | "discovery-only" = "official") {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const at = new Date("2026-09-12T17:00:00.000Z");
  const source = rssSource({ id: "native-test-fr", state: "qualified", qualificationReceiptId: "native-test-qualified",
    authority, desk: "policy", jurisdiction: "federal", family: "regulation", transport: "official-json",
    parserId: "watch-federal-register", parserVersion: "1", endpoints: ["https://www.federalregister.gov/api/v1/documents.json?per_page=5"],
    linkScopes: [{ host: "www.federalregister.gov", pathPrefix: "/" }] });
  const qualification = { id: "native-test-qualified", sourceId: source.id, configurationSha256: await sourceConfigurationDigest(source),
    reviewedAt: at.toISOString(), expiresAt: "2026-10-01T00:00:00.000Z", engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor",
    reviewEvidenceId: "native-test-review", rightsDecision: "accepted", accessDecision: "public-or-authorized-read",
    negativeFixtureSha256: await sha256("negative"), replayFixtureSha256: await sha256("replay"),
    samples: ["2026-09-11T00:00:00.000Z", "2026-09-12T00:00:00.000Z"].map(capturedAt => ({ endpoint: source.endpoints[0],
      representationSha256: "1".repeat(64), capturedAt, parserVersion: "1", itemCount: 1, outcome: "parsed" })) };
  await db.prepare("INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)")
    .bind(qualification.reviewEvidenceId, "synthetic-engineer", "synthetic-editor", await sha256("review"), await sha256(canonicalJson(qualification)), at.toISOString()).run();
  await configureWatchCollectionSource(db, { source, qualification, activationId: "native-test-activation", cadenceSeconds: 60, expectedRevision: 0 }, at.toISOString());
  await runWatchCollection(db, { enabled: true, clock: () => at, fetchImpl: async () => new Response(JSON.stringify({ results: [{
    document_number: "2026-12345", type: "Proposed Rule", title: "Synthetic healthcare proposal", publication_date: "2026-09-10", action: "Proposed rule",
    abstract: "The agency proposes this synthetic test regulation.",
  }] })) });
  const row = sqlite.prepare("SELECT id FROM policy_watch_captures").get()!;
  let captureId = String(row.id);
  if (tamperCapture) {
    const { material: { parsed } } = await readPolicyWatchCapture(db, captureId);
    at.setTime(at.getTime() + 1000); parsed.title = "Invented title with a real evidence pointer"; parsed.source.retrievedAt = at.toISOString();
    captureId = (await persistPolicyWatchCapture(db, parsed)).id;
  }
  const slug = String(sqlite.prepare("SELECT slug FROM watch_subjects").get()!.slug);
  const built = await buildPolicyEditorialProposal(db, captureId, slug, at);
  const runtime = createWatchEditorialRuntime(db);
  return { db, sqlite, at, built, runtime };
}

test("native source rule publishes only rebuilt source facts and records no human approval", async t => {
  const { db, sqlite, at, built, runtime } = await nativeSetup(t);
  const staged = await stageEditorialProposal(db, built.proposal, at);
  const request = { id: staged.id, sha256: staged.sha256 };
  assert.equal((await decideSourceRulePolicyProposal(db, request, runtime, at)).outcome, "applied");
  assert.equal((await decideSourceRulePolicyProposal(db, request, runtime, at)).outcome, "unchanged");
  assert.equal((await readWatchDirectory(db, { kind: "policy" }, at)).items.length, 1);
  assert.equal(built.proposal.facts.find(fact => fact.field === "summary")?.value, "The agency proposes this synthetic test regulation.");
  for (const row of sqlite.prepare("SELECT payload_json FROM watch_editorial_facts").all()) {
    const fact = JSON.parse(String(row.payload_json));
    assert.equal(fact.verification.kind, "source-rule");
    assert.equal(fact.verification.ruleId, "watch-native-source-rule-v1");
    assert.equal(fact.interpretationDependencies, null);
  }
  assert.equal(sqlite.prepare("SELECT reviewer_principal FROM watch_editorial_decisions").get()?.reviewer_principal,
    "source-rule:watch-native-source-rule-v1");
});

test("source rule refuses invented title, interpretation, and a hash mismatch", async t => {
  const { db, sqlite, at, built, runtime } = await nativeSetup(t);
  const proposal = structuredClone(built.proposal);
  proposal.facts[0].value = "Invented title not in the source";
  proposal.draft.subjectRevision++;
  const staged = await stageEditorialProposal(db, proposal, at);
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, runtime, at), /proposal-conflict/);
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: "f".repeat(64) }, runtime, at), /hash-conflict/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("source rule retains current-capture transaction fence", async t => {
  const { db, sqlite, at, built, runtime } = await nativeSetup(t);
  const staged = await stageEditorialProposal(db, built.proposal, at);
  sqlite.exec("CREATE TEMP TABLE source_rule_fail_guard(valid INTEGER CHECK(valid=1))");
  const guarded: EditorialRuntime = { resolveContext: async (proposal, time) => ({
    ...await runtime.resolveContext(proposal, time), acceptanceGuards: () => [db.prepare("INSERT INTO source_rule_fail_guard VALUES(0)")],
  }) };
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, guarded, at));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
  assert.equal((await readWatchDirectory(db, { kind: "policy" }, at)).items.length, 0);
});

test("source-rule provenance and acceptance must bind the same source permission", async t => {
  const { db, sqlite, at, built, runtime } = await nativeSetup(t);
  const staged = await stageEditorialProposal(db, built.proposal, at);
  const changed: EditorialRuntime = { resolveContext: async (proposal, time) => {
    const resolved = await runtime.resolveContext(proposal, time);
    return { ...resolved, sourcePermissionDigests: new Map([...resolved.sourcePermissionDigests.keys()].map(id => [id, "f".repeat(64)])) };
  } };
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, changed, at), /permission-conflict/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("source rule reparses the capture instead of trusting its derived title", async t => {
  const { db, sqlite, at, built, runtime } = await nativeSetup(t, true);
  const staged = await stageEditorialProposal(db, built.proposal, at);
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, runtime, at), /native-parser-conflict/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("source rule refuses ledger-only records and discovery-only source authority", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const captured = JSON.parse(readFileSync(new URL("./fixtures/policy-watch-native/fr-2025-15492-20260912.json", import.meta.url), "utf8"));
  const at = new Date("2026-09-12T17:00:00.000Z");
  const capture = await persistPolicyWatchCapture(db, parseFederalRegisterPolicy(captured.native, captured.source));
  const built = await buildPolicyEditorialProposal(db, capture.id, "uncollected-rule", at);
  const staged = await stageEditorialProposal(db, built.proposal, at);
  await assert.rejects(decideSourceRulePolicyProposal(db, { id: staged.id, sha256: staged.sha256 }, createWatchEditorialRuntime(db), at), /collector-required/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
  const discovery = await nativeSetup(t, false, "discovery-only");
  const other = await stageEditorialProposal(discovery.db, discovery.built.proposal, discovery.at);
  await assert.rejects(decideSourceRulePolicyProposal(discovery.db, { id: other.id, sha256: other.sha256 }, discovery.runtime, discovery.at), /collector-required/);
  assert.equal(discovery.sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("source-rule refresh distinguishes a routine capture invalidation from explicit revocation", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  await db.prepare("INSERT INTO technology_source_representations VALUES(?,?,?,?,?,?,?)")
    .bind("raw-new-capture", "tech-subject", "tech-source", "https://example.test/repo", await sha256("raw"), "raw", NOW).run();
  const dependency = { kind: "artifact", key: "artifact-key" };
  const machine = { digest: null, changed_at: NOW,
    immutable_record_id: await tupleKey("technology-retraction-v1", ["raw-new-capture", dependency.key]) };
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "tech-subject", dependency, machine), true);
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "other-subject", dependency, machine), false);
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "tech-subject", dependency,
    { ...machine, immutable_record_id: "explicit-operator-revocation" }), false);
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "tech-subject", { ...dependency, kind: "source-permission" },
    { ...machine, digest: "1".repeat(64) }), false);
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "tech-subject", { ...dependency, kind: "regional-historical" },
    { ...machine, digest: "1".repeat(64) }), false);
  assert.equal(await sourceRuleMayRenewTechnologyDependency(db, "tech-subject", { ...dependency, kind: "regional-current" }, machine), false);
});

test("only a fresh named review can renew a retracted artifact head", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  sqlite.exec("CREATE TEMP TABLE test_editorial_guard(valid INTEGER NOT NULL CHECK(valid=1))");
  const source = await syntheticFixture("technology");
  const delivery = await syntheticDeliveryForRecord(await projectTechnologyProfile(source.draft, source.context));
  const proposal = EditorialProposal.parse({ externalKey: "synthetic:technology:renewal", draft: delivery.fixture.draft,
    facts: [...delivery.fixture.facts.values()].map(({ verification: _v, evidenceDigests: _e, ...fact }) => fact),
    evidence: [...delivery.fixture.evidence.values()] });
  for (const [id, digest] of delivery.context.sourcePermissionDigests) await recordWatchDependencyHead(db, {
    key: await deliveryDependencyKey("source-permission", [id]), kind: "source-permission", revision: 1,
    digest, immutableRecordId: "permission-" + id, changedAt: NOW });
  const artifact = delivery.manifest.groups.flatMap(group => group.dependencies).find(item => item.kind === "artifact")!;
  await recordWatchDependencyHead(db, { key: artifact.key, kind: "artifact", revision: 1, digest: null,
    immutableRecordId: "previous-artifact-retraction", changedAt: NOW });
  const runtime: EditorialRuntime = { resolveContext: async () => ({ ...delivery.context,
    acceptanceGuards: () => [db.prepare("INSERT INTO test_editorial_guard VALUES(1)")] }) };
  const staged = await stageEditorialProposal(db, proposal, now());
  assert.equal((await readWatchDirectory(db, { kind: "technology" }, now())).items.length, 0);
  await decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" }, "editor@example.test", runtime, now());
  const head = await db.prepare("SELECT revision,digest FROM watch_dependency_heads WHERE dependency_key=?").bind(artifact.key)
    .first<{ revision: number; digest: string }>();
  assert.equal(head?.revision, 2); assert.equal(head?.digest, artifact.expectedDigest);
  assert.equal((await readWatchDirectory(db, { kind: "technology" }, now())).items.length, 1);
});

test("stored editorial proposals do not publish; exact staging replay retains immutable identity", async t => {
  const { db, proposal } = await setup(t);
  const first = await stageEditorialProposal(db, proposal, now());
  const second = await stageEditorialProposal(db, proposal, now());
  assert.equal(first.id, second.id); assert.equal(second.outcome, "unchanged");
  assert.equal((await readWatchDirectory(db, { kind: "policy" }, now())).items.length, 0);
  assert.deepEqual((await readEditorialProposal(db, first.id))?.proposal, proposal);
});

test("operator review produces actual accepted facts, manifest and public generation with replay", async t => {
  const { db, sqlite, proposal, runtime } = await setup(t);
  const staged = await stageEditorialProposal(db, proposal, now());
  const request = { id: staged.id, sha256: staged.sha256, action: "accepted" as const };
  const result = await decideEditorialProposal(db, request, "editor@example.test", runtime, now());
  assert.equal(result.outcome, "applied");
  const page = await readWatchDirectory(db, { kind: "policy" }, now());
  assert.equal(page.items.length, 1); assert.equal(page.items[0].id, proposal.draft.id);
  assert.equal((await decideEditorialProposal(db, request, "editor@example.test", runtime, now())).outcome, "unchanged");
  const facts = sqlite.prepare("SELECT payload_json FROM watch_editorial_facts").all();
  assert.equal(facts.length, proposal.facts.length);
  for (const row of facts) assert.equal(JSON.parse(String(row.payload_json)).verification.verifiedAt, NOW);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_publication_decisions").get()?.n, 1);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});

test("proposal schema cannot import a model-authored verification receipt", async t => {
  const { proposal } = await setup(t);
  const input = structuredClone(proposal);
  Object.assign(input.facts[0], { verification: { kind: "human-review", verifierId: "model" } });
  assert.equal(EditorialProposal.safeParse(input).success, false);
});

test("stale revision and changed hashes cannot be reviewed", async t => {
  const { db, proposal, runtime } = await setup(t);
  const old = await stageEditorialProposal(db, proposal, now());
  await assert.rejects(decideEditorialProposal(db, { id: old.id, sha256: "f".repeat(64), action: "accepted" },
    "editor@example.test", runtime, now()), /watch-draft-hash-conflict/);
  const next = structuredClone(proposal); next.draft.subjectRevision++;
  await stageEditorialProposal(db, next, now());
  await assert.rejects(decideEditorialProposal(db, { id: old.id, sha256: old.sha256, action: "accepted" },
    "editor@example.test", runtime, now()), /watch-editorial-stale-draft/);
});

test("rejection persists without public writes and cannot be changed into an approval", async t => {
  const { db, sqlite, proposal, runtime } = await setup(t);
  const staged = await stageEditorialProposal(db, proposal, now());
  await decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "rejected" },
    "editor@example.test", runtime, now());
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_facts").get()?.n, 0);
  await assert.rejects(decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" },
    "editor@example.test", runtime, now()), /watch-review-already-decided/);
});

test("missing retained source evidence blocks review before any acceptance write", async t => {
  const { db, sqlite, proposal, runtime, fixture } = await setup(t);
  const staged = await stageEditorialProposal(db, proposal, now());
  fixture.observations.clear();
  await assert.rejects(decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" },
    "editor@example.test", runtime, now()), /watch-review-evidence-unavailable/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_decisions").get()?.n, 0);
});

test("an acceptance storage failure rolls its facts and dependency writes back", async t => {
  const { db, sqlite, proposal, runtime } = await setup(t);
  const staged = await stageEditorialProposal(db, proposal, now());
  sqlite.exec("CREATE TRIGGER test_manifest_failure BEFORE INSERT ON watch_delivery_manifests BEGIN SELECT RAISE(ABORT,'fixture-failure'); END;");
  await assert.rejects(decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" },
    "editor@example.test", runtime, now()), /fixture-failure/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_decisions").get()?.n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_facts").get()?.n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_reviewed_projections").get()?.n, 0);
});

test("a current-evidence guard failure prevents the first acceptance transaction", async t => {
  const { db, sqlite, proposal, runtime } = await setup(t);
  const staged = await stageEditorialProposal(db, proposal, now());
  const resolve = runtime.resolveContext;
  runtime.resolveContext = async (...args) => ({ ...await resolve(...args),
    acceptanceGuards: () => [db.prepare("INSERT INTO test_editorial_guard VALUES(0)")] });
  await assert.rejects(decideEditorialProposal(db, { id: staged.id, sha256: staged.sha256, action: "accepted" },
    "editor@example.test", runtime, now()), /CHECK constraint/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_editorial_decisions").get()?.n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM watch_reviewed_projections").get()?.n, 0);
});

function beforeFirstBatch(db: import("../src/ingest/persistence").D1DatabaseLike, action: () => Promise<unknown>) {
  let called=false;
  return {prepare: (sql:string)=>db.prepare(sql),batch:async (statements:import("../src/ingest/persistence").D1StatementLike[])=>{
    if(!called){called=true;await action();}return db.batch(statements);
  }};
}

test("concurrent identical staging returns the committed draft instead of a uniqueness error",async t=>{
  const {db,sqlite,proposal}=await setup(t);
  const racing=beforeFirstBatch(db,()=>stageEditorialProposal(db,proposal,now()));
  const result=await stageEditorialProposal(racing,proposal,now());
  assert.equal(result.outcome,"unchanged");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n,1);
});

test("concurrent different payload at the same revision remains a staging conflict",async t=>{
  const {db,proposal}=await setup(t);const other=structuredClone(proposal);other.externalKey="different-external-key";
  const racing=beforeFirstBatch(db,()=>stageEditorialProposal(db,other,now()));
  await assert.rejects(stageEditorialProposal(racing,proposal,now()),/watch-draft-revision-conflict/);
});

test("concurrent identical acceptance returns the existing published decision",async t=>{
  const {db,sqlite,proposal,runtime}=await setup(t);const staged=await stageEditorialProposal(db,proposal,now());
  const request={id:staged.id,sha256:staged.sha256,action:"accepted" as const};
  const racing=beforeFirstBatch(db,()=>decideEditorialProposal(db,request,"editor@example.test",runtime,now()));
  const result=await decideEditorialProposal(racing,request,"editor@example.test",runtime,now());
  assert.equal(result.outcome,"unchanged");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_publication_decisions").get()!.n,1);
});

test("racing decisions never collapse different principals or opposite actions into replay",async t=>{
  for(const other of [{principal:"another@example.test",action:"accepted" as const},{principal:"editor@example.test",action:"rejected" as const}]){
    const {db,sqlite,proposal,runtime}=await setup(t);const staged=await stageEditorialProposal(db,proposal,now());
    const request={id:staged.id,sha256:staged.sha256,action:"accepted" as const};
    const racing=beforeFirstBatch(db,()=>decideEditorialProposal(db,{...request,action:other.action},other.principal,runtime,now()));
    await assert.rejects(decideEditorialProposal(racing,request,"editor@example.test",runtime,now()),/watch-review-already-decided/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n,1);
  }
});

test("a concurrent identical rejection is also idempotent",async t=>{
  const {db,sqlite,proposal,runtime}=await setup(t);const staged=await stageEditorialProposal(db,proposal,now());
  const request={id:staged.id,sha256:staged.sha256,action:"rejected" as const};
  let called=false;
  const wrap=(statement:import("../src/ingest/persistence").D1StatementLike):import("../src/ingest/persistence").D1StatementLike=>({
    bind:(...values)=>wrap(statement.bind(...values)),first:<T>()=>statement.first<T>(),all:<T>()=>statement.all<T>(),
    async run(){if(!called){called=true;await decideEditorialProposal(db,request,"editor@example.test",runtime,now());}return statement.run();},
  });
  const racing={prepare:(sql:string)=>sql.startsWith("INSERT INTO watch_editorial_decisions")?wrap(db.prepare(sql)):db.prepare(sql),batch:db.batch};
  assert.equal((await decideEditorialProposal(racing,request,"editor@example.test",runtime,now())).outcome,"unchanged");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_publication_decisions").get()!.n,0);
});

test("non-source dependency revocation or revision change rolls back first acceptance",async t=>{
  for(const revoke of [true,false]){
    const {db,sqlite,proposal,runtime}=await setup(t);
    const key=await deliveryDependencyKey("verification-rule",["watch-editorial-review-v1"]);
    const digest=await verificationRuleDigest("watch-editorial-review-v1","1");
    await recordWatchDependencyHead(db,{key,kind:"verification-rule",revision:1,digest,immutableRecordId:"rule-v1",changedAt:NOW});
    const staged=await stageEditorialProposal(db,proposal,now()),request={id:staged.id,sha256:staged.sha256,action:"accepted" as const};
    const racing=beforeFirstBatch(db,()=>recordWatchDependencyHead(db,{key,kind:"verification-rule",revision:2,digest:revoke?null:digest,
      immutableRecordId:"rule-v2",changedAt:NOW}));
    await assert.rejects(decideEditorialProposal(racing,request,"editor@example.test",runtime,now()),/CHECK/);
    for(const table of ["watch_editorial_decisions","watch_editorial_facts","watch_reviewed_projections","watch_editorial_dependency_guards","watch_publication_decisions"])
      assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0,table);
  }
});

test("source permission expiry between acceptance and application blocks publication atomically",async t=>{
  const {db,sqlite,proposal,runtime}=await setup(t);const staged=await stageEditorialProposal(db,proposal,now());
  const key=await deliveryDependencyKey("source-permission",["synthetic-source"]);let batches=0;
  const racing={prepare:(sql:string)=>db.prepare(sql),batch:async (statements:import("../src/ingest/persistence").D1StatementLike[])=>{
    if(++batches===2)await db.prepare("INSERT INTO watch_dependency_expirations VALUES(?,?)").bind(key,NOW).run();
    return db.batch(statements);
  }};
  await assert.rejects(decideEditorialProposal(racing,{id:staged.id,sha256:staged.sha256,action:"accepted"},"editor@example.test",runtime,now()),/watch-stale-acceptance/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_publication_decisions").get()!.n,0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_delivery_application_clocks").get()!.n,0);
});
