import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RepresentativeCommitteeRole, RepresentativeMembership, RepresentativeOffice, RepresentativePerson,
  RepresentativeQuery, RepresentativeVacancy, PublicRepresentativeOffice, PublicRepresentativeResult,
  projectHistoricalPolicyRole, queryRepresentatives, representativeOfficeKey, representativePersonSourceKey,
  representativeDirectoryUnavailable, resolveRepresentativeDirectory } from "../src/content/watch-representatives.ts";
import { WATCH_COUNTIES, WATCH_REQUIRED_FAMILIES, ManualCountyAssignment, assessWatchCoverage,
  coverageRecordDigest } from "../src/content/watch-coverage.ts";
import { FIXTURE_NOW, FIXTURE_ROSTER_AS_OF, FIXTURE_SOURCE_ID, acceptSyntheticCoverage,
  emptyCoverageContext, makeRepresentativeFixture, syntheticManualAssignment, syntheticRepresentativeValues,
} from "./fixtures/watch-representatives/synthetic.ts";

async function directory(fixture: Awaited<ReturnType<typeof makeRepresentativeFixture>>) {
  return resolveRepresentativeDirectory(fixture.snapshot.id, fixture.context);
}
function isCode(code: string) { return (error: unknown) => (error as { code?: string }).code === code; }

test("person and office identities do not depend on names, capacity, or current occupants", async () => {
  const values = syntheticRepresentativeValues(), office = values.offices[0]!;
  assert.equal(await representativeOfficeKey(office), await representativeOfficeKey({ ...office, bodyName: "Renamed synthetic body", seatCapacity: 7 }));
  assert.equal(await representativeOfficeKey(office), await representativeOfficeKey({ jurisdictionId: office.jurisdictionId,
    bodyId: office.bodyId, officeType: office.officeType, district: { type: office.district.type, id: office.district.id } }));
  assert.notEqual(await representativeOfficeKey(office), await representativeOfficeKey({ ...office, district: { ...office.district, type: "at-large" } }));
  assert.notEqual(await representativePersonSourceKey("fixture-source", "one"), await representativePersonSourceKey("fixture-source", "two"));
  assert.equal(RepresentativePerson.safeParse({ ...values.people[0], verified: true }).success, false);
  assert.equal(RepresentativeOffice.safeParse({ ...office, numberedSeat: "1" }).success, false);
});

test("periods reject empty, reversed, impossible, unknown-start and ambiguous dates", () => {
  const values = syntheticRepresentativeValues();
  for (const [schema, input] of [[RepresentativeOffice, values.offices[0]], [RepresentativeMembership, values.memberships[0]],
    [RepresentativeCommitteeRole, values.committeeRoles[0]], [RepresentativeVacancy, values.vacancies[0]]] as const) {
    assert.equal(schema.safeParse({ ...input, validFrom: "2026-01-01", validTo: "2026-01-01" }).success, false);
    assert.equal(schema.safeParse({ ...input, validFrom: "2026-02-30" }).success, false);
    assert.equal(schema.safeParse({ ...input, validFrom: null }).success, false);
    assert.equal(schema.safeParse({ ...input, datePrecision: "year" }).success, false);
  }
});

test("fresh NJ synthetic two-member district is not flattened; roles do not consume seats", async () => {
  const fixture = await makeRepresentativeFixture();
  const result = queryRepresentatives(await directory(fixture), fixture.query), office = result.offices[0]!;
  assert.equal(result.dataState, "current"); assert.equal(result.mode, "current"); assert.equal(result.dataAsOf, FIXTURE_ROSTER_AS_OF);
  assert.equal(result.selectionMeaning, "selected-district-not-verified-residency");
  assert.deepEqual(office.members.map(member => member.personId), ["fixture-person-a", "fixture-person-b"]);
  assert.deepEqual(office.seats, { capacity: 2, verifiedFilled: 2, verifiedVacant: 0, unverified: 0, lastKnownFilled: 0, lastKnownVacant: 0 });
  assert.equal(office.members[0]!.committeeRoles[0]!.bodyId, "fixture-committee");
  assert.equal(office.members[0]!.state, "verified-current");
  assert.equal(office.state, "verified-membership");
  assert.ok(PublicRepresentativeResult.safeParse(result).success);
});

