import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { parsePennsylvaniaPolicy, materializePolicyCapture } from "../src/ingest/policy-watch-native";
import { assertCollectedPolicySourceRule } from "../src/ingest/policy-source-rule";
import { parsePennsylvaniaSnapshot, stageCollectedPennsylvaniaPolicy, PENNSYLVANIA_PARSER_ID } from "../src/ingest/watch/pennsylvania-adapter";
import { sourceConfigurationDigest, type SnapshotInput, type SourceEnrollment } from "../src/ingest/watch/source-enrollment";
import { configureWatchCollectionSource } from "../src/ingest/watch/collection-storage";
import { runWatchCollection } from "../src/ingest/watch/collector";
import { readWatchDirectory } from "../src/ingest/watch-persistence";
import { deliveryDependencyKey } from "../src/content/watch-delivery";
import { recordWatchDependencyHead } from "../src/ingest/watch-delivery";
import { decideSourceRulePolicyProposal, type EditorialRuntime } from "../src/ingest/watch-editorial";
import { createWatchEditorialRuntime } from "../src/ingest/watch-editorial-runtime";
import { launchCandidate } from "../fixtures/watch-launch-candidates";
import { prepareCapturedSource } from "../scripts/lib/watch-source-preparation";
import { qualifyCapturedWatchSource } from "../scripts/lib/watch-source-qualification";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import { pdfDatabase } from "./helpers/policy-pdf";
import { rssSource } from "./fixtures/watch-adapters/synthetic";

const AT = "2026-09-30T12:00:00.000Z";
const url = (bill = "hb1925", session = "2025") => `https://www.palegis.us/legislation/bills/${session}/${bill}`;
const retained = (bill: string) => readFileSync(new URL(`./fixtures/pa-legislation/captured-${bill}-20260906.html`, import.meta.url));
function source(overrides: Partial<SourceEnrollment> = {}) {
  return rssSource({ id: "synthetic-pa-bill", name: "Synthetic PA qualification; retained offline bytes",
    desk: "policy", jurisdiction: "PA", family: "legislation", transport: "html", authority: "official",
    parserId: PENNSYLVANIA_PARSER_ID, parserVersion: "1", endpoints: [url()],
    linkScopes: [{ host: "www.palegis.us", pathPrefix: "/legislation/bills" }], maxBytes: 350_000, ...overrides });
}
function input(body: string | Uint8Array = retained("hb1925"), enrollment = source(), fetchedAt = AT): SnapshotInput {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { source: enrollment, body: new TextDecoder().decode(bytes), representationBytes: bytes,
    finalUrl: enrollment.endpoints[0], fetchedAt, status: 200 };
}
// Entirely synthesized mechanics, not the parent's current-bill source evidence.
function synthetic(bill = "hb1925", pn = "3963", action = "Re-reported as committed, PN 3349, September 30, 2026") {
  const label = `${bill.startsWith("hb") ? "House" : "Senate"} Bill ${bill.slice(2)}`;
  return `<html><title>${label} Information; 2025-2026 Regular Session - Synthetic</title>
    <div><strong>Last Action: </strong>${action}<span></span></div>
    <div class="card float-start"><span title="Most recent printers number">September 29, 2026</span>
      <div class="mt-2">PN ${pn}</div><a title="PDF Bill Text" href="/legislation/bills/text/PDF/2025/0/${bill.toUpperCase()}/PN${pn}">PDF</a></div>
    <div id="HistorySection"><table><tr><td>1</td><td>${action}</td></tr></table></div></html>`;
}
const native = (value: SnapshotInput) => parsePennsylvaniaPolicy(value.body, {
  sourceId: (value.source as SourceEnrollment).id, sourceUrl: value.finalUrl,
  sourceLabel: "Offline PA test", retrievedAt: value.fetchedAt });

