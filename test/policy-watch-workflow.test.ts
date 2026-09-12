import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { parseNewJerseyPolicy, parseDelawareIntroducedPolicy, parseFederalRegisterPolicy, parseCongressPolicy,
  parsePhiladelphiaPolicy, parsePennsylvaniaPolicy, materializePolicyCapture } from "../src/ingest/policy-watch-native";
import { persistPolicyWatchCapture, buildPolicyEditorialProposal, linkPaPolicyVersion, listPolicyWatchCaptures, resolvePolicyWatchEvidence } from "../src/ingest/policy-watch-workflow";
import { PolicyDossierDraft, canonicalJson, evidenceReferenceDigest } from "../src/content/watch-schema";
import { deliveryDependencyKey } from "../src/content/watch-delivery";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { evidenceMatches } from "../src/content/watch-projection";
import type { D1DatabaseLike } from "../src/ingest/persistence";
const fixture = (name: string) => JSON.parse(readFileSync(new URL("./fixtures/policy-watch-native/" + name + ".json", import.meta.url), "utf8"));
const nj = fixture("nj-a101-20260912"), de = fixture("de-sb360-20260912"), fr = fixture("fr-2025-15492-20260912");
const now = new Date("2026-09-12T17:00:00.000Z");
const paSource = { sourceId: "pa-official-native", sourceUrl: "https://www.palegis.us/legislation/bills/2025/sb1113",
  sourceLabel: "Pennsylvania General Assembly", retrievedAt: "2026-09-06T12:00:00.000Z" };