test("synthetic Philadelphia at-large office keeps seven members separate from district office", async () => {
  const fixture = await makeRepresentativeFixture(values => {
    const scope = { jurisdiction: "PA" as const, jurisdictionId: "fixture-philadelphia", bodyId: "fixture-city-council" };
    values.roster.scope = scope;
    values.offices.forEach(office => Object.assign(office, scope));
    values.offices[0]!.district = { type: "at-large", id: "fixture-at-large", label: "Synthetic at-large" };
    values.offices[0]!.seatCapacity = 7;
    for (const suffix of ["c", "d", "e", "f", "g"]) {
      values.people.push({ ...values.people[0]!, id: `fixture-person-${suffix}`, displayName: `Fixture Member ${suffix.toUpperCase()}`,
        sourceIdentities: [{ sourceId: FIXTURE_SOURCE_ID, nativeId: `fixture-native-${suffix}` }] });
      values.memberships.push({ ...values.memberships[0]!, id: `fixture-membership-${suffix}`, personId: `fixture-person-${suffix}`,
        displayNameAtTerm: `Fixture Member ${suffix.toUpperCase()}` });
      values.roster.offices[0]!.membershipIds.push(`fixture-membership-${suffix}`);
    }
  });
  const resolved = await directory(fixture);
  const atLarge = queryRepresentatives(resolved, { ...fixture.query, districtId: "fixture-at-large" });
  assert.equal(atLarge.offices[0]!.district.type, "at-large");
  assert.equal(atLarge.offices[0]!.members.length, 7); assert.equal(atLarge.offices[0]!.seats.capacity, 7);
  const district = queryRepresentatives(resolved, { ...fixture.query, districtId: "fixture-district-02" });
  assert.equal(district.offices[0]!.district.type, "district"); assert.equal(district.offices[0]!.members.length, 0);
});

test("membership and committee intervals use [from,to), including term turnover", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  const before = queryRepresentatives(resolved, { ...fixture.query, asOf: "2025-12-31" });
  assert.deepEqual(before.offices[0]!.members.map(member => member.membershipId), ["fixture-membership-old"]);
  assert.equal(before.offices[0]!.members[0]!.displayName, "Fixture Former Member Original");
  assert.equal(before.offices[0]!.members[0]!.state, "verified-historical");
  const boundary = queryRepresentatives(resolved, { ...fixture.query, asOf: "2026-01-01" });
  assert.deepEqual(boundary.offices[0]!.members.map(member => member.membershipId), ["fixture-membership-a", "fixture-membership-b"]);
  assert.equal(boundary.offices[0]!.members[0]!.committeeRoles.length, 1);
  const notYet = queryRepresentatives(resolved, { ...fixture.query, asOf: "1900-01-01" });
  assert.equal(notYet.offices.length, 0);
});

test("unknown membership end alone never proves current service or an unobserved historical day", async () => {
  const fixture = await makeRepresentativeFixture(values => { values.roster.offices[0]!.membershipIds.pop(); });
  const resolved = await directory(fixture);
  const result = queryRepresentatives(resolved, fixture.query);
  assert.deepEqual(result.offices[0]!.members.map(member => member.personId), ["fixture-person-a"]);
  assert.equal(result.offices[0]!.seats.unverified, 1); assert.equal(result.offices[0]!.state, "partially-verified");
  fixture.context.now = "2026-09-15T12:00:00.000Z";
  const historicalGap = queryRepresentatives(await directory(fixture), { ...fixture.query, asOf: "2026-09-13" });
  assert.equal(historicalGap.offices[0]!.members.length, 0);
});

test("roster freshness expires exactly at the bounded deadline and retains honest last-known data", async () => {
  const fixture = await makeRepresentativeFixture();
  fixture.context.now = "2026-09-13T12:00:00.000Z";
  const result = queryRepresentatives(await directory(fixture), { ...fixture.query, asOf: "2026-09-13" });
  assert.equal(result.dataState, "stale"); assert.equal(result.dataAsOf, FIXTURE_ROSTER_AS_OF);
  assert.equal(result.offices[0]!.members[0]!.state, "last-known");
  assert.deepEqual(result.offices[0]!.seats, { capacity: 2, verifiedFilled: 0, verifiedVacant: 0, unverified: 2, lastKnownFilled: 2, lastKnownVacant: 0 });
  assert.equal(result.offices[0]!.state, "unverified");
});