async function enroll(db: D1DatabaseLike, enrollment = source()) {
  // This receipt is local synthetic test state, never evidence of live qualification.
  const qualified = { ...enrollment, state: "qualified" as const, qualificationReceiptId: enrollment.id + "-qualified" };
  const qualification = { id: qualified.qualificationReceiptId, sourceId: qualified.id,
    configurationSha256: await sourceConfigurationDigest(qualified), reviewedAt: AT, expiresAt: "2026-10-01T00:00:00.000Z",
    engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor", reviewEvidenceId: enrollment.id + "-review",
    rightsDecision: "accepted", accessDecision: "public-or-authorized-read", negativeFixtureSha256: await sha256("negative"),
    replayFixtureSha256: await sha256("replay"), samples: ["2026-09-28T00:00:00.000Z", "2026-09-29T00:00:00.000Z"].map(capturedAt => ({
      endpoint: qualified.endpoints[0], representationSha256: "1".repeat(64), capturedAt, parserVersion: "1", itemCount: 1, outcome: "parsed" })) };
  await db.prepare("INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)")
    .bind(qualification.reviewEvidenceId, qualification.engineeringOwnerId, qualification.editorialOwnerId,
      await sha256("synthetic acceptance"), await sha256(canonicalJson(qualification)), AT).run();
  await configureWatchCollectionSource(db, { source: qualified, qualification, activationId: "synthetic-pa-activation",
    cadenceSeconds: 60, expectedRevision: 0 }, AT);
}

test("retained official bytes retain original raw hashes, identity, PN and literal actions", async () => {
  for (const [bill, pn] of [["hb1925", "3349"], ["hb1993", "2515"], ["sb1113", "1376"]]) {
    const value = input(retained(bill), source({ endpoints: [url(bill)] }));
    const parsed = await parsePennsylvaniaSnapshot(value);
    assert.equal(parsed.health.state, "healthy", parsed.health.error);
    assert.equal(parsed.observations.length, 1);
    assert.equal(parsed.representationSha256, await sha256(retained(bill)));
    assert.equal(parsed.observations[0].representationSha256, parsed.representationSha256);
    const capture = native(value), material = await materializePolicyCapture(capture);
    assert.equal(capture.parserVersion, "pa-bill-history-html-2");
    assert.equal(capture.version.nativeId, `PN ${pn}`);
    assert.equal((capture.native as { html: string }).html, value.body);
    assert.ok(material.actions.length);
    assert.ok(material.actions.every(action => capture.actions.some(row => row.text === action.value.text)));
    assert.ok(capture.gaps.some(gap => gap.includes("legal effect")));
    assert.ok(new TextEncoder().encode(canonicalJson(parsed.observations[0].payload)).length < 32_000);
    const replay = await parsePennsylvaniaSnapshot({ ...value, fetchedAt: "2026-09-30T12:02:00.000Z" });
    assert.equal(replay.observations[0].id, parsed.observations[0].id);
    assert.equal(replay.observations[0].payloadSha256, parsed.observations[0].payloadSha256);
  }
});

test("synthetic HB/SB identities separate; out-of-slice sessions and memos fail visibly", async () => {
  const hb = await parsePennsylvaniaSnapshot(input(synthetic("hb1925")));
  const sb = await parsePennsylvaniaSnapshot(input(synthetic("sb1925"), source({ endpoints: [url("sb1925")] })));
  assert.notEqual(hb.observations[0].externalKey, sb.observations[0].externalKey);
  assert.notEqual(hb.observations[0].id, sb.observations[0].id);
  const older = input(synthetic().replaceAll("2025", "2023").replaceAll("2026", "2024"), source({ endpoints: [url("hb1925", "2023")] }));
  assert.notEqual((await materializePolicyCapture(native(older))).subjectId, (await materializePolicyCapture(native(input(synthetic())))).subjectId);
  for (const endpoint of [url("hb1925", "2023"), url() + "?view=print", url() + "/", "https://www.palegis.us/senate/co-sponsorship/memo"])
    assert.equal((await parsePennsylvaniaSnapshot(input(synthetic(), source({ endpoints: [endpoint] })))).health.state, "parser-failed");
  assert.equal((await parsePennsylvaniaSnapshot(input(synthetic(), source({ endpoints: [url(), url("sb1113")] })))).health.state, "parser-failed");
});

