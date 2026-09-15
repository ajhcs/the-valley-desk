import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pdfDatabase } from "./helpers/policy-pdf";
import { buildRepresentativeRosterDraft, preparePaRosterCapture, prepareNjRosterCaptures, prepareHouseRosterCaptures } from "../src/ingest/representative-roster-drafts";
import { collectHouseRoster, parseHouseRoster, HOUSE_ROSTER_URL } from "../src/ingest/house-representative-collection";
import { REPRESENTATIVE_ROSTER_ENDPOINTS } from "../src/content/representative-sources";
import { stageRepresentativeDraft, decideRepresentativeDraft, readRepresentatives } from "../src/ingest/representative-persistence";
import { resolveRepresentativeSourcePolicy } from "../src/ingest/representative-runtime";
import { RepresentativeMembership, RepresentativeOffice } from "../src/content/watch-representatives";
import { acceptedFactDigest, canonicalJson, sha256 } from "../src/content/watch-schema";
import { rssSource } from "./fixtures/watch-adapters/synthetic";
import { sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import { configureWatchCollectionSource } from "../src/ingest/watch/collection-storage";
import type { D1DatabaseLike } from "../src/ingest/persistence";
const NOW = "2026-09-12T12:00:00.000Z";
const houseExcerpt = readFileSync(new URL("./fixtures/watch-representatives/house-clerk-excerpt-20260915.xml", import.meta.url), "utf8");

test("actual Clerk excerpts stage regional House members with observation-only terms", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const observedAt = "2026-09-15T14:48:55.686Z";
  const parsed = await parseHouseRoster(houseExcerpt, observedAt);
  assert.deepEqual(parsed.members.map(row => row.nativeId), ["M001238", "N000188", "F000466"]);
  assert.equal(parsed.sourceLastUpdated, "September 2, 2026");
  assert.equal(parsed.congress, "119");
  assert.equal(parsed.rawSha256, await sha256(houseExcerpt));
  assert.deepEqual(REPRESENTATIVE_ROSTER_ENDPOINTS.find(row => row.url === HOUSE_ROSTER_URL)?.bodyIds, ["us-house"]);
  const captures = await prepareHouseRosterCaptures(houseExcerpt, "unqualified-house-source", observedAt);
  assert.deepEqual(captures.map(row => row.jurisdictionId), ["us-pa", "us-nj", "us-de"]);
  for (const capture of captures) {
    const draft = await buildRepresentativeRosterDraft(capture, 0);
    const office = draft.facts.find(fact => fact.field === "representative-office")!.value as { district: { type: string } };
    assert.equal(office.district.type, capture.jurisdictionId === "us-de" ? "at-large" : "district");
    for (const fact of draft.facts.filter(fact => fact.field === "representative-membership")) {
      assert.equal((fact.value as Record<string, unknown>).validFrom, null);
      assert.equal((fact.value as Record<string, unknown>).validTo, null);
      assert.equal((fact.value as Record<string, unknown>).observedAt, observedAt);
      assert.ok(!("verification" in fact));
    }
    await stageRepresentativeDraft(db, draft, new Date(observedAt));
  }
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM representative_decisions").get()!.n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM representative_heads").get()!.n, 0);
});

test("House parsing rejects duplicates, conflicting districts, malicious XML and oversized inputs", async () => {
  await assert.rejects(parseHouseRoster(houseExcerpt.replace("PA01", "NJ01"), NOW), /seat-conflict/);
  await assert.rejects(parseHouseRoster(houseExcerpt.replace("F000466", "N000188"), NOW), /duplicate-member/);
  await assert.rejects(parseHouseRoster(houseExcerpt.replace('postal-code="PA"', 'postal-code="NJ"'), NOW), /district-conflict/);
  await assert.rejects(parseHouseRoster(houseExcerpt.replace("At Large", "1st"), NOW), /district-conflict/);
  await assert.rejects(parseHouseRoster("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///x'>]>" + houseExcerpt, NOW), /roster-invalid/);
  await assert.rejects(parseHouseRoster("x".repeat(1_000_001), NOW), /roster-invalid/);
  const outside = houseExcerpt.replaceAll("PA01", "CA01").replaceAll('postal-code="PA"', 'postal-code="CA"');
  assert.equal((await parseHouseRoster(outside, NOW)).members.length, 2);
});