test("re-accepting an old roster does not reset its age", async () => {
  const fixture = await makeRepresentativeFixture(values => { values.roster.asOf = "2026-09-01T12:00:00.000Z"; });
  const result = queryRepresentatives(await directory(fixture), fixture.query);
  assert.equal(result.dataState, "stale"); assert.equal(result.dataAsOf, "2026-09-01T12:00:00.000Z");
});

test("a future term end does not prove a stale gap between the roster and selected past day", async () => {
  const fixture = await makeRepresentativeFixture(values => {
    values.memberships[0]!.validTo = "2027-01-01";
    values.committeeRoles.length = 0; values.roster.offices[0]!.committeeRoleIds = [];
  });
  fixture.context.now = "2026-09-15T12:00:00.000Z";
  const result = queryRepresentatives(await directory(fixture), { ...fixture.query, asOf: "2026-09-13" });
  assert.equal(result.offices[0]!.members.length, 0); assert.equal(result.offices[0]!.state, "unverified");
});

test("current committee role also requires a current roster entry, not only a dated term", async () => {
  const fixture = await makeRepresentativeFixture(values => { values.roster.offices[0]!.committeeRoleIds = []; });
  const result = queryRepresentatives(await directory(fixture), fixture.query);
  assert.equal(result.offices[0]!.members[0]!.committeeRoles.length, 0); assert.equal(result.offices[0]!.seats.verifiedFilled, 2);
});

test("as-of days follow the declared Eastern directory calendar, not UTC midnight", async () => {
  const fixture = await makeRepresentativeFixture(); fixture.context.now = "2026-09-12T02:00:00.000Z";
  const resolved = await directory(fixture);
  assert.throws(() => queryRepresentatives(resolved, fixture.query), isCode("future-as-of-not-supported"));
  assert.equal(queryRepresentatives(resolved, { ...fixture.query, asOf: "2026-09-11" }).mode, "current");
});

test("no officeholder is unverified, not vacant; fresh vacancy requires its own official evidence", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  const unknown = queryRepresentatives(resolved, { ...fixture.query, districtId: "fixture-district-02" }).offices[0]!;
  assert.equal(unknown.state, "unverified"); assert.equal(unknown.vacancies.length, 0); assert.equal(unknown.seats.verifiedVacant, 0);
  const vacancy = queryRepresentatives(resolved, { ...fixture.query, districtId: "fixture-district-03" }).offices[0]!;
  assert.equal(vacancy.state, "verified-vacancy"); assert.equal(vacancy.seats.verifiedVacant, 1);
  assert.ok(vacancy.sources.some(source => source.id === "fixture-vacancy-evidence"));
  fixture.context.now = "2026-09-15T12:00:00.000Z";
  const stale = queryRepresentatives(await directory(fixture), { ...fixture.query, districtId: "fixture-district-03", asOf: "2026-09-15" }).offices[0]!;
  assert.equal(stale.state, "unverified"); assert.equal(stale.seats.verifiedVacant, 0); assert.equal(stale.seats.lastKnownVacant, 1);
});

test("historical sponsor keeps original identity, membership, role and action name after turnover", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  const sponsor = projectHistoricalPolicyRole(resolved, "fixture-policy-role")!;
  assert.equal(sponsor.personId, "fixture-person-old"); assert.equal(sponsor.membershipId, "fixture-membership-old");
  assert.equal(sponsor.displayName, "Fixture Former Member At Action"); assert.equal(sponsor.actionDate, "2024-06-01");
  assert.equal(sponsor.term.validTo, "2026-01-01");
  assert.notEqual(sponsor.personId, queryRepresentatives(resolved, fixture.query).offices[0]!.members[0]!.personId);
  assert.equal(projectHistoricalPolicyRole(resolved, "fixture-missing-role"), null);
});