test("synthetic wrong source contracts, page identities, PN/PDF mismatches, missing and blocked bodies fail closed", async () => {
  for (const overrides of [{ desk: "news" }, { jurisdiction: "NJ" }, { authority: "secondary" }, { family: "members" },
    { transport: "rss" }, { parserId: "watch-rss" }, { parserVersion: "2" }] as Partial<SourceEnrollment>[]) {
    const result = await parsePennsylvaniaSnapshot(input(synthetic(), source(overrides)));
    assert.equal(result.health.state, "parser-failed"); assert.equal(result.observations.length, 0);
  }
  for (const body of ["", "<html>Access denied</html>", synthetic().replace("House Bill 1925 Information", "House Bill 1993 Information"),
    synthetic().replace("2025-2026 Regular Session", "2023-2024 Regular Session"),
    synthetic().replace("/HB1925/PN3963", "/HB1925/PN3349"), synthetic().replace("/HB1925/PN3963", "/SB1925/PN3963"),
    synthetic().replace("Most recent printers number", "No current printer")]) {
    const result = await parsePennsylvaniaSnapshot(input(body));
    assert.equal(result.health.state, "parser-failed", body.slice(0, 80)); assert.equal(result.observations.length, 0);
  }
  const blocked = await parsePennsylvaniaSnapshot({ ...input(synthetic()), status: 403 });
  assert.notEqual(blocked.health.state, "healthy-empty"); assert.notEqual(blocked.health.state, "healthy");
  assert.equal(blocked.observations.length, 0);
  const mismatchedBytes = await parsePennsylvaniaSnapshot({ ...input(synthetic()), representationBytes: new TextEncoder().encode("different") });
  assert.equal(mismatchedBytes.health.state, "parser-failed");
});

test("synthetic committee wording and PN conflict accept literal metadata with explicit unknown gaps, never enactment", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(AT),
    fetchImpl: async () => new Response(synthetic()) });
  assert.equal(result.sources[0].state, "healthy", JSON.stringify(result));
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  assert.equal(capture.version.nativeId, "PN 3963"); assert.equal(capture.historyComplete, false);
  assert.ok(capture.gaps.some((gap: string) => gap.includes("different PN")));
  const proposal = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM watch_editorial_drafts").get()!.payload_json));
  assert.match(proposal.draft.slug, /^pa-2025-2026-hb1925-/);
  assert.ok(proposal.draft.lifecycle.unavailableReason); assert.ok(proposal.draft.legalEffect.unavailableReason);
  assert.ok(proposal.draft.latestAction.unavailableReason);
  assert.equal(proposal.facts.find((fact: { field: string }) => fact.field === "timeline-action").value.text,
    "Re-reported as committed, PN 3349, September 30, 2026");
  assert.equal((await assertCollectedPolicySourceRule(db, capture, new Date(AT))).permissions.size, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n, 1);
  const page = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA" }, new Date(AT));
  const dossier = page.items[0]; assert.ok(dossier.kind === "policy");
  assert.equal(dossier.lifecycle, "unknown"); assert.equal(dossier.legalEffect, "unknown");
  assert.equal(dossier.latestAction, null);
  assert.ok(dossier.unknowns.some(item => item.reason.includes("different PN")));
  assert.equal(dossier.timeline[0].value.sourceOccurredAt.value, "2026-09-30");
});

test("synthetic unambiguous committee action can stage a latest action without establishing enactment", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  const wording = "Re-reported as committed, PN 3963, September 30, 2026";
  const result = await runWatchCollection(db, { enabled: true, clock: () => new Date(AT),
    fetchImpl: async () => new Response(synthetic("hb1925", "3963", wording)) });
  assert.equal(result.sources[0].state, "healthy");
  const proposal = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM watch_editorial_drafts").get()!.payload_json));
  assert.ok(proposal.draft.latestAction.factId);
  assert.equal(proposal.facts.find((fact: { field: string }) => fact.field === "latest-action").value.text, wording);
  assert.ok(proposal.draft.lifecycle.unavailableReason);
  assert.ok(proposal.draft.legalEffect.unavailableReason);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 0);
});