test("House collection is one fixed unauthenticated request and stops on upstream denial", async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++; assert.equal(url, HOUSE_ROSTER_URL); assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return new Response(houseExcerpt);
  }) as typeof fetch;
  const result = await collectHouseRoster(fetcher, new Date(NOW));
  assert.equal(result.xml, houseExcerpt); assert.equal(calls, 1);
  await assert.rejects(collectHouseRoster((async () => { calls++; return new Response("Denied", { status: 403 }); }) as typeof fetch), /upstream-403/);
  assert.equal(calls, 2);
});
function capture() {
  return preparePaRosterCapture({ rawSha256: "a".repeat(64), rows: [{ district: "001", party: "D",
    displayName: "Synthetic Roster Member", profile: "/senate/members/bio/123/sen-fixture" }] }, "synthetic-roster", NOW, "senate");
}
async function enrolled(db: D1DatabaseLike) {
  const source = rssSource({ id: "synthetic-roster", desk: "policy", jurisdiction: "PA", family: "members", authority: "official",
    state: "qualified", qualificationReceiptId: "synthetic-qualification", endpoints: [capture().sourceUrl],
    linkScopes: [{ host: "www.palegis.us", pathPrefix: "/" }] });
  const qualification = { id: "synthetic-qualification", sourceId: source.id, configurationSha256: await sourceConfigurationDigest(source),
    reviewedAt: NOW, expiresAt: "2026-10-01T00:00:00.000Z", engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-editor",
    reviewEvidenceId: "synthetic-source-review", rightsDecision: "accepted", accessDecision: "public-or-authorized-read",
    negativeFixtureSha256: await sha256("negative"), replayFixtureSha256: await sha256("replay"),
    samples: ["2026-09-10T12:00:00.000Z", "2026-09-11T12:00:00.000Z"].map(capturedAt => ({ endpoint: source.endpoints[0],
      representationSha256: "b".repeat(64), capturedAt, parserVersion: source.parserVersion, itemCount: 1, outcome: "parsed" })) };
  await db.prepare("INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)").bind(qualification.reviewEvidenceId,
    qualification.engineeringOwnerId, qualification.editorialOwnerId, await sha256("synthetic authority"),
    await sha256(canonicalJson(qualification)), NOW).run();
  await configureWatchCollectionSource(db, { source, qualification, activationId: "synthetic-activation", cadenceSeconds: 3600, expectedRevision: 0 }, NOW);
  return resolveRepresentativeSourcePolicy(db, new Date(NOW));
}
const query = { jurisdiction: "PA", jurisdictionId: "pa", bodyId: "pa-senate", asOf: "2026-09-12" };

test("review-only observed rosters show current names without manufacturing historical terms", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const policy = await enrolled(db), draft = await buildRepresentativeRosterDraft(capture(), 0);
  assert.equal(policy.officialSources.get("synthetic-roster")!.bodyIds.has("pa-house"), false);
  assert.ok(draft.facts.every(fact => !("verification" in fact)));
  const staged = await stageRepresentativeDraft(db, draft, new Date(NOW));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM representative_decisions").get()!.n, 0);
  assert.equal((await readRepresentatives(db, query, policy, new Date(NOW))).dataState, "unavailable");
  await decideRepresentativeDraft(db, { ...staged, decision: "accepted" }, "synthetic-authenticated-reviewer", policy, new Date(NOW));
  const current = await readRepresentatives(db, query, policy, new Date(NOW));
  assert.equal(current.offices[0]!.members[0]!.displayName, "Synthetic Roster Member");
  assert.equal(current.offices[0]!.members[0]!.state, "observed-current");
  assert.equal(current.offices[0]!.members[0]!.validFrom, null);
  assert.equal(current.offices[0]!.members[0]!.validTo, null);
  assert.equal(current.offices[0]!.members[0]!.observedAt, NOW);
  const historical = await readRepresentatives(db, { ...query, asOf: "2026-09-11" }, policy, new Date(NOW));
  assert.equal(historical.unavailableReason, "historical-coverage-unavailable");
  assert.equal(historical.offices.length, 0);
  const stale = await readRepresentatives(db, { ...query, asOf: "2026-09-19" }, policy, new Date("2026-09-19T12:00:00.000Z"));
  assert.equal(stale.dataState, "stale"); assert.equal(stale.offices[0]!.members[0]!.state, "last-known");
  assert.equal(stale.offices[0]!.seats.verifiedFilled, 0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});