test("historical policy role rejects substituting a successor or an out-of-term action", async () => {
  const successor = await makeRepresentativeFixture(values => { values.policyRoles[0]!.personId = "fixture-person-a"; });
  await assert.rejects(directory(successor), isCode("historical-role-membership-conflict"));
  const ended = await makeRepresentativeFixture(values => { values.policyRoles[0]!.actionDate = "2026-01-01"; });
  await assert.rejects(directory(ended), isCode("historical-role-membership-conflict"));
});

test("client flags cannot construct a queryable directory or an accepted snapshot", async () => {
  const fixture = await makeRepresentativeFixture();
  assert.throws(() => queryRepresentatives({ verified: true, status: "accepted", ...fixture.snapshot } as never, fixture.query),
    isCode("server-resolved-directory-required"));
  fixture.context.acceptedSnapshots = new Map();
  await assert.rejects(directory(fixture), isCode("accepted-snapshot-unavailable"));
  const unavailable = representativeDirectoryUnavailable(fixture.query, FIXTURE_NOW);
  assert.equal(unavailable.dataState, "unavailable"); assert.equal(unavailable.dataAsOf, null);
  assert.equal(unavailable.unavailableReason, "accepted-directory-unavailable"); assert.deepEqual(unavailable.offices, []);
});

test("snapshot revision, fact bytes and evidence bytes are independently bound", async () => {
  const revision = await makeRepresentativeFixture(); revision.context.currentRevisions = new Map([[revision.snapshot.id, 2]]);
  await assert.rejects(directory(revision), isCode("snapshot-binding-conflict"));
  const fact = await makeRepresentativeFixture();
  (fact.facts.get("fixture-membership-a-fact")!.value as { personId: string }).personId = "fixture-person-b";
  await assert.rejects(directory(fact), isCode("accepted-fact-binding-conflict"));
  const observed = await makeRepresentativeFixture(); observed.observations.get("fixture-membership-a-observation")!.representation += " ";
  await assert.rejects(directory(observed), isCode("official-evidence-unavailable"));
  const digest = await makeRepresentativeFixture(); digest.evidence.get("fixture-membership-a-evidence")!.sourceLabel = "Changed";
  await assert.rejects(directory(digest), isCode("evidence-binding-conflict"));
});

test("accepted public evidence must be official, scope-enrolled and allowed for its exact purpose", async () => {
  for (const mutate of [
    (fixture: Awaited<ReturnType<typeof makeRepresentativeFixture>>) => { fixture.context.officialSources = new Map(); },
    (fixture: Awaited<ReturnType<typeof makeRepresentativeFixture>>) => { fixture.context.sourceUrlAllowed = () => false; },
    (fixture: Awaited<ReturnType<typeof makeRepresentativeFixture>>) => { fixture.context.officialSources = new Map([[FIXTURE_SOURCE_ID,
      { jurisdictionIds: new Set(["wrong-state"]), bodyIds: new Set([fixture.query.bodyId]), purposes: new Set(["person"]) }]]); },
    (fixture: Awaited<ReturnType<typeof makeRepresentativeFixture>>) => {
      const source = fixture.context.officialSources.get(FIXTURE_SOURCE_ID)!;
      fixture.context.officialSources = new Map([[FIXTURE_SOURCE_ID, { ...source, purposes: new Set(["person", "office", "membership", "committee-role", "policy-role", "roster"]) }]]);
    },
  ]) {
    const fixture = await makeRepresentativeFixture(); mutate(fixture);
    await assert.rejects(directory(fixture), isCode("official-evidence-unavailable"));
  }
});

test("profile/lookup links cannot escape registered official public origins", async () => {
  const external = await makeRepresentativeFixture(values => { values.memberships[0]!.officialProfileUrl = "https://unregistered.invalid/profile"; });
  await assert.rejects(directory(external), isCode("membership-identity-or-link-conflict"));
  const privateData = await makeRepresentativeFixture();
  const fact = privateData.facts.get("fixture-person-a-fact")!;
  (fact as unknown as { privateNotes: string }).privateNotes = "DO-NOT-PUBLISH-FIXTURE";
  const output = queryRepresentatives(await directory(privateData), privateData.query);
  assert.equal(JSON.stringify(output).includes("DO-NOT-PUBLISH-FIXTURE"), false);
  assert.equal(JSON.stringify(output).includes("sourceIdentities"), false);
  assert.equal(JSON.stringify(output).includes("verifierId"), false);
  assert.equal(PublicRepresentativeOffice.safeParse({ ...output.offices[0], privateNotes: "forbidden" }).success, false);
});

