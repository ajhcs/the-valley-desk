import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SourceDate, sha256, tupleKey, policyIdentityKey, evidenceMatches,
  interpretationApplies, technologyEligible, includeInOssFilter, includeInLatest,
  legacyKindSupported,
} from "./contracts";

const day = { precision: "day", value: "2026-09-12", timezone: "America/New_York", evidenceIds: ["e1"] };
const identity = { jurisdictionId: "us-pa", bodyId: "general-assembly",
  sessionKey: "2025-2026", instrumentType: "bill", sourceInstrumentId: "DEMO-HB-1" };

test("day-only dates retain precision and never acquire a time", () => {
  assert.deepEqual(SourceDate.parse(day), day);
});
for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-09-12T00:00:00Z"]) {
  test(`invalid day is rejected: ${value}`, () => {
    assert.equal(SourceDate.safeParse({ ...day, value }).success, false);
  });
}
test("valid leap day is accepted", () => {
  assert.equal(SourceDate.safeParse({ ...day, value: "2028-02-29" }).success, true);
});
test("known instant requires canonical UTC and real calendar value", () => {
  assert.equal(SourceDate.safeParse({ precision: "instant", value: "2026-09-12T12:00:00.000Z", evidenceIds: ["e1"] }).success, true);
  assert.equal(SourceDate.safeParse({ precision: "instant", value: "2026-02-30T12:00:00.000Z", evidenceIds: ["e1"] }).success, false);
});
test("unknown date cannot carry a guessed value", () => {
  assert.equal(SourceDate.safeParse({ precision: "unknown", reason: "not supplied", value: "2026-09-12" }).success, false);
});
test("identity replay is deterministic", async () => {
  assert.equal(await policyIdentityKey(identity), await policyIdentityKey({ ...identity }));
});
test("sessions and jurisdictions cannot collide", async () => {
  const original = await policyIdentityKey(identity);
  assert.notEqual(original, await policyIdentityKey({ ...identity, sessionKey: "2027-2028" }));
  assert.notEqual(original, await policyIdentityKey({ ...identity, jurisdictionId: "us-nj" }));
});
test("missing, null, and standing legislative sessions hold", async () => {
  for (const sessionKey of [undefined, null, "", "standing"]) {
    await assert.rejects(policyIdentityKey({ ...identity, sessionKey }));
  }
});
test("tuple encoding prevents delimiter ambiguity", async () => {
  assert.notEqual(await tupleKey("demo", ["a|b", "c"]), await tupleKey("demo", ["a", "b|c"]));
});
test("literal evidence must bind to exact persisted text and normalizer", async () => {
  const stored = { id: "o1", sourceId: "s1", normalizerVersion: "text-v1", text: "A synthetic source states the proposed rule applies to hospitals." };
  const evidence = { observationId: "o1", sourceId: "s1", representationSha256: await sha256(stored.text), normalizerVersion: "text-v1", quote: "applies to hospitals" };
  assert.equal(await evidenceMatches(evidence, stored), true);
  assert.equal(await evidenceMatches({ ...evidence, quote: "applies to every provider" }, stored), false);
  assert.equal(await evidenceMatches(evidence, { ...stored, text: `${stored.text} New exception.` }), false);
  assert.equal(await evidenceMatches(evidence, { ...stored, normalizerVersion: "text-v2" }), false);
  assert.equal(await evidenceMatches(evidence, { ...stored, sourceId: "s2" }), false);
});
const hash = (character: string) => character.repeat(64);
const dependencies = { policyVersionId: "pv1", artifactSha256: hash("a"), extractionSha256: hash("b"),
  provisionEvidenceSha256: hash("c"), dependencySha256s: [hash("d"), hash("e")], ruleVersion: "policy-review-v1" };
