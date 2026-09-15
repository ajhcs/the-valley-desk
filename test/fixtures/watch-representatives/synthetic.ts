import { AcceptedFactRecord, EvidenceReference, acceptedFactDigest, canonicalJson, evidenceReferenceDigest, sha256 } from "../../../src/content/watch-schema.ts";
import type { RepresentativeResolutionContext } from "../../../src/content/watch-representatives.ts";
import { WATCH_COUNTIES, WATCH_REQUIRED_FAMILIES, coverageRecordDigest } from "../../../src/content/watch-coverage.ts";
import type { CoverageRecord, WatchCoverageContext } from "../../../src/content/watch-coverage.ts";

export const SYNTHETIC_ONLY = "All people, offices, records, approvals and evidence in this fixture are fabricated test data.";
export const FIXTURE_NOW = "2026-09-12T12:00:00.000Z";
export const FIXTURE_ROSTER_AS_OF = "2026-09-11T12:00:00.000Z";
export const FIXTURE_SOURCE_ID = "fixture-official-source";
export const FIXTURE_SOURCE_URL = "https://official.fixture.invalid/roster.json";
export const FIXTURE_SCOPE = { jurisdiction: "NJ" as "federal" | "PA" | "NJ" | "DE", jurisdictionId: "fixture-nj", bodyId: "fixture-nj-assembly" };
const allowedUrl = (url: string) => new URL(url).origin === "https://official.fixture.invalid";

export function syntheticRepresentativeValues() {
  const period = { validFrom: "2026-01-01", validTo: null, datePrecision: "day" as const };
  const office = (suffix: string, capacity: number) => ({ id: `fixture-office-${suffix}`, ...FIXTURE_SCOPE,
    bodyName: "Synthetic Assembly", officeType: "legislative" as const,
    district: { type: "district" as "district" | "at-large", id: `fixture-district-${suffix}`, label: `Synthetic district ${suffix}` },
    seatCapacity: capacity, officialLookupUrl: "https://official.fixture.invalid/district-lookup",
    validFrom: "2000-01-01", validTo: null, datePrecision: "day" as const });
  const person = (suffix: string, name: string) => ({ id: `fixture-person-${suffix}`, displayName: name,
    sourceIdentities: [{ sourceId: FIXTURE_SOURCE_ID, nativeId: `synthetic-native-${suffix}` }] });
  const member = (suffix: string) => ({ id: `fixture-membership-${suffix}`, personId: `fixture-person-${suffix}`,
    officeId: "fixture-office-01", role: "elected-member" as const, displayNameAtTerm: `Fixture Member ${suffix.toUpperCase()}`,
    party: null, officialProfileUrl: `https://official.fixture.invalid/people/${suffix}`, ...period });
  return {
    people: [person("a", "Fixture Member A"), person("b", "Fixture Member B"), person("old", "Fixture Former Member Renamed")],
    offices: [office("01", 2), office("02", 1), office("03", 1)],
    memberships: [member("a"), member("b"), { ...member("old"), validFrom: "2020-01-01", validTo: "2026-01-01",
      displayNameAtTerm: "Fixture Former Member Original" }],
    committeeRoles: [{ id: "fixture-committee-role", membershipId: "fixture-membership-a", bodyId: "fixture-committee",
      bodyName: "Synthetic Committee", role: "committee-member" as const, ...period }],
    vacancies: [{ id: "fixture-vacancy", officeId: "fixture-office-03", vacantSeats: 1, ...period }],
    policyRoles: [{ id: "fixture-policy-role", policyId: "fixture-policy", actionId: "fixture-action", actionDate: "2024-06-01",
      datePrecision: "day" as const, personId: "fixture-person-old", membershipId: "fixture-membership-old",
      displayNameAtAction: "Fixture Former Member At Action", role: "sponsor" as const }],
    roster: { id: "fixture-roster", scope: { ...FIXTURE_SCOPE }, asOf: FIXTURE_ROSTER_AS_OF, offices: [
      { officeId: "fixture-office-01", membershipIds: ["fixture-membership-a", "fixture-membership-b"],
        committeeRoleIds: ["fixture-committee-role"], vacancyIds: [] },
      { officeId: "fixture-office-02", membershipIds: [], committeeRoleIds: [], vacancyIds: [] },
      { officeId: "fixture-office-03", membershipIds: [], committeeRoleIds: [], vacancyIds: ["fixture-vacancy"] },
    ] },
  };
}
export type SyntheticRepresentativeValues = ReturnType<typeof syntheticRepresentativeValues>;
export async function makeRepresentativeFixture(change?: (values: SyntheticRepresentativeValues) => void) {
  const values = syntheticRepresentativeValues(); change?.(values);
  const facts = new Map<string, AcceptedFactRecord>(), evidence = new Map<string, EvidenceReference>();
  const observations = new Map<string, RepresentativeResolutionContext["observations"] extends ReadonlyMap<string, infer O> ? O : never>();
  const bindings: Array<{ id: string; sha256: string }> = [];
  const entries: Array<{ field: string; value: { id: string } }> = [
    ...values.people.map(value => ({ field: "person", value })), ...values.offices.map(value => ({ field: "office", value })),
    ...values.memberships.map(value => ({ field: "membership", value })), ...values.committeeRoles.map(value => ({ field: "committee-role", value })),
    ...values.vacancies.map(value => ({ field: "vacancy", value })), ...values.policyRoles.map(value => ({ field: "policy-role", value })),
    { field: "roster", value: values.roster },
  ];
  for (const entry of entries) {
    const id = entry.value.id, representation = canonicalJson({ synthetic: SYNTHETIC_ONLY, value: entry.value });
    const reference = EvidenceReference.parse({ id: `${id}-evidence`, observationId: `${id}-observation`, kind: "structured",
      sourceId: FIXTURE_SOURCE_ID, sourceUrl: FIXTURE_SOURCE_URL, sourceLabel: "Synthetic official source (not a real source)",
      representationSha256: await sha256(representation), parserVersion: "fixture-parser-v1", pointer: "/value", valueJson: canonicalJson(entry.value) });
    evidence.set(reference.id, reference);
    observations.set(reference.observationId, { id: reference.observationId, sourceId: reference.sourceId,
      sourceUrl: reference.sourceUrl, parserVersion: reference.parserVersion, representation });
    const fact = AcceptedFactRecord.parse({ id: `${id}-fact`, subjectId: id, field: `representative-${entry.field}`, value: entry.value,
      evidenceIds: [reference.id], evidenceDigests: [{ id: reference.id, sha256: await evidenceReferenceDigest(reference) }],
      verification: { kind: "human-review", ruleId: "fixture-rule", ruleVersion: "fixture-v1", verifierId: "fixture-reviewer",
        verifiedAt: "2026-09-11T13:00:00.000Z" }, interpretationDependencies: null });
    facts.set(fact.id, fact); bindings.push({ id: fact.id, sha256: await acceptedFactDigest(fact) });
  }
  const snapshot = { id: "fixture-directory", revision: 1, scope: { ...values.roster.scope }, rosterFactId: "fixture-roster-fact",
    acceptedAt: "2026-09-11T14:00:00.000Z", factDigests: bindings };
  const context: RepresentativeResolutionContext = { now: FIXTURE_NOW, maxRosterAgeHours: 48,
    acceptedSnapshots: new Map([[snapshot.id, snapshot]]), currentRevisions: new Map([[snapshot.id, snapshot.revision]]),
    facts, evidence, observations, officialSources: new Map([[FIXTURE_SOURCE_ID, {
      jurisdictionIds: new Set([values.roster.scope.jurisdictionId]), bodyIds: new Set([values.roster.scope.bodyId]),
      purposes: new Set(["person", "office", "membership", "committee-role", "vacancy", "policy-role", "roster"]),
    }]]), sourceUrlAllowed: (id, url) => id === FIXTURE_SOURCE_ID && allowedUrl(url), officialPublicUrlAllowed: allowedUrl };
  return { values, snapshot, facts, evidence, observations, context,
    query: { ...values.roster.scope, districtId: "fixture-district-01", asOf: "2026-09-12" } };
}