test("retained collection acknowledges raw before staging; unchanged 200/304 checks preserve developments and source dates", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  let nativeWrites = 0;
  const checking: D1DatabaseLike = { prepare: sql => {
    // Check before preparing the very first native write, not after its commit.
    if (/INSERT(?: OR IGNORE)? INTO (?:policy_watch_captures|watch_editorial_drafts)/.test(sql)) {
      nativeWrites++;
      assert.ok(Number(sqlite.prepare("SELECT count(*) n FROM watch_collection_pages").get()!.n) > 0);
      assert.ok(Number(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n) > 0);
    }
    return db.prepare(sql);
  }, batch: statements => db.batch(statements) };
  for (const [index, status] of [200, 200, 304].entries()) {
    const at = `2026-09-30T12:0${index * 2}:00.000Z`;
    await db.prepare("UPDATE watch_collection_state SET next_due_at=?").bind(at).run();
    const result = await runWatchCollection(checking, { enabled: true, publishVerified: true, clock: () => new Date(at),
      fetchImpl: async (_url, init) => {
        assert.equal(new Headers(init?.headers).get("accept"), "text/html,application/xhtml+xml");
        if (status === 304) assert.equal(new Headers(init?.headers).get("if-none-match"), '"offline-pa"');
        return new Response(status === 304 ? null : retained("hb1925"), { status, headers: { etag: '"offline-pa"' } });
      } });
    assert.equal(result.sources[0].state, "healthy", JSON.stringify(result));
    assert.equal(result.sources[0].health.checkedAt, at);
    assert.equal(result.sources[0].health.lastSuccessAt, at);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 1);
  }
  const raw = sqlite.prepare("SELECT representation,representation_sha256 FROM watch_raw_representations").get()!;
  assert.ok(nativeWrites > 0);
  assert.deepEqual(Buffer.from(raw.representation as Uint8Array), retained("hb1925"));
  assert.equal(raw.representation_sha256, await sha256(retained("hb1925")));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_raw_observations").get()!.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_pages").get()!.n, 3);
  assert.equal(sqlite.prepare("SELECT last_checked_at FROM watch_collection_state").get()!.last_checked_at, "2026-09-30T12:04:00.000Z");
  const value = input(); const parsed = await parsePennsylvaniaSnapshot(value);
  await assert.rejects(stageCollectedPennsylvaniaPolicy(db, value, parsed, new Map(), new Date(AT)), /acknowledgment-required/);
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  assert.equal(capture.source.retrievedAt, AT);
  assert.equal(capture.version.sourceDate, "2026-05-05");
  const actionIds = sqlite.prepare("SELECT development_id FROM policy_watch_action_revisions ORDER BY development_id").all();
  await db.prepare("UPDATE watch_collection_state SET next_due_at=?").bind("2026-09-30T12:06:00.000Z").run();
  const failed = await runWatchCollection(db, { enabled: true, clock: () => new Date("2026-09-30T12:06:00.000Z"),
    fetchImpl: async () => new Response("Forbidden", { status: 403 }) });
  assert.notEqual(failed.sources[0].state, "healthy");
  assert.equal(failed.sources[0].health.lastSuccessAt, "2026-09-30T12:04:00.000Z");
  assert.equal(failed.sources[0].health.checkedAt, "2026-09-30T12:06:00.000Z");
  assert.equal(failed.sources[0].health.state, "upstream-blocked");
  assert.equal(failed.sources[0].health.consecutiveFailures, 1);
  assert.equal(sqlite.prepare("SELECT last_success_at FROM watch_collection_state").get()!.last_success_at, "2026-09-30T12:04:00.000Z");
  assert.deepEqual(sqlite.prepare("SELECT development_id FROM policy_watch_action_revisions ORDER BY development_id").all(), actionIds);
  const page = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA" }, new Date("2026-09-30T12:06:00.000Z"));
  assert.equal(page.asOf, AT); assert.equal(page.items[0].verifiedAt, AT);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 1);
});

test("raw write failure, HTTP rejection and parser failure cannot stage or erase last successful check", async t => {
  for (const failure of ["raw-write", "http", "parser", "disabled"] as const) {
    const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
    if (failure === "raw-write") sqlite.exec("CREATE TRIGGER fail_pa_raw BEFORE INSERT ON watch_collection_pages BEGIN SELECT RAISE(ABORT,'synthetic-raw-failure'); END");
    if (failure === "disabled") sqlite.exec("UPDATE watch_collection_sources SET activation_id=NULL,activated_at=NULL");
    const result = await runWatchCollection(db, { enabled: true, clock: () => new Date(AT), fetchImpl: async () => {
      if (failure === "disabled") assert.fail("disabled source fetched");
      return new Response(failure === "parser" ? "Access denied" : retained("hb1925"), { status: failure === "http" ? 403 : 200 });
    } });
    assert.notEqual(result.sources[0].state, "healthy"); assert.notEqual(result.sources[0].state, "healthy-empty");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n, 0);
    assert.equal(sqlite.prepare("SELECT last_success_at FROM watch_collection_state").get()!.last_success_at, null);
  }
});