test("dependency order does not change interpretation binding", () => {
  assert.equal(interpretationApplies(dependencies, { ...dependencies, dependencySha256s: [...dependencies.dependencySha256s].reverse() }), true);
});
for (const field of ["policyVersionId", "artifactSha256", "extractionSha256", "provisionEvidenceSha256", "ruleVersion"] as const) {
  test(`changed ${field} invalidates current interpretation`, () => {
    assert.equal(interpretationApplies(dependencies, { ...dependencies, [field]: field.endsWith("Sha256") ? hash("f") : "changed" }), false);
  });
}
test("changed external definition and duplicate dependency input hold", () => {
  assert.equal(interpretationApplies(dependencies, { ...dependencies, dependencySha256s: [hash("d"), hash("f")] }), false);
  assert.equal(interpretationApplies(dependencies, { ...dependencies, dependencySha256s: [hash("d"), hash("d")] }), false);
});
const relationship = { resourceId: "resource1", entityId: "regional-lab", type: "created-by", evidenceIds: ["local-evidence"] };
const eligibility = {
  resourceId: "resource1", healthcareRelevant: true, relationships: [relationship],
  regionalEntityIds: new Set(["regional-lab"]),
  acceptedEvidence: new Map([["local-evidence", { resourceId: "resource1", entityId: "regional-lab", relationshipType: "created-by" as const }]]),
};
test("accepted artifact-specific regional creation can qualify", () => {
  assert.equal(technologyEligible(eligibility), true);
});
test("profile location, empty evidence, nonlocal entity, and unrelated artifact do not qualify", () => {
  assert.equal(technologyEligible({ ...eligibility, acceptedEvidence: new Map() }), false);
  assert.equal(technologyEligible({ ...eligibility, regionalEntityIds: new Set() }), false);
  assert.equal(technologyEligible({ ...eligibility, resourceId: "another-resource" }), false);
  assert.equal(technologyEligible({ ...eligibility, healthcareRelevant: false }), false);
  assert.equal(technologyEligible({ ...eligibility, relationships: [{ ...relationship, type: "profile-location" }] }), false);
  assert.equal(technologyEligible({ ...eligibility, relationships: [{ ...relationship, evidenceIds: [] }] }), false);
});
test("evidence for research cannot silently become production use", () => {
  assert.equal(technologyEligible({ ...eligibility, relationships: [{ ...relationship, type: "used-at" }] }), false);
});
test("restricted, unknown, or changed license never passes OSS filter", () => {
  const license = { classification: "osi-open-source" as const, artifactId: "a1", artifactVersion: "v1", reviewedLicenseHash: hash("a") };
  assert.equal(includeInOssFilter(license, hash("a")), true);
  assert.equal(includeInOssFilter({ ...license, classification: "restricted-source" }, hash("a")), false);
  assert.equal(includeInOssFilter({ ...license, classification: "unknown" }, null), false);
  assert.equal(includeInOssFilter(license, hash("b")), false);
});
test("baseline, no material change, and unknown date do not enter Latest", () => {
  const release = { baseline: false, material: true, publicAccepted: true, sourceDate: day };
  assert.equal(includeInLatest(release), true);
  assert.equal(includeInLatest({ ...release, baseline: true }), false);
  assert.equal(includeInLatest({ ...release, material: false }), false);
  assert.equal(includeInLatest({ ...release, publicAccepted: false }), false);
  assert.equal(includeInLatest({ ...release, sourceDate: { precision: "unknown", reason: "not supplied" } }), false);
});
test("new technology kind cannot pass the first legacy compatibility screen", () => {
  assert.equal(legacyKindSupported("technology"), false);
  for (const kind of ["news", "event", "voice", "policy", "ai", "briefing", "interview"]) {
    assert.equal(legacyKindSupported(kind), true);
  }
});
test("planning registry includes every tri-state family and exact 11 counties without claiming activation", () => {
  const plan = JSON.parse(readFileSync(new URL("../source-plan.json", import.meta.url), "utf8"));
  assert.equal(plan.liveCollectionAuthorized, false);
  assert.equal(plan.technologyScope, "verified-delaware-valley-only");
  for (const jurisdiction of ["federal", "PA", "NJ", "DE"]) {
    for (const family of ["legislation", "regulation", "members"]) {
      assert.equal(plan.policyFamilies.some((row: { jurisdiction: string; family: string; requiredAtLaunch: boolean }) =>
        row.jurisdiction === jurisdiction && row.family === family && row.requiredAtLaunch), true);
    }
  }
  assert.deepEqual(plan.counties.map((row: { id: string }) => row.id).sort(), [
    "pa-philadelphia", "pa-bucks", "pa-montgomery", "pa-chester", "pa-delaware",
    "nj-camden", "nj-burlington", "nj-gloucester", "nj-salem", "nj-atlantic", "de-new-castle",
  ].sort());
  const all = [...plan.policyFamilies, ...plan.counties];
  assert.equal(new Set(all.map((row) => row.id)).size, all.length);
  assert.equal(all.every((row) => row.qualification === "target" && row.receipt === null), true);
});