test("new snapshot fact authority is the authenticated reviewer, not staged verifier labels", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const policy = await enrolled(db), draft = await buildRepresentativeRosterDraft(capture(), 0);
  const verification = { kind: "source-rule", ruleId: "forged-rule", ruleVersion: "forged", verifierId: "forged-actor", verifiedAt: NOW };
  const staged = await stageRepresentativeDraft(db, { ...draft, facts: draft.facts.map(fact => ({ ...fact, verification })) }, new Date(NOW));
  await decideRepresentativeDraft(db, { ...staged, decision: "accepted" }, "real-authenticated-actor", policy, new Date(NOW));
  const row = sqlite.prepare("SELECT * FROM representative_decisions").get()!;
  const snapshot = JSON.parse(String(row.snapshot_json));
  assert.equal(row.reviewer_id, "real-authenticated-actor");
  assert.equal(snapshot.reviewBindingVersion, "authenticated-review-1");
  for (const fact of draft.facts) assert.equal(snapshot.factDigests.find((item: { id: string }) => item.id === fact.id).sha256,
    await acceptedFactDigest({ ...fact, verification: { kind: "human-review", ruleId: "representative-roster-review",
      ruleVersion: "authenticated-review-1", verifierId: "real-authenticated-actor", verifiedAt: NOW } }));
  assert.equal((await readRepresentatives(db, query, policy, new Date(NOW))).offices.length, 1);
});

test("source qualification revoked after resolution aborts all representative acceptance writes", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const policy = await enrolled(db), draft = await buildRepresentativeRosterDraft(capture(), 0);
  const staged = await stageRepresentativeDraft(db, draft, new Date(NOW));
  await assert.rejects(decideRepresentativeDraft(db, { ...staged, decision: "accepted" }, "reviewer", { ...policy, acceptanceGuards: undefined }, new Date(NOW)), /guards-required/);
  const racing: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => {
    sqlite.exec("UPDATE watch_collection_reviews SET revoked_at='2026-09-12T12:00:00.000Z'");
    return db.batch(statements);
  } };
  await assert.rejects(decideRepresentativeDraft(racing, { ...staged, decision: "accepted" }, "reviewer", policy, new Date(NOW)));
  for (const table of ["representative_decisions", "representative_heads", "watch_collection_acceptance_guards"])
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM " + table).get()!.n, 0);
});

test("observation mode cannot acquire invented starts or omit its observation instant", async () => {
  const draft = await buildRepresentativeRosterDraft(capture(), 0);
  assert.notEqual(draft.id, (await buildRepresentativeRosterDraft(capture(), 1)).id);
  for (const [field, schema] of [["representative-office", RepresentativeOffice], ["representative-membership", RepresentativeMembership]] as const) {
    const value = draft.facts.find(fact => fact.field === field)!.value as Record<string, unknown>;
    assert.doesNotThrow(() => schema.parse(value));
    assert.throws(() => schema.parse({ ...value, validFrom: "2026-01-01" }));
    assert.throws(() => schema.parse({ ...value, observedAt: undefined }));
    assert.throws(() => schema.parse({ ...value, datePrecision: "day" }));
  }
});

test("NJ roster joins exact biography identities but never converts service years into term dates", async () => {
  const rows = [{ House: "S", LegStatus: "Active", "Roster Key": "1", District: "1", Firstname: "Synthetic", LastName: "Senator", Party: "D" },
    { House: "A", LegStatus: "Active", "Roster Key": "2", District: "1", Firstname: "Synthetic", LastName: "Assembly", Party: "R" }];
  const input = { rawSha256: "a".repeat(64), tables: { "ROSTER.TXT": rows, "LEGBIO.TXT": [
    { "Roster Key": "1", First_Name: "Synthetic", Last_Name: "Senator", LegService: "Senate 2026-present" },
    { "Roster Key": "2", First_Name: "Synthetic", Last_Name: "Assembly", LegService: "General Assembly 2026-present" }] } };
  for (const source of prepareNjRosterCaptures(input, "synthetic-nj", NOW)) {
    const draft = await buildRepresentativeRosterDraft(source, 0);
    assert.ok(draft.facts.filter(fact => fact.field === "representative-membership").every(fact => (fact.value as { validFrom: unknown }).validFrom === null));
  }
  input.tables["LEGBIO.TXT"][0]!.Last_Name = "Wrong person";
  assert.throws(() => prepareNjRosterCaptures(input, "synthetic-nj", NOW), /biography-conflict/);
});