test("offline PA candidate preparation and synthetic named qualification dispatch each exact bill without authorizing publication", async () => {
  const approval = { engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor",
    statement: "Synthetic offline qualification approval only; this is not a current official access or production receipt.",
    reviewedAt: AT, expiresAt: "2026-10-01T00:00:00.000Z", rightsDecision: "accepted", accessDecision: "public-or-authorized-read" };
  for (const bill of ["hb1925", "hb1993", "sb1113", "hb2787"]) {
    const candidate = launchCandidate("candidate-pa-" + bill);
    // HB2787 is wholly synthetic mechanics. The other three are September 6 retained bytes.
    const bytes = bill === "hb2787" ? new TextEncoder().encode(synthetic(bill, "3918", "Referred to EDUCATION, September 24, 2026")) : retained(bill);
    const prepared = await prepareCapturedSource(candidate.source.id, bytes, AT);
    assert.equal(prepared.parsed?.health.state, "healthy");
    assert.equal(prepared.qualificationStatus, "candidate-only");
    assert.equal(prepared.publicationAuthorized, false); assert.equal(prepared.activationAuthorized, false);
    assert.equal(prepared.review.rightsDecision, null); assert.equal(candidate.source.state, "pending");
    assert.equal(candidate.source.qualificationReceiptId, null);
    const samples = ["2026-09-28T00:00:00.000Z", "2026-09-29T00:00:00.000Z"].map(capturedAt => ({
      endpoint: candidate.source.endpoints[0], capturedAt, bytes }));
    const qualified = await qualifyCapturedWatchSource(candidate.source, samples, approval);
    assert.equal(qualified.publicationAuthorized, false);
    assert.equal(qualified.qualification.samples.length, 2);
    assert.equal(qualified.qualification.configurationSha256, prepared.configurationSha256);
    await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples, { ...approval, accessDecision: "pending" }));
    await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples, { ...approval, rightsDecision: "pending" }));
    await assert.rejects(qualifyCapturedWatchSource(candidate.source, [samples[0], samples[0]], approval));
    await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples.map(item => ({ ...item, endpoint: url("hb1") })), approval));
    await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples, {}));
  }
});

test("historical retained PA pages reach actual native acceptance and PA/bill/official synopsis search with synthetic local authority", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  for (const bill of ["hb1925", "hb1993", "sb1113"]) {
    await enroll(db, source({ id: "synthetic-" + bill, endpoints: [url(bill)] }));
    const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(AT),
      fetchImpl: async endpoint => new Response(retained(String(endpoint).split("/").at(-1)!)) });
    assert.ok(result.sources.every(item => item.state === "healthy"), JSON.stringify(result));
    sqlite.exec("DELETE FROM watch_collection_hosts");
  }
  const all = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA" }, new Date(AT));
  assert.equal(all.items.length, 3); assert.equal(all.asOf, AT);
  assert.ok(all.items.every(item => item.kind === "policy" && item.lifecycle === "unknown" && item.legalEffect === "unknown"));
  for (const bill of ["HB 1925", "hb1925", "HB1993", "SB1113"]) {
    const page = await readWatchDirectory(db, { kind: "policy", jurisdiction: "PA", q: bill }, new Date(AT));
    assert.equal(page.items.length, 1, bill);
  }
  const ai = await readWatchDirectory(db, { kind: "policy", q: "artificial intelligence" }, new Date(AT));
  assert.equal(ai.items.length, 3);
  assert.equal((await readWatchDirectory(db, { kind: "policy", jurisdiction: "NJ" }, new Date(AT))).items.length, 0);
  assert.equal((await readWatchDirectory(db, { kind: "policy", stage: "adopted" }, new Date(AT))).items.length, 0);
  assert.equal((await readWatchDirectory(db, { kind: "policy", q: "HB2787" }, new Date(AT))).items.length, 0);
  const stored = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures WHERE source_url=?").get(url("hb1993"))!.payload_json));
  const material = await materializePolicyCapture(stored);
  assert.equal(material.summary!.value, "An Act providing for the use of artificial intelligence in mental health therapy and for enforcement.");
  assert.equal(material.evidence.find(item => item.id === material.summary!.evidenceId)!.pointer, "/native/synopsis");
  // Retracting the synopsis must also remove its optional search match.
  const manifest = JSON.parse(String(sqlite.prepare("SELECT manifest_json FROM watch_delivery_manifests WHERE subject_id=?").get(material.subjectId)!.manifest_json));
  const summary = manifest.groups.find((group: { field: string }) => group.field === "summary");
  const dependency = summary.dependencies.find((item: { kind: string }) => item.kind === "evidence");
  await recordWatchDependencyHead(db, { key: dependency.key, kind: "evidence", revision: 2, digest: null,
    immutableRecordId: "synthetic-synopsis-retraction", changedAt: AT });
  assert.equal((await readWatchDirectory(db, { kind: "policy", q: "mental health therapy" }, new Date(AT))).items.length, 0);
  const identityResult = await readWatchDirectory(db, { kind: "policy", q: "HB1993" }, new Date(AT));
  assert.equal(identityResult.items.length, 1);
  assert.ok(identityResult.items[0].kind === "policy"); assert.equal(identityResult.items[0].summary, null);
});