test("over-capacity, conflicting natural offices and broken role terms fail closed", async () => {
  const capacity = await makeRepresentativeFixture(values => { values.offices[0]!.seatCapacity = 1; });
  await assert.rejects(directory(capacity), isCode("roster-seat-capacity-conflict"));
  const duplicate = await makeRepresentativeFixture(values => { values.offices[1]!.district = { ...values.offices[0]!.district }; });
  await assert.rejects(directory(duplicate), isCode("office-identity-or-link-conflict"));
  const role = await makeRepresentativeFixture(values => { values.committeeRoles[0]!.validFrom = "2000-01-01"; });
  await assert.rejects(directory(role), isCode("committee-term-conflict"));
});

test("historical overlapping person memberships cannot duplicate representation", async () => {
  const fixture = await makeRepresentativeFixture(values => {
    values.memberships.push({ ...values.memberships[2]!, id: "fixture-overlapping-term" });
  });
  const resolved = await directory(fixture);
  assert.throws(() => queryRepresentatives(resolved, { ...fixture.query, asOf: "2025-01-01" }), isCode("overlapping-person-memberships"));
});

test("explicit query rejects ZIP, county/address inference, unknown filters, unsafe bounds and future dates", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  for (const extra of [{ zip: "19103" }, { county: "Philadelphia" }, { address: "Synthetic address" }, { verified: true },
    { limit: 0 }, { limit: 51 }, { asOf: "2026-02-30" }, { cursor: "x".repeat(2049) }]) {
    assert.equal(RepresentativeQuery.safeParse({ ...fixture.query, ...extra }).success, false);
  }
  assert.throws(() => queryRepresentatives(resolved, { ...fixture.query, asOf: "2026-09-13" }), isCode("future-as-of-not-supported"));
  const wrongScope = queryRepresentatives(resolved, { ...fixture.query, jurisdiction: "DE" });
  assert.equal(wrongScope.dataState, "unavailable"); assert.equal(wrongScope.dataAsOf, null); assert.equal(wrongScope.unavailableReason, "scope-not-enrolled");
  const empty = queryRepresentatives(resolved, { ...fixture.query, districtId: "fixture-nonexistent-district" });
  assert.equal(empty.dataState, "current"); assert.equal(empty.offices.length, 0); assert.equal(empty.unavailableReason, null);
});

test("pagination is bounded and bound to snapshot and explicit selection", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  const { districtId: _district, ...query } = fixture.query;
  const first = queryRepresentatives(resolved, { ...query, limit: 1 });
  assert.equal(first.offices[0]!.id, "fixture-office-01"); assert.ok(first.nextCursor);
  const second = queryRepresentatives(resolved, { ...query, limit: 1, cursor: first.nextCursor });
  assert.equal(second.offices[0]!.id, "fixture-office-02");
  assert.throws(() => queryRepresentatives(resolved, { ...query, districtId: "fixture-district-03", cursor: first.nextCursor }),
    isCode("cursor-snapshot-or-filter-conflict"));
  assert.throws(() => queryRepresentatives(resolved, { ...query, cursor: "not-json" }), isCode("invalid-cursor"));
  fixture.snapshot.revision = 2; fixture.context.currentRevisions = new Map([[fixture.snapshot.id, 2]]);
  assert.throws(() => queryRepresentatives(resolved, { ...query, asOf: "2026-09-01", cursor: first.nextCursor }), isCode("cursor-snapshot-or-filter-conflict"));
  const changed = await directory(fixture);
  assert.throws(() => queryRepresentatives(changed, { ...query, cursor: first.nextCursor }), isCode("cursor-snapshot-or-filter-conflict"));
});