export function emptyCoverageContext(): WatchCoverageContext {
  return { now: FIXTURE_NOW, records: new Map(), acceptedRecords: new Map(), evidenceReceipts: new Map(),
    staffDirectory: new Map([
      ["fixture-editor-a", { id: "fixture-editor-a", displayName: "Fixture Editor A", availableThrough: "2026-10-01T00:00:00.000Z" }],
      ["fixture-editor-b", { id: "fixture-editor-b", displayName: "Fixture Editor B", availableThrough: "2026-10-01T00:00:00.000Z" }],
    ]), authorizedReviewerIds: new Set(["fixture-editor-a"]), enrolledSourceIds: new Set([FIXTURE_SOURCE_ID]),
    enrolledSourceObligations: new Map([[FIXTURE_SOURCE_ID, new Set([...WATCH_COUNTIES.map(county => county.id), ...WATCH_REQUIRED_FAMILIES])]]),
    sourceUrlAllowed: (id, url) => id === FIXTURE_SOURCE_ID && allowedUrl(url) };
}
export function syntheticManualAssignment(): CoverageRecord {
  return { id: "fixture-manual-assignment", kind: "manual", countyId: "pa-philadelphia",
    monitoredBodies: [{ id: "fixture-council", label: "Synthetic Council" }],
    officialSources: [{ sourceId: FIXTURE_SOURCE_ID, url: "https://official.fixture.invalid/council" }],
    publicScopeText: "Synthetic test scope: named council only, not all municipalities.", evidenceLogLocation: "fixture-log-not-real",
    lastCheckedAt: "2026-09-12T10:00:00.000Z", nextReviewAt: "2026-09-19T12:00:00.000Z",
    evidenceReceiptId: "fixture-manual-receipt", evidenceReceiptSha256: "0".repeat(64), namedEditorId: "fixture-editor-a",
    backupEditorId: "fixture-editor-b", checkCadenceHours: 24, coverageHours: "Synthetic weekday morning shift",
    assignmentReviewedAt: "2026-09-11T12:00:00.000Z",
    municipalScope: { status: "named-bodies-only", knownGaps: ["All bodies outside this synthetic named scope remain unenumerated."] } };
}
export async function acceptSyntheticCoverage(context: WatchCoverageContext, record: CoverageRecord) {
  const bytes = canonicalJson({ synthetic: SYNTHETIC_ONLY, recordId: record.id, checkedAt: record.lastCheckedAt });
  record.evidenceReceiptSha256 = await sha256(bytes);
  (context.records as Map<string, unknown>).set(record.id, record);
  (context.evidenceReceipts as Map<string, unknown>).set(record.evidenceReceiptId, { bytes, recordId: record.id, recordedAt: record.lastCheckedAt });
  (context.acceptedRecords as Map<string, unknown>).set(record.id, { recordId: record.id,
    recordSha256: await coverageRecordDigest(record), approvedAt: context.now, reviewerId: "fixture-editor-a" });
  return record;
}