test("synthetic PA collector proof rejects source/session/chamber/bill/text mismatch and replay tampering", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  await runWatchCollection(db, { enabled: true, clock: () => new Date(AT), fetchImpl: async () => new Response(retained("hb1925")) });
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  const changes = [
    { source: { ...capture.source, sourceId: "synthetic-other-source" } },
    { source: { ...capture.source, sourceUrl: url("hb1993") } },
    ...[{ sessionKey: "2023-2024" }, { bodyId: "pa-senate" }, { sourceInstrumentId: "HB 1993" }].map(change => ({ identity: { ...capture.identity, ...change } })),
    ...[{ nativeId: "PN 3963" }, { textUrl: capture.version.textUrl.replace("HB1925", "SB1113") }, { sourceDate: "2026-09-29" }].map(change => ({ version: { ...capture.version, ...change } })),
    { title: "Operator research label: AI enacted" },
    { native: { ...capture.native, html: capture.native.html.replace("HB1925/PN3349", "HB1925/PN3963") } },
    { native: { ...capture.native, synopsis: "Model-written claim that this bill became law" } },
    { actions: [{ ...capture.actions[0], text: "Synthetic invented enactment", rawDate: "2026-09-30" }] },
    { historyComplete: !capture.historyComplete },
    { parserVersion: "pa-bill-history-html-1" },
  ];
  for (const change of changes) await assert.rejects(assertCollectedPolicySourceRule(db, { ...capture, ...change }, new Date(AT)));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n, 0);
});

test("synthetic raw/page/observation corruption or missing acknowledgment cannot prove a PA capture", async t => {
  for (const fault of ["bytes", "observation", "page", "missing-page"] as const) {
    const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
    await runWatchCollection(db, { enabled: true, clock: () => new Date(AT), fetchImpl: async () => new Response(retained("hb1925")) });
    const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
    // Deliberate local fault injection: storage's immutable triggers otherwise reject these writes.
    if (fault === "bytes") {
      sqlite.exec("DROP TRIGGER watch_raw_representation_immutable");
      sqlite.prepare("UPDATE watch_raw_representations SET representation=?").run(new TextEncoder().encode("tampered bytes"));
    } else if (fault === "observation") {
      sqlite.exec("DROP TRIGGER watch_raw_observation_immutable");
      const observation = JSON.parse(String(sqlite.prepare("SELECT observation_json FROM watch_raw_observations").get()!.observation_json));
      observation.payload.version.nativeId = "PN 9999";
      observation.payloadSha256 = await sha256(canonicalJson(observation.payload));
      sqlite.prepare("UPDATE watch_raw_observations SET observation_json=?,payload_sha256=?")
        .run(canonicalJson(observation), observation.payloadSha256);
    } else if (fault === "page") {
      sqlite.exec("DROP TRIGGER watch_collection_page_immutable");
      sqlite.exec("UPDATE watch_collection_pages SET page_json=json_set(page_json,'$.state','parser-failed')");
    } else {
      sqlite.exec("DROP TRIGGER watch_collection_page_no_delete; DELETE FROM watch_collection_pages");
    }
    await assert.rejects(assertCollectedPolicySourceRule(db, capture, new Date(AT)), /collector-required/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 0);
  }
});