test("resolved results are isolated from later store and public DTO mutations", async () => {
  const fixture = await makeRepresentativeFixture(), resolved = await directory(fixture);
  const first = queryRepresentatives(resolved, fixture.query); first.offices[0]!.members[0]!.displayName = "MUTATED OUTPUT";
  (fixture.facts.get("fixture-person-a-fact")!.value as { displayName: string }).displayName = "MUTATED STORE";
  assert.equal(queryRepresentatives(resolved, fixture.query).offices[0]!.members[0]!.displayName, "Fixture Member A");
});

test("county registry exactly preserves the approved 11-county geography and required source families", async () => {
  const pack = JSON.parse(await readFile(new URL("../fixtures/coverage-pack-v1.json", import.meta.url), "utf8"));
  assert.equal(WATCH_COUNTIES.length, 11);
  for (const state of ["PA", "NJ", "DE"]) {
    assert.deepEqual(WATCH_COUNTIES.filter(county => county.state === state).map(county => county.name), pack.geography.counties[state]);
  }
  assert.deepEqual(WATCH_COUNTIES.map(county => county.id), ["pa-philadelphia", "pa-bucks", "pa-montgomery", "pa-chester", "pa-delaware",
    "nj-camden", "nj-burlington", "nj-gloucester", "nj-salem", "nj-atlantic", "de-new-castle"]);
  assert.deepEqual([...WATCH_REQUIRED_FAMILIES], ["federal-legislation", "federal-regulation", "federal-dockets", "federal-members",
    "pa-legislation", "pa-regulation", "pa-members", "nj-legislation", "nj-regulation", "nj-members", "de-legislation", "de-regulation", "de-members"]);
});

test("empty planned coverage is 0/11 counties and 0/13 families, never assigned by role label", async () => {
  const context = emptyCoverageContext();
  const result = await assessWatchCoverage(context);
  assert.deepEqual(result.totals, { countiesRequired: 11, countiesSatisfied: 0, familiesRequired: 13, familiesSatisfied: 0 });
  assert.deepEqual(result.requiredJurisdictions, ["federal", "PA", "NJ", "DE"]);
  assert.equal(result.requiredCoverageSatisfied, false); assert.equal(result.publicationAuthorized, false); assert.equal(result.dataAsOf, null);
  assert.ok(result.counties.every(county => county.status === "unassigned" && county.municipalScope!.status === "not-enumerated"));
  (context.records as Map<string, unknown>).set("fixture-role-only", { id: "fixture-role-only", countyId: "pa-philadelphia", ownerRole: "regional-editor", status: "manual-ready" });
  const roleOnly = await assessWatchCoverage(context);
  assert.equal(roleOnly.totals.countiesSatisfied, 0); assert.equal(roleOnly.counties[0]!.status, "unavailable");
});

test("manual-ready needs named enrolled primary/backup, cadence, scope, receipts and current review", async () => {
  const context = emptyCoverageContext(); await acceptSyntheticCoverage(context, syntheticManualAssignment());
  const result = await assessWatchCoverage(context), county = result.counties[0]!;
  assert.equal(county.status, "manual-ready"); assert.equal(result.totals.countiesSatisfied, 1);
  assert.equal(result.totals.familiesSatisfied, 0); assert.equal(result.requiredCoverageSatisfied, false);
  assert.equal(county.checkCadenceHours, 24); assert.equal(county.municipalScope!.status, "named-bodies-only");
  assert.ok(county.municipalScope!.knownGaps.length > 0);
  assert.equal(JSON.stringify(result).includes("fixture-editor-a"), false);
  assert.equal(JSON.stringify(result).includes("fixture-log-not-real"), false);
  assert.equal(JSON.stringify(result).includes("recordSha256"), false);
});

test("manual assignment rejects missing staffing/cadence/scope/log/review fields and duplicate backup", () => {
  const input = syntheticManualAssignment();
  for (const key of ["namedEditorId", "backupEditorId", "checkCadenceHours", "coverageHours", "monitoredBodies", "evidenceLogLocation", "nextReviewAt"]) {
    const incomplete = { ...input } as Record<string, unknown>; delete incomplete[key];
    assert.equal(ManualCountyAssignment.safeParse(incomplete).success, false, key);
  }
  assert.equal(ManualCountyAssignment.safeParse({ ...input, backupEditorId: "fixture-editor-a" }).success, false);
  assert.equal(ManualCountyAssignment.safeParse({ ...input, municipalScope: { status: "all-municipalities", knownGaps: [] } }).success, false);
});

