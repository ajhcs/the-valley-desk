import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pdfDatabase } from "./helpers/policy-pdf";
import { stageFederalRosterXml } from "../src/ingest/representative-roster-intake";
import { acceptFederalRosterSourceRule, readRepresentatives, stageRepresentativeDraft } from "../src/ingest/representative-persistence";
import { SENATE_ROSTER_URL } from "../src/ingest/representative-collection";
import { prepareSenateRosterCaptures, buildRepresentativeRosterDraft } from "../src/ingest/representative-roster-drafts";
import type { D1DatabaseLike } from "../src/ingest/persistence";
import type { RepresentativeSourcePolicy } from "../src/ingest/representative-persistence";

const NOW = "2026-09-15T15:00:00.000Z";
const sourceId = "synthetic-senate";
const xml = "<contact_information>" + ["PA", "NJ", "DE"].flatMap((state, i) => [0, 1].map(j =>
  `<member><first_name>Synthetic</first_name><last_name>Member${i}${j}</last_name><state>${state}</state><party>I</party><bioguide_id>S0000${i}${j}</bioguide_id><website>https://www.senate.gov/</website><class>${j + 1}</class></member>`
)).join("") + "</contact_information>";
function policy(db: D1DatabaseLike): RepresentativeSourcePolicy {
  return { officialSources: new Map([[sourceId, { jurisdictionIds: new Set(["us-pa", "us-nj", "us-de"]),
    bodyIds: new Set(["us-senate"]), purposes: new Set(["person", "office", "membership", "roster"]) }]]),
    sourceUrlAllowed: (id, url) => id === sourceId && url === SENATE_ROSTER_URL,
    officialPublicUrlAllowed: url => url.startsWith("https://www.senate.gov/"),
    maxRosterAgeHours: 168, acceptanceGuards: () => [db.prepare("SELECT 1")] };
}
async function intake(db: D1DatabaseLike, value = xml) {
  return stageFederalRosterXml(db, { sourceId, sourceUrl: SENATE_ROSTER_URL, xml: value, observedAt: NOW }, new Date(NOW));
}
test("deterministic complete roster publishes observed memberships with source-rule provenance and no invented terms", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const result = await intake(db);
  assert.equal(result.drafts.length, 3);
  for (const draft of result.drafts) await acceptFederalRosterSourceRule(db,
    { draftId: draft.id, observationId: result.observationId, sourceId }, policy(db), new Date(NOW));
  const records = sqlite.prepare("SELECT * FROM representative_decisions").all();
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.equal(record.reviewer_id, "source-rule:official-roster");
    assert.equal(JSON.parse(String(record.snapshot_json)).reviewBindingVersion, "source-rule-roster-1");
  }
  const current = await readRepresentatives(db, { jurisdiction: "federal", jurisdictionId: "us-pa", bodyId: "us-senate",
    asOf: "2026-09-15" }, policy(db), new Date(NOW));
  assert.equal(current.offices[0].members.length, 2);
  assert.equal(current.offices[0].members[0].validFrom, null);
  assert.equal(current.offices[0].members[0].state, "observed-current");
  const next = await stageFederalRosterXml(db, { sourceId, sourceUrl: SENATE_ROSTER_URL, xml,
    observedAt: "2026-09-15T15:01:00.000Z" }, new Date("2026-09-15T15:01:00.000Z"));
  assert.notEqual(next.drafts[0].id, result.drafts[0].id);
  assert.equal(sqlite.prepare("SELECT expected_revision FROM representative_drafts WHERE id=?").get(next.drafts[0].id)!.expected_revision, 1);
});
test("source rule rejects tampered draft values, incomplete rosters, absent guards, and unqualified sources", async t => {
  const { db, sqlite } = pdfDatabase(); t.after(() => sqlite.close());
  const result = await intake(db), capture = (await prepareSenateRosterCaptures(xml, sourceId, NOW))[0];
  const draft = await buildRepresentativeRosterDraft(capture, 0);
  draft.id = "synthetic-tampered";
  const staged = await stageRepresentativeDraft(db, draft, new Date(NOW));
  await assert.rejects(acceptFederalRosterSourceRule(db, { draftId: staged.id, observationId: result.observationId, sourceId },
    policy(db), new Date(NOW)), /source-rule-mismatch/);
  const input = { draftId: result.drafts[0].id, observationId: result.observationId, sourceId };
  await assert.rejects(acceptFederalRosterSourceRule(db, input, { ...policy(db), acceptanceGuards: undefined }, new Date(NOW)), /guards-required/);
  await assert.rejects(acceptFederalRosterSourceRule(db, input, { ...policy(db), officialSources: new Map() }, new Date(NOW)));
  const partial = await intake(db, xml.replace(/<member>.*?<\/member>/, ""));
  await assert.rejects(acceptFederalRosterSourceRule(db, { draftId: partial.drafts[0].id,
    observationId: partial.observationId, sourceId }, policy(db), new Date(NOW)), /roster-incomplete/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM representative_heads").get()!.n, 0);
});
test("raw retention migration preserves existing bytes, immutability, and bounded one-megabyte storage", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync(new URL("../migrations/0032_watch_representatives.sql", import.meta.url), "utf8"));
    sqlite.prepare("INSERT INTO representative_roster_observations VALUES(?,?,?,?,?,?)").run("old", SENATE_ROSTER_URL, NOW, "hash", "original", "{}");
    sqlite.exec(readFileSync(new URL("../migrations/0037_representative_raw_retention.sql", import.meta.url), "utf8"));
    assert.equal(sqlite.prepare("SELECT raw_text FROM representative_roster_observations WHERE id='old'").get()!.raw_text, "original");
    sqlite.prepare("INSERT INTO representative_roster_observations VALUES(?,?,?,?,?,?)").run("large", SENATE_ROSTER_URL, NOW, "hash", "x".repeat(556_936), "{}");
    assert.throws(() => sqlite.prepare("INSERT INTO representative_roster_observations VALUES(?,?,?,?,?,?)").run("oversize", SENATE_ROSTER_URL, NOW, "hash", "x".repeat(1_000_001), "{}"));
    assert.throws(() => sqlite.exec("UPDATE representative_roster_observations SET raw_text='changed'"), /representative-immutable/);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});