const paHtml = readFileSync(new URL("./fixtures/pa-legislation/captured-sb1113-20260906.html", import.meta.url), "utf8");
test("actual NJ, DE, Federal Register and retained PA source records retain exact evidence", async () => {
  for (const parsed of [parseNewJerseyPolicy(nj.native, nj.sessionKey, nj.source), parseDelawareIntroducedPolicy(de.native, de.source),
    parseFederalRegisterPolicy(fr.native, fr.source), parsePennsylvaniaPolicy(paHtml, paSource)]) {
    const material = await materializePolicyCapture(parsed);
    assert.ok(material.evidence.length > 0);
    for (const evidence of material.evidence) assert.equal(await evidenceMatches(evidence, material.observation), true);
    assert.equal(parsed.gaps.includes("Native metadata does not establish current legal effect or reviewed applicability."), true);
    for (const action of material.actions) assert.notEqual(action.value.sourceOccurredAt.precision, "instant");
  }
});
test("native date precision, version identity and unmapped status remain explicit", async () => {
  const material = await materializePolicyCapture(parseNewJerseyPolicy(nj.native, nj.sessionKey, nj.source));
  assert.equal(material.actions[0].value.nativeCode, "INT 1RA REF ATR");
  assert.deepEqual(material.actions[0].value.sourceOccurredAt.precision, "day");
  assert.equal("value" in material.actions[0].value.sourceOccurredAt && material.actions[0].value.sourceOccurredAt.value, "2026-01-13");
  assert.equal(material.actions[0].value.sourceOrder, 1);
  const invalid = structuredClone(nj.native); invalid.history[0].DateAction = "2/30/2026 0:00:00";
  assert.equal((await materializePolicyCapture(parseNewJerseyPolicy(invalid, nj.sessionKey, nj.source))).actions[0].value.sourceOccurredAt.precision, "unknown");
  assert.throws(() => parseDelawareIntroducedPolicy({ ...de.native, Title: "SA 3 to HB 75" }, de.source), /unmapped/);
  assert.throws(() => parseFederalRegisterPolicy({ ...fr.native, type: "Notice" }, fr.source));
  assert.throws(() => parseNewJerseyPolicy(nj.native, "standing", nj.source));
  assert.throws(() => parseFederalRegisterPolicy(fr.native, { ...fr.source, sourceUrl: "https://example.invalid/data" }), /host/);
});
test("Congress documentation-shaped and Legistar synthetic actions preserve native identity and unknown chronology", async () => {
  // These two examples are synthetic, not successful live captures or source qualifications.
  const source = { sourceId: "congress-native", sourceUrl: "https://api.congress.gov/v3/bill/119/hr/1",
    sourceLabel: "Synthetic Congress fixture", retrievedAt: now.toISOString() };
  const native = { bill: { type: "HR", number: 1, congress: 119, title: "Synthetic bill" }, actions: [
    { actionDate: "2026-01-01", actionCode: "1000", text: "Synthetic introduced action" },
    { actionDate: "2026-01-02", actionCode: "9999", text: "Synthetic unknown action" }] };
  const first = await materializePolicyCapture(parseCongressPolicy(native, source));
  const second = await materializePolicyCapture(parseCongressPolicy({ ...native, actions: [...native.actions].reverse() }, source));
  assert.deepEqual(first.actions.map(a => a.value.id).sort(), second.actions.map(a => a.value.id).sort());
  assert.equal(first.parsed.historyComplete, false);
  const local = parsePhiladelphiaPolicy({ matter: { MatterId: 123, MatterTypeName: "Resolution", MatterTitle: "Synthetic resolution", MatterVersion: "0" },
    histories: [{ MatterHistoryId: 8, MatterHistoryMatterId: 123, MatterHistoryActionId: 99,
      MatterHistoryActionName: "Synthetic action", MatterHistoryActionDate: "2026-01-01T00:00:00" }] }, "2024-2027",
    { ...source, sourceUrl: "https://webapi.legistar.com/v1/phila/matters/123" });
  assert.equal((await materializePolicyCapture(local)).actions[0].value.sourceOccurredAt.precision, "day");
  assert.equal(local.identity.instrumentType, "resolution");
});
test("real local D1 review-only policy ledger preserves corrections, no new developments on recheck, and PA links", { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ WATCH_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL("./fixtures/watch-d1/wrangler.jsonc", import.meta.url)), envFiles: [], persist: false, remoteBindings: false });
  t.after(() => proxy.dispose()); const db = proxy.env.WATCH_TEST_DB;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
    await db.batch(unstable_splitSqlQuery(readFileSync(new URL(file, migrations), "utf8")).map(sql => db.prepare(sql)));
  }
  const capture = parseNewJerseyPolicy(nj.native, nj.sessionKey, nj.source);
  const stored = await persistPolicyWatchCapture(db, capture);
  const repeated = await persistPolicyWatchCapture(db, { ...capture, source: { ...capture.source, retrievedAt: now.toISOString() } });
  assert.equal(repeated.id, stored.id); assert.equal(repeated.revision, stored.revision); assert.equal(repeated.outcome, "unchanged");
  const built = await buildPolicyEditorialProposal(db, stored.id, "nj-a101", now);
  assert.ok(PolicyDossierDraft.safeParse(built.proposal.draft).success);
  assert.equal(built.acceptance, "unreviewed");
  assert.equal(built.proposal.facts.some(fact => "verification" in fact), false);
  assert.equal("unavailableReason" in built.proposal.draft.legalEffect, true);
  assert.equal("unavailableReason" in built.proposal.draft.lifecycle, true);
  assert.ok(built.proposal.facts.some(fact => fact.field === "latest-action"));
  await db.batch(built.acceptanceGuards("synthetic-first-decision"));
  await db.prepare("CREATE TABLE IF NOT EXISTS watch_editorial_drafts(id TEXT PRIMARY KEY,subject_id TEXT,subject_revision INTEGER,input_sha256 TEXT,payload_json TEXT,created_at TEXT)").run();
  await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES(?,'policy','synthetic-nj','nj-a101',1,?,?)")
    .bind(built.proposal.draft.id, "1".repeat(64), now.toISOString()).run();
  await db.prepare("INSERT INTO watch_editorial_drafts VALUES('synthetic-native-review',?,1,?,?,?)")
    .bind(built.proposal.draft.id, "1".repeat(64), canonicalJson(built.proposal), now.toISOString()).run();
  const headValues = [];
  for (const evidence of built.proposal.evidence) {
    const digest = await evidenceReferenceDigest(evidence), key = await deliveryDependencyKey("evidence", [evidence.id, digest]);
    headValues.push({ key, digest, kind: "evidence" as const, revision: 1,
      immutableRecordId: "synthetic-head-" + headValues.length, changedAt: nj.source.retrievedAt });
  }
  await recordWatchDependencyHead(db, headValues[0]);
  await recordWatchDependencyHead(db, { key: "synthetic-permission", digest: "2".repeat(64), kind: "source-permission",
    revision: 1, immutableRecordId: "synthetic-permission-record", changedAt: nj.source.retrievedAt });
  const corrected = structuredClone(nj.native); corrected.history[0].Comment = "Source correction";
  let raced = false;
  const lateApproval: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: async statements => {
    if (!raced) { raced = true; await recordWatchDependencyHead(db, headValues[1]); }
    return db.batch(statements);
  } };
  const next = await persistPolicyWatchCapture(lateApproval, parseNewJerseyPolicy(corrected, nj.sessionKey, nj.source));
  assert.notEqual(next.id, stored.id);
  for (const head of headValues) {
    const retracted = await db.prepare("SELECT revision,digest FROM watch_dependency_heads WHERE dependency_key=?")
      .bind(head.key).first<{ revision: number; digest: string | null }>();
    assert.equal(retracted?.digest, null); assert.equal(retracted?.revision, 2);
  }
  assert.equal((await db.prepare("SELECT digest FROM watch_dependency_heads WHERE dependency_key='synthetic-permission'").first<{ digest: string }>())?.digest, "2".repeat(64));
  assert.equal((await db.prepare("SELECT count(*) AS count FROM policy_watch_capture_scan_guards").first<{ count: number }>())?.count, 1);
  const another = structuredClone(corrected); another.history[0].Comment = "Second correction";
  const newDraftRace: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: async statements => {
    await db.prepare("INSERT INTO watch_editorial_drafts VALUES('synthetic-racing-draft',?,2,?,?,?)")
      .bind(built.proposal.draft.id, "3".repeat(64), canonicalJson(built.proposal), now.toISOString()).run();
    return db.batch(statements);
  } };
  const captureCount = (await listPolicyWatchCaptures(db)).length;
  await assert.rejects(persistPolicyWatchCapture(newDraftRace, parseNewJerseyPolicy(another, nj.sessionKey, nj.source)), /CHECK constraint/);
  assert.equal((await listPolicyWatchCaptures(db)).length, captureCount);
  await assert.rejects(db.batch(built.acceptanceGuards("synthetic-stale-decision")), /CHECK constraint/);
  await assert.rejects(buildPolicyEditorialProposal(db, stored.id, "nj-a101", now), /not-current/);
  await assert.rejects(resolvePolicyWatchEvidence(db, built.proposal.draft.id, [built.observations[0].id]), /not-current/);
  const ids = (await db.prepare("SELECT DISTINCT development_id FROM policy_watch_action_revisions").all()).results;
  assert.equal(ids?.length, 1);
  await assert.rejects(db.prepare("UPDATE policy_watch_captures SET payload_json='{}'").run(), /immutable/);
  const stagedDe = await persistPolicyWatchCapture(db, parseDelawareIntroducedPolicy(de.native, de.source));
  assert.equal("unavailableReason" in (await buildPolicyEditorialProposal(db, stagedDe.id, "de-sb360", now)).proposal.draft.latestAction, true);
  const pa = parsePennsylvaniaPolicy(paHtml, paSource), stagedPa = await persistPolicyWatchCapture(db, pa);
  await db.prepare("INSERT INTO policy_instruments(id,jurisdiction,session,instrument_id,title,canonical_url,current_stage,first_seen_at,last_seen_at) VALUES('pa-old','PA',?,?,?,?,'unknown',?,?)")
    .bind(pa.identity.sessionKey, pa.identity.sourceInstrumentId, pa.title, pa.source.sourceUrl, pa.source.retrievedAt, pa.source.retrievedAt).run();
  await db.prepare("INSERT INTO policy_versions(id,instrument_row_id,version_id,text_url,stage,development_at,source_url,first_seen_at,last_seen_at) VALUES('pa-version','pa-old',?,?,'unknown',?,?,?,?)")
    .bind(pa.version.nativeId, pa.version.textUrl, pa.source.retrievedAt, pa.source.sourceUrl, pa.source.retrievedAt, pa.source.retrievedAt).run();
  await linkPaPolicyVersion(db, stagedPa.id, "pa-version");
  await assert.rejects(linkPaPolicyVersion(db, stored.id, "pa-version"), /conflict/);
  const before = await listPolicyWatchCaptures(db);
  const broken: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([...statements, db.prepare("SELECT * FROM nonexistent_table")]) };
  await assert.rejects(persistPolicyWatchCapture(broken, parseFederalRegisterPolicy(fr.native, fr.source)));
  assert.equal((await listPolicyWatchCaptures(db)).length, before.length);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM watch_public_revisions").first<{ count: number }>())!.count, 0);
  assert.ok(canonicalJson(built.proposal).length < 500000);
});