test("a parsed manual-ready or qualified label is not approval", async () => {
  const context = emptyCoverageContext(), record = syntheticManualAssignment();
  (context.records as Map<string, unknown>).set(record.id, record);
  assert.equal((await assessWatchCoverage(context)).counties[0]!.reason, "missing-acceptance");
  (context.acceptedRecords as Map<string, unknown>).set(record.id, { recordId: record.id, approved: true });
  assert.equal((await assessWatchCoverage(context)).counties[0]!.status, "unavailable");
});

test("coverage approval, retained evidence and enrolled staffing are independently checked", async () => {
  for (const [reason, mutate] of [
    ["acceptance-binding-conflict", (context: ReturnType<typeof emptyCoverageContext>) => { context.authorizedReviewerIds = new Set(); }],
    ["qualification-evidence-unavailable", (context: ReturnType<typeof emptyCoverageContext>) => { context.evidenceReceipts = new Map(); }],
    ["staff-unassigned", (context: ReturnType<typeof emptyCoverageContext>) => { context.staffDirectory = new Map(); }],
    ["source-not-enrolled", (context: ReturnType<typeof emptyCoverageContext>) => { context.enrolledSourceIds = new Set(); }],
    ["source-not-enrolled", (context: ReturnType<typeof emptyCoverageContext>) => { context.enrolledSourceObligations = new Map([[FIXTURE_SOURCE_ID, new Set(["nj-members"])]]) }],
    ["source-not-enrolled", (context: ReturnType<typeof emptyCoverageContext>) => { context.sourceUrlAllowed = () => false; }],
  ] as const) {
    const context = emptyCoverageContext(); await acceptSyntheticCoverage(context, syntheticManualAssignment()); mutate(context);
    const county = (await assessWatchCoverage(context)).counties[0]!;
    assert.equal(county.status, "unavailable"); assert.equal(county.reason, reason);
    assert.deepEqual(county.officialSources, []); assert.deepEqual(county.monitoredBodies, []);
  }
});

test("an old check receipt cannot make a newly timestamped assignment fresh", async () => {
  const context = emptyCoverageContext(), record = await acceptSyntheticCoverage(context, syntheticManualAssignment());
  const receipt = context.evidenceReceipts.get(record.evidenceReceiptId)!;
  (context.evidenceReceipts as Map<string, unknown>).set(record.evidenceReceiptId, { ...receipt, recordedAt: "2026-09-11T12:00:00.000Z" });
  const result = await assessWatchCoverage(context);
  assert.equal(result.counties[0]!.reason, "qualification-evidence-unavailable"); assert.equal(result.totals.countiesSatisfied, 0);
});

test("expired review/check or unavailable backup is not covered", async () => {
  const context = emptyCoverageContext(); await acceptSyntheticCoverage(context, syntheticManualAssignment());
  context.now = "2026-09-13T10:00:00.000Z";
  const overdue = (await assessWatchCoverage(context)).counties[0]!;
  assert.equal(overdue.status, "stale"); assert.equal(overdue.reason, "check-overdue"); assert.equal(overdue.dataAsOf, "2026-09-12T10:00:00.000Z");
  context.now = "2026-09-19T12:00:00.000Z";
  assert.equal((await assessWatchCoverage(context)).counties[0]!.reason, "review-expired");
  context.now = FIXTURE_NOW;
  (context.staffDirectory as Map<string, unknown>).set("fixture-editor-b", { id: "fixture-editor-b", displayName: "Fixture Editor B", availableThrough: FIXTURE_NOW });
  assert.equal((await assessWatchCoverage(context)).counties[0]!.reason, "staff-unassigned");
});