test("synthetic PA acceptance fails for unqualified, expired, revoked or changed enrollment/config/permission", async t => {
  for (const fault of ["unqualified", "expired", "revoked", "configuration", "permission", "qualification"] as const) {
    const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
    await runWatchCollection(db, { enabled: true, clock: () => new Date(AT), fetchImpl: async () => new Response(retained("hb1925")) });
    const request = sqlite.prepare("SELECT id,input_sha256 FROM watch_editorial_drafts").get()!;
    let now = new Date(AT);
    if (fault === "unqualified") sqlite.exec("UPDATE watch_collection_sources SET configuration_json=json_set(configuration_json,'$.state','pending')");
    if (fault === "expired") now = new Date("2026-10-01T00:00:00.000Z");
    if (fault === "revoked") sqlite.exec(`UPDATE watch_collection_reviews SET revoked_at='${AT}'`);
    if (fault === "configuration") sqlite.exec("UPDATE watch_collection_sources SET configuration_json=json_set(configuration_json,'$.maxItems',49)");
    if (fault === "qualification") sqlite.exec("UPDATE watch_collection_sources SET qualification_json=json_set(qualification_json,'$.accessDecision','pending')");
    if (fault === "permission") await recordWatchDependencyHead(db, {
      key: await deliveryDependencyKey("source-permission", [source().id]), kind: "source-permission", revision: 2, digest: null,
      immutableRecordId: "synthetic-permission-retraction", changedAt: AT });
    await assert.rejects(decideSourceRulePolicyProposal(db, { id: String(request.id), sha256: String(request.input_sha256) }, createWatchEditorialRuntime(db), now));
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 0);
  }
});

test("synthetic PA raw and qualification races are fenced in the actual acceptance transaction", async t => {
  for (const fault of ["raw", "permission"] as const) {
    const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
    await runWatchCollection(db, { enabled: true, clock: () => new Date(AT), fetchImpl: async () => new Response(retained("hb1925")) });
    const request = sqlite.prepare("SELECT id,input_sha256 FROM watch_editorial_drafts").get()!;
    const original = createWatchEditorialRuntime(db);
    const runtime: EditorialRuntime = { async resolveContext(proposal, now) {
      const context = await original.resolveContext(proposal, now);
      return { ...context, async acceptanceGuards(decisionId) {
        const guards = await context.acceptanceGuards(decisionId);
        if (fault === "raw") {
          sqlite.exec("DROP TRIGGER watch_raw_observation_immutable");
          sqlite.exec("UPDATE watch_raw_observations SET observation_json=json_set(observation_json,'$.payload.gaps[0]','tampered after proof')");
        } else sqlite.exec(`UPDATE watch_collection_reviews SET revoked_at='${AT}'`);
        return guards;
      } };
    } };
    await assert.rejects(decideSourceRulePolicyProposal(db, { id: String(request.id), sha256: String(request.input_sha256) }, runtime, new Date(AT)), /CHECK constraint/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_decisions").get()!.n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 0);
  }
});

test("synthetic incomplete history retains dated literal latest-action evidence without inventing chronology or enactment", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  const body = synthetic("hb1925", "3963", "Re-reported as committed, PN 3963, September 30, 2026")
    .replace("</table>", "<tr><td>2</td><td>Committee vote 37-0, date unavailable</td></tr></table>");
  const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(AT), fetchImpl: async () => new Response(body) });
  assert.equal(result.sources[0].state, "healthy");
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  assert.equal(capture.native.record.actionAt, "2026-09-30T00:00:00.000Z");
  assert.equal(capture.version.sourceDate, "2026-09-29"); assert.equal(capture.historyComplete, false);
  const page = await readWatchDirectory(db, { kind: "policy" }, new Date(AT));
  const dossier = page.items[0]; assert.ok(dossier.kind === "policy");
  assert.equal(dossier.latestAction, null); assert.equal(dossier.lifecycle, "unknown"); assert.equal(dossier.legalEffect, "unknown");
  assert.match(dossier.timeline[0].value.text, /Re-reported as committed/);
});

