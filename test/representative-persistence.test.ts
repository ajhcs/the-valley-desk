import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { stageRepresentativeDraft, decideRepresentativeDraft, readRepresentatives } from "../src/ingest/representative-persistence";
import { handleRepresentativeRead, handleRepresentativeReview } from "../src/ingest/representative-api";
import { parseSenateRoster, collectSenateRoster, persistSenateRosterObservation } from "../src/ingest/representative-collection";
import { makeRepresentativeFixture, FIXTURE_NOW } from "./fixtures/watch-representatives/synthetic";
import type { D1DatabaseLike } from "../src/ingest/persistence";

test("persistent representative acceptance, stale review, turnover and public API", { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ WATCH_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL("./fixtures/watch-d1/wrangler.jsonc", import.meta.url)), envFiles: [], persist: false, remoteBindings: false });
  t.after(() => proxy.dispose());
  const db = proxy.env.WATCH_TEST_DB;
  await db.batch(unstable_splitSqlQuery(readFileSync(new URL("../migrations/0032_watch_representatives.sql", import.meta.url), "utf8")).map(sql => db.prepare(sql)));
  const fixture = await makeRepresentativeFixture(), now = new Date(FIXTURE_NOW), policy = fixture.context;
  const draft = { id: "stored-directory", expectedRevision: 0, scope: fixture.snapshot.scope, rosterFactId: fixture.snapshot.rosterFactId,
    facts: [...fixture.facts.values()], evidence: [...fixture.evidence.values()], observations: [...fixture.observations.values()] };
  const staged = await stageRepresentativeDraft(db, draft, now);
  assert.equal((await readRepresentatives(db, fixture.query, policy, now)).dataState, "unavailable");
  await assert.rejects(decideRepresentativeDraft(db, { ...staged, sha256: "0".repeat(64), decision: "accepted" }, "reviewer", policy, now));
  await decideRepresentativeDraft(db, { ...staged, decision: "accepted" }, "reviewer", policy, now);
  assert.equal((await readRepresentatives(db, fixture.query, policy, now)).offices[0].members.length, 2);
  assert.equal((await readRepresentatives(db, { ...fixture.query, districtId: "fixture-district-03" }, policy, now)).offices[0].seats.verifiedVacant, 1);
  assert.equal((await readRepresentatives(db, { ...fixture.query, asOf: "2025-12-31" }, policy, now)).offices[0].members[0].membershipId, "fixture-membership-old");
  const stale = await readRepresentatives(db, { ...fixture.query, asOf: "2026-09-14" }, policy, new Date("2026-09-14T12:00:00.000Z"));
  assert.equal(stale.dataState, "stale"); assert.equal(stale.offices[0].members[0].state, "last-known");
  assert.equal((await decideRepresentativeDraft(db, { ...staged, decision: "accepted" }, "reviewer", policy, now)).outcome, "unchanged");
  const conflict = await stageRepresentativeDraft(db, { ...draft, id: "stale-directory" }, now);
  await assert.rejects(decideRepresentativeDraft(db, { ...conflict, decision: "accepted" }, "reviewer", policy, now), /representative-stale-review/);
  assert.equal(await db.prepare("SELECT * FROM representative_decisions WHERE draft_id='stale-directory'").first(), null);
  await assert.rejects(db.prepare("UPDATE representative_drafts SET payload_json='{}'").run(), /representative-immutable/);
  await assert.rejects(readRepresentatives(db, fixture.query, { ...policy, officialSources: new Map() }, now));
  const env = { VALLEY_DESK_DB: db, WATCH_PUBLIC_ENABLED: "true" };
  const url = "https://fixture.invalid/api/v2/watch/representatives?" + new URLSearchParams(fixture.query);
  assert.equal((await handleRepresentativeRead(new Request(url), { ...env, WATCH_PUBLIC_ENABLED: "false" }, policy)).status, 503);
  const head = await handleRepresentativeRead(new Request(url, { method: "HEAD" }), env, policy);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal((await handleRepresentativeRead(new Request(url + "&asOf=2026-09-12"), env, policy)).status, 400);
  const privateUrl = "https://fixture.invalid/api/representative-drafts/stored-directory";
  assert.equal((await handleRepresentativeReview(new Request(privateUrl), env, policy, async () => null)).status, 404);
  assert.equal((await handleRepresentativeReview(new Request(privateUrl), env, policy, async () => "reviewer")).status, 200);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  const xml = "<contact_information>" + member + member.replace("F000001", "F000002").replace("<state>PA", "<state>NJ") + "</contact_information>";
  const observed = await persistSenateRosterObservation(db, xml, FIXTURE_NOW);
  assert.equal((await persistSenateRosterObservation(db, xml, FIXTURE_NOW)).id, observed.id);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM representative_roster_observations").first<{ count: number }>())!.count, 1);
  await assert.rejects(db.prepare("UPDATE representative_roster_observations SET raw_text='changed'").run(), /representative-immutable/);
  assert.equal((await handleRepresentativeReview(new Request(privateUrl + "/decision", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: staged.sha256, decision: "accepted", reviewerId: "forged" }) }),
    env, policy, async () => "real-reviewer")).status, 400);
  const invalid = structuredClone(draft);
  invalid.id = "invalid-evidence"; invalid.expectedRevision = 1; invalid.observations[0].representation = "{}";
  const bad = await stageRepresentativeDraft(db, invalid, now);
  await assert.rejects(decideRepresentativeDraft(db, { ...bad, decision: "accepted" }, "reviewer", policy, now));
  assert.equal(await db.prepare("SELECT * FROM representative_decisions WHERE draft_id='invalid-evidence'").first(), null);
  const next = await stageRepresentativeDraft(db, { ...draft, id: "next", expectedRevision: 1 }, now);
  const broken: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([...statements,
    db.prepare("INSERT INTO representative_heads VALUES('invalid',0,'missing')")]) };
  await assert.rejects(decideRepresentativeDraft(broken, { ...next, decision: "accepted" }, "reviewer", policy, now));
  assert.equal(await db.prepare("SELECT * FROM representative_decisions WHERE draft_id='next'").first(), null);
});

const member = '<member><first_name>Fixture</first_name><last_name>Member</last_name><state>PA</state><party>D</party><bioguide_id>F000001</bioguide_id><website>https://fixture.senate.gov/</website><class>Class I</class></member>';
test("Senate observations retain unknown terms and do not infer vacancy", async () => {
  const xml = "<contact_information>" + member + member.replace("F000001", "F000002").replace("<state>PA", "<state>NJ") + "</contact_information>";
  const result = await parseSenateRoster(xml, FIXTURE_NOW);
  assert.equal(result.members.length, 2); assert.equal(result.members[0].validFrom, null); assert.equal(result.acceptance, "unreviewed");
  await assert.rejects(parseSenateRoster(xml.replace("F000002", "F000001"), FIXTURE_NOW), /duplicate/);
  await assert.rejects(parseSenateRoster("<!DOCTYPE foo>" + xml, FIXTURE_NOW));
  await assert.rejects(parseSenateRoster(xml.replace("fixture.senate.gov", "evil.invalid"), FIXTURE_NOW), /profile-url/);
  await assert.rejects(collectSenateRoster(async () => new Response("", { status: 403 }), new Date(FIXTURE_NOW)), /403/);
});