test("edited approved assignment or altered evidence requires a new accepted binding", async () => {
  const context = emptyCoverageContext(), record = await acceptSyntheticCoverage(context, syntheticManualAssignment());
  const priorHash = await coverageRecordDigest(record); record.publicScopeText = "Changed synthetic scope";
  assert.notEqual(await coverageRecordDigest(record), priorHash);
  assert.equal((await assessWatchCoverage(context)).counties[0]!.reason, "acceptance-binding-conflict");
  const intact = emptyCoverageContext(), other = await acceptSyntheticCoverage(intact, syntheticManualAssignment());
  const receipt = intact.evidenceReceipts.get(other.evidenceReceiptId)!;
  (intact.evidenceReceipts as Map<string, unknown>).set(other.evidenceReceiptId, { ...receipt, bytes: "changed" });
  assert.equal((await assessWatchCoverage(intact)).counties[0]!.reason, "qualification-evidence-unavailable");
});

test("all federal/PA/NJ/DE families remain mandatory even when all counties have synthetic assignments", async () => {
  const context = emptyCoverageContext();
  for (const county of WATCH_COUNTIES) {
    const record = syntheticManualAssignment();
    assert.equal(record.kind, "manual");
    await acceptSyntheticCoverage(context, { ...record, id: `fixture-manual-${county.id}`, countyId: county.id,
      evidenceReceiptId: `fixture-receipt-${county.id}` });
  }
  let result = await assessWatchCoverage(context);
  assert.equal(result.totals.countiesSatisfied, 11); assert.equal(result.requiredCoverageSatisfied, false);
  for (const family of WATCH_REQUIRED_FAMILIES) {
    const template = syntheticManualAssignment();
    await acceptSyntheticCoverage(context, { id: `fixture-source-${family}`, kind: "source", obligation: { kind: "family", familyId: family },
      monitoredBodies: template.monitoredBodies, officialSources: template.officialSources, publicScopeText: `Synthetic ${family} test scope`,
      evidenceLogLocation: "fixture-source-log", lastCheckedAt: template.lastCheckedAt, nextReviewAt: template.nextReviewAt,
      evidenceReceiptId: `fixture-receipt-${family}`, evidenceReceiptSha256: "0".repeat(64), checkCadenceHours: 24,
      qualificationReviewedAt: "2026-09-11T12:00:00.000Z" });
  }
  result = await assessWatchCoverage(context);
  assert.equal(result.totals.familiesSatisfied, 13); assert.equal(result.requiredCoverageSatisfied, true);
  assert.equal(result.publicationAuthorized, false);
  (context.acceptedRecords as Map<string, unknown>).delete("fixture-source-de-regulation");
  assert.equal((await assessWatchCoverage(context)).requiredCoverageSatisfied, false);
});

test("qualified county source can satisfy one county without double counting its manual backup", async () => {
  const context = emptyCoverageContext(), template = syntheticManualAssignment();
  assert.equal(template.kind, "manual");
  await acceptSyntheticCoverage(context, template);
  await acceptSyntheticCoverage(context, { id: "fixture-county-source", kind: "source",
    obligation: { kind: "county", countyId: "pa-philadelphia", municipalScope: template.municipalScope },
    monitoredBodies: template.monitoredBodies, officialSources: template.officialSources,
    publicScopeText: "Synthetic qualified source scope", evidenceLogLocation: "fixture-source-log",
    lastCheckedAt: template.lastCheckedAt, nextReviewAt: template.nextReviewAt,
    evidenceReceiptId: "fixture-county-source-receipt", evidenceReceiptSha256: "0".repeat(64),
    checkCadenceHours: 24, qualificationReviewedAt: template.assignmentReviewedAt });
  const result = await assessWatchCoverage(context);
  assert.equal(result.counties[0]!.status, "qualified-source"); assert.equal(result.totals.countiesSatisfied, 1);
  assert.equal(result.dataAsOf, template.lastCheckedAt);
  (context.acceptedRecords as Map<string, unknown>).delete("fixture-county-source");
  assert.equal((await assessWatchCoverage(context)).counties[0]!.status, "manual-ready");
});

test("coverage snapshots and public output remain bounded", async () => {
  const context = emptyCoverageContext();
  context.records = new Map(Array.from({ length: 501 }, (_, index) => [`fixture-${index}`, {}]));
  await assert.rejects(assessWatchCoverage(context), /record limit/);
});