test("synthetic review-only staging can later accept unchanged 304 under the explicit option without rewriting capture time", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  const first = await runWatchCollection(db, { enabled: true, clock: () => new Date(AT),
    fetchImpl: async () => new Response(retained("hb1925"), { headers: { etag: '"synthetic-pa"' } }) });
  assert.equal(first.sources[0].state, "healthy");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_public_revisions").get()!.n, 0);
  const later = "2026-09-30T12:02:00.000Z";
  sqlite.prepare("UPDATE watch_collection_state SET next_due_at=?").run(later);
  const checked = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(later),
    fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(checked.sources[0].state, "healthy"); assert.equal(checked.sources[0].health.lastSuccessAt, later);
  const page = await readWatchDirectory(db, { kind: "policy", q: "HB1925" }, new Date(later));
  assert.equal(page.items.length, 1); assert.equal(page.items[0].verifiedAt, later);
  assert.equal(sqlite.prepare("SELECT retrieved_at FROM policy_watch_captures").get()!.retrieved_at, AT);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM policy_watch_captures").get()!.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_editorial_drafts").get()!.n, 1);
});

test("synthetic repeated unchanged checks keep one raw replay row and one accepted development beyond the proof scan bound", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  for (let index = 0; index < 34; index++) {
    const at = new Date(Date.parse(AT) + index * 120_000).toISOString();
    sqlite.prepare("UPDATE watch_collection_state SET next_due_at=?").run(at);
    const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(at),
      fetchImpl: async () => new Response(index ? null : retained("hb1925"), {
        status: index ? 304 : 200, headers: index ? undefined : { etag: '"synthetic-pa-repeat"' } }) });
    assert.equal(result.sources[0].state, "healthy"); assert.equal(result.sources[0].health.lastSuccessAt, at);
  }
  assert.equal(sqlite.prepare("SELECT count(*) n FROM watch_collection_pages").get()!.n, 34);
  for (const table of ["watch_raw_observations", "policy_watch_captures", "watch_editorial_drafts", "watch_public_revisions"]) {
    assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 1, table);
  }
  let replayRows = -1;
  const checking: D1DatabaseLike = { prepare(sql) {
    const wrap = (statement: ReturnType<D1DatabaseLike["prepare"]>): ReturnType<D1DatabaseLike["prepare"]> => ({
      bind: (...values) => wrap(statement.bind(...values)), first: <T>() => statement.first<T>(), run: () => statement.run(),
      async all<T>() { const result = await statement.all<T>();
        if (sql.includes("o.id AS observation_id")) replayRows = result.results?.length ?? -1;
        return result; },
    });
    return wrap(db.prepare(sql));
  }, batch: statements => db.batch(statements) };
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  await assertCollectedPolicySourceRule(checking, capture, new Date(Date.parse(AT) + 34 * 120_000));
  assert.equal(replayRows, 1);
});

test("synthetic latest-action literal absent from history stays independently cited and chronology remains unknown", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close()); await enroll(db);
  const latest = "Re-reported as committed, PN 3963, September 30, 2026";
  const prior = "Referred to HEALTH, September 24, 2026";
  const body = synthetic("hb1925", "3963", latest).replace(`<td>${latest}</td>`, `<td>${prior}</td>`);
  const result = await runWatchCollection(db, { enabled: true, publishVerified: true, clock: () => new Date(AT), fetchImpl: async () => new Response(body) });
  assert.equal(result.sources[0].state, "healthy");
  const capture = JSON.parse(String(sqlite.prepare("SELECT payload_json FROM policy_watch_captures").get()!.payload_json));
  assert.equal(capture.historyComplete, false);
  assert.ok(capture.actions.some((action: { text: string; pointer: string }) => action.text === latest && action.pointer === "/native/record"));
  const page = await readWatchDirectory(db, { kind: "policy" }, new Date(AT));
  const dossier = page.items[0]; assert.ok(dossier.kind === "policy");
  assert.equal(dossier.latestAction, null);
  assert.ok(dossier.unknowns.some(item => item.reason.includes("not reconciled")));
  assert.equal(dossier.timeline.at(-1)!.value.text, latest);
  assert.equal(dossier.timeline.at(-1)!.value.sourceOccurredAt.value, "2026-09-30");
});
