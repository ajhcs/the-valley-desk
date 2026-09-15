import assert from "node:assert/strict";
import test from "node:test";
import { AcceptedFactRecord, CanonicalInstant, EvidenceReference, HttpsUrl, InterpretationDependencies, PolicyDossierDraft, PolicyIdentity,
  SourceDate, TechnologyArtifact, TechnologyLicense, TechnologyProfileDraft, TechnologyRelationship, WatchPublicRecord,
  acceptedFactDigest, canonicalJson, developmentIdentityKey, evidenceReferenceDigest, githubRepositoryKey, isCalendarDay,
  policyIdentityKey, sha256, tupleKey } from "../src/content/watch-schema";
import { evidenceMatches, includeInOssFilter, interpretationApplies, projectPolicyDossier, projectTechnologyProfile,
  technologyEligible, WatchProjectionError } from "../src/content/watch-projection";
import { dependencies, HASH, NOW, OTHER_HASH, syntheticFixture, VERIFIED } from "./fixtures/watch-contracts/synthetic";

const day = (value = "2026-09-12") => ({ precision: "day", value, timezone: "America/New_York", timezoneReason: null, evidenceIds: ["evidence-1"] });
const identity = () => ({ jurisdiction: "PA", jurisdictionId: "us-pa", bodyId: "legislature", sessionKey: "2025-2026", instrumentType: "bill", sourceInstrumentId: "HB 1" });
const record = (value: unknown) => value as Record<string, unknown>;
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => error instanceof WatchProjectionError && error.code === code);

test("calendar validation handles real leap years without inventing a timestamp", () => {
  for (const value of ["2024-02-29", "2000-02-29", "2026-09-12", "0001-01-01"]) assert.equal(isCalendarDay(value), true, value);
  for (const value of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "2026-9-1"]) assert.equal(isCalendarDay(value), false, value);
  assert.deepEqual(SourceDate.parse(day()), day());
  assert.equal("timestamp" in SourceDate.parse(day()), false);
});

test("source dates preserve unknown precision and unknown time zone explicitly", () => {
  const unknown = { precision: "unknown", reason: "No publication date supplied." };
  assert.deepEqual(SourceDate.parse(unknown), unknown);
  const noZone = { ...day(), timezone: null, timezoneReason: "Source time zone not established." };
  assert.deepEqual(SourceDate.parse(noZone), noZone);
  assert.equal(SourceDate.safeParse({ ...noZone, timezoneReason: null }).success, false);
  assert.equal(SourceDate.safeParse({ ...day(), timezone: "Invalid/Nowhere" }).success, false);
  assert.equal(SourceDate.safeParse({ ...day(), evidenceIds: [] }).success, false);
  assert.equal(SourceDate.safeParse({ ...unknown, value: NOW }).success, false);
});

test("instant precision requires real canonical UTC milliseconds", () => {
  assert.equal(CanonicalInstant.parse(NOW), NOW);
  for (const value of ["2026-09-12T13:00:00Z", "2026-09-12T13:00:00.000+00:00", "2026-02-29T00:00:00.000Z", "2026-09-12T24:00:00.000Z"]) {
    assert.equal(CanonicalInstant.safeParse(value).success, false, value);
  }
});

test("malformed, credentialed and non-HTTPS links return typed validation failures", () => {
  assert.equal(HttpsUrl.safeParse("https://example.test/source").success, true);
  for (const url of ["not a URL", "", "/relative", "http://example.test/source", "https://user:secret@example.test/source", "https://example.test:8443/source"]) {
    assert.equal(HttpsUrl.safeParse(url).success, false, url);
  }
});

test("policy identity holds missing, null, blank and invented standing sessions", async () => {
  for (const sessionKey of [undefined, null, "", " ", "standing"]) await assert.rejects(policyIdentityKey({ ...identity(), sessionKey }));
  assert.equal(PolicyIdentity.safeParse({ ...identity(), instrumentType: "guidance", sessionKey: "standing" }).success, true);
});

test("policy identities preserve jurisdiction, session, native case and delimiter boundaries", async () => {
  const variants = [identity(), { ...identity(), jurisdiction: "NJ", jurisdictionId: "us-nj" }, { ...identity(), sessionKey: "2027-2028" },
    { ...identity(), sourceInstrumentId: "hb 1" }, { ...identity(), instrumentType: "resolution" }];
  assert.equal(new Set(await Promise.all(variants.map(policyIdentityKey))).size, variants.length);
  assert.notEqual(await tupleKey("test", ["a:b", "c"]), await tupleKey("test", ["a", "b:c"]));
  assert.equal(canonicalJson({ b: 2, a: [1] }), canonicalJson({ a: [1], b: 2 }));
  for (const value of [undefined, Infinity, new Date(), { missing: undefined }]) assert.throws(() => canonicalJson(value));
});

test("repository identity survives owner changes and development identities retain their types", async () => {
  assert.equal(await githubRepositoryKey("9007199254740993"), await githubRepositoryKey("9007199254740993"));
  for (const value of ["owner/repo", "0", "-1", "123.5"]) await assert.rejects(githubRepositoryKey(value));
  const types = ["software-release", "tag", "commit", "paper-publication", "baseline", "indexing"] as const;
  assert.equal(new Set(await Promise.all(types.map(type => developmentIdentityKey("resource-1", type, "native-1")))).size, types.length);
});

async function textFixture() {
  const text = "A literal supported sentence. Other content.";
  const stored = { id: "observation-1", sourceId: "source-1", sourceUrl: "https://example.test/source", parserVersion: "parser-v1",
    representation: `<article>${text}</article>`, normalizerVersion: "normalizer-v1", normalizedText: text };
  const evidence = { id: "evidence-1", observationId: stored.id, sourceId: stored.sourceId, sourceUrl: stored.sourceUrl,
    sourceLabel: "Synthetic source", kind: "text", representationSha256: await sha256(stored.representation), parserVersion: stored.parserVersion,
    normalizerVersion: stored.normalizerVersion, normalizedTextSha256: await sha256(text), quote: "A literal supported sentence.", start: 0, end: 29 };
  return { stored, evidence };
}

test("text evidence binds exact representation, normalization, source, parser and offsets", async () => {
  const { stored, evidence } = await textFixture();
  assert.equal(await evidenceMatches(evidence, stored), true);
  for (const change of [{ observationId: "other" }, { sourceId: "other" }, { parserVersion: "parser-v2" }, { normalizerVersion: "normalizer-v2" },
    { representationSha256: HASH }, { normalizedTextSha256: HASH }, { start: 1, end: 30 }, { quote: "A literal unsupported claim.", end: 28 }]) {
    assert.equal(await evidenceMatches({ ...evidence, ...change }, stored), false, JSON.stringify(change));
  }
  assert.equal(await evidenceMatches(evidence, { ...stored, representation: `${stored.representation} ` }), false);
});

test("structured evidence resolves escaped JSON pointers, array indices and falsy values", async () => {
  const representation = '{"a/b":{"~key":[false,null,{"b":2,"a":1}]}}';
  const stored = { id: "observation-1", sourceId: "source-1", sourceUrl: "https://example.test/source", parserVersion: "parser-v1", representation };
  const evidence = { id: "evidence-1", kind: "structured", observationId: stored.id, sourceId: stored.sourceId, sourceUrl: stored.sourceUrl,
    sourceLabel: "Fixture", parserVersion: stored.parserVersion, representationSha256: await sha256(representation), pointer: "/a~1b/~0key/0", valueJson: "false" };
  assert.equal(await evidenceMatches(evidence, stored), true);
  assert.equal(await evidenceMatches({ ...evidence, pointer: "/a~1b/~0key/1", valueJson: "null" }, stored), true);
  assert.equal(await evidenceMatches({ ...evidence, pointer: "/a~1b/~0key/2", valueJson: '{"a":1,"b":2}' }, stored), true);
  for (const pointer of ["/a~1b/~0key/01", "/toString", "/a~1b/~0key/-", "/missing", "/bad~2escape"]) assert.equal(await evidenceMatches({ ...evidence, pointer }, stored), false, pointer);
});

test("PDF evidence does not substitute the text hash for original bytes or page renders", async () => {
  const { stored, evidence } = await textFixture();
  const bytes = new TextEncoder().encode("%PDF-synthetic-not-a-real-file");
  const artifactSha256 = await sha256(bytes);
  const pdf = { artifactSha256, extractionSha256: HASH, pageNumber: 3, pageRenderSha256: HASH };
  const ref = { ...evidence, kind: "pdf", representationSha256: artifactSha256, ...pdf };
  assert.equal(await evidenceMatches(ref, { ...stored, representation: bytes, pdf }), true);
  assert.equal(await evidenceMatches({ ...ref, artifactSha256: evidence.normalizedTextSha256 }, { ...stored, representation: bytes, pdf }), false);
  assert.equal(await evidenceMatches({ ...ref, pageNumber: 4 }, { ...stored, representation: bytes, pdf }), false);
  assert.equal(await evidenceMatches({ ...ref, pageRenderSha256: OTHER_HASH }, { ...stored, representation: bytes, pdf }), false);
});

test("dependency equality includes every identity, byte hash, rule and review decision", () => {
  const reviewed = dependencies();
  assert.equal(interpretationApplies(reviewed, dependencies()), true);
  for (const key of ["instrumentId", "policyVersionId", "artifactSha256", "extractionSha256", "extractionVersion", "provisionEvidenceSha256", "reviewDecisionId", "ruleVersion"] as const) {
    const value = key.includes("Sha256") ? OTHER_HASH : "changed";
    assert.equal(interpretationApplies(reviewed, { ...reviewed, [key]: value }), false, key);
  }
  for (const key of ["definitions", "exceptions", "references", "amendments"] as const) {
    assert.equal(interpretationApplies(reviewed, { ...reviewed, [key]: [{ id: `${key}-1`, sha256: OTHER_HASH }] }), false, key);
    assert.equal(interpretationApplies(reviewed, { ...reviewed, [key]: [] }), false, `${key} removed`);
  }
});

test("dependency order is not semantic but duplicate dependency identity is invalid", () => {
  const base = { ...dependencies(), definitions: [{ id: "definition-a", sha256: HASH }, { id: "definition-b", sha256: OTHER_HASH }] };
  assert.equal(interpretationApplies(base, { ...base, definitions: [...base.definitions].reverse() }), true);
  assert.equal(InterpretationDependencies.safeParse({ ...base, definitions: [base.definitions[0], base.definitions[0]] }).success, false);
});

test("policy public projection keeps chamber action, lifecycle and legal effect separate", async () => {
  const fixture = await syntheticFixture("policy");
  const result = await projectPolicyDossier(fixture.draft, fixture.context);
  assert.equal(result.kind, "policy"); assert.equal(result.jurisdiction, "PA");
  assert.equal(result.lifecycle, "active"); assert.equal(result.legalEffect, "not-in-effect");
  assert.equal(result.latestAction!.value.nativeCode, "PASS-HOUSE");
  assert.equal(result.latestAction!.value.sourceOccurredAt.precision, "day");
  assert.equal(result.verifiedAt, VERIFIED); assert.equal(result.interpretation.readiness, "reviewed");
  assert.equal(WatchPublicRecord.safeParse(result).success, true);
});

test("federal, PA, NJ, DE and regional accepted dossiers share the same contract", async () => {
  for (const jurisdiction of ["federal", "PA", "NJ", "DE", "regional"]) {
    const fixture = await syntheticFixture("policy");
    record(fixture.facts.get("f-identity")!.value).jurisdiction = jurisdiction;
    await fixture.refresh();
    assert.equal((await projectPolicyDossier(fixture.draft, fixture.context)).jurisdiction, jurisdiction);
  }
});

test("unknown facts stay null with reasons while verified empty arrays remain empty", async () => {
  const fixture = await syntheticFixture("policy"), draft = fixture.draft as PolicyDossierDraft;
  draft.summary = fixture.missing; draft.legalEffect = fixture.missing;
  fixture.facts.get("f-topics")!.value = [];
  await fixture.refresh();
  const result = await projectPolicyDossier(draft, fixture.context);
  assert.equal(result.summary, null); assert.equal(result.legalEffect, "unknown"); assert.equal(result.legalEffectFact, null);
  assert.deepEqual(result.topics, []);
  assert.ok(result.unknowns.some(item => item.field === "summary" && item.reason));
});

test("client accepted or verified booleans cannot authorize projection", async () => {
  const fixture = await syntheticFixture("policy");
  await assert.rejects(projectPolicyDossier({ ...fixture.draft, accepted: true, verified: true }, fixture.context));
  await rejects(projectPolicyDossier(fixture.draft, { ...fixture.context, acceptance: { accepted: true, verified: true } }), "accepted-snapshot-required");
  await rejects(projectPolicyDossier(fixture.draft, { ...fixture.context, facts: new Map() }), "accepted-fact-binding-conflict");
});

test("acceptance binds subject, exact draft, revision and actual acceptance time", async () => {
  const fixture = await syntheticFixture("policy");
  await rejects(projectPolicyDossier({ ...fixture.draft, slug: "substituted" }, fixture.context), "acceptance-binding-conflict");
  await rejects(projectPolicyDossier(fixture.draft, { ...fixture.context, currentSubjectRevision: 2 }), "acceptance-binding-conflict");
  await rejects(projectPolicyDossier(fixture.draft, { ...fixture.context, asOf: VERIFIED }), "acceptance-binding-conflict");
  await rejects(projectPolicyDossier(fixture.draft, { ...fixture.context, acceptance: { ...record(fixture.context.acceptance), subjectId: "other" } }), "acceptance-binding-conflict");
});

test("fact ID reuse cannot substitute another value, subject, field or unbound evidence", async () => {
  for (const change of [{ value: "Substituted title" }, { subjectId: "other" }, { field: "interpretation" }, { evidenceIds: ["evidence-other"] }]) {
    const fixture = await syntheticFixture("policy");
    Object.assign(fixture.facts.get("f-title")!, change);
    await rejects(projectPolicyDossier(fixture.draft, fixture.context), "accepted-fact-binding-conflict");
  }
});

test("immutable evidence bindings detect changed reference content even with a matching new observation", async () => {
  const fixture = await syntheticFixture("policy");
  const ref = EvidenceReference.parse(fixture.evidence.get("evidence-f-title"));
  fixture.evidence.set(ref.id, { ...ref, sourceLabel: "Changed source label" });
  await rejects(projectPolicyDossier(fixture.draft, fixture.context), "evidence-binding-conflict");
});

test("source enrollment, exact public source URL and persisted observations are independently required", async () => {
  const fixture = await syntheticFixture("policy");
  for (const context of [{ ...fixture.context, enrolledSourceIds: new Set<string>() }, { ...fixture.context, sourceUrlAllowed: () => false },
    { ...fixture.context, publicUrlAllowed: () => false }, { ...fixture.context, observations: new Map() }]) {
    await rejects(projectPolicyDossier(fixture.draft, context), "evidence-unavailable-or-untrusted");
  }
});

test("public projection explicitly excludes private row fields and reviewer identity", async () => {
  const fixture = await syntheticFixture("policy");
  const fact = fixture.facts.get("f-title")!;
  Object.assign(fact, { operatorNote: "PRIVATE-NOTE", rawHtml: "PRIVATE-HTML", token: "PRIVATE-TOKEN", prompt: "PRIVATE-PROMPT" });
  Object.assign(fact.verification, { privateContact: "PRIVATE-CONTACT" });
  assert.equal(await acceptedFactDigest(fact), await acceptedFactDigest(AcceptedFactRecord.parse(fact)));
  const result = await projectPolicyDossier(fixture.draft, fixture.context), json = JSON.stringify(result);
  for (const secret of ["PRIVATE-", "fixture-editor", "verifierId", "operatorNote", "rawHtml", "prompt", "acceptance-1"]) assert.equal(json.includes(secret), false, secret);
  assert.equal(WatchPublicRecord.safeParse({ ...result, privateNote: "not permitted" }).success, false);
});

test("every changed interpretation dependency holds current meaning without erasing metadata", async () => {
  for (const current of [{ ...dependencies(), artifactSha256: OTHER_HASH }, { ...dependencies(), definitions: [] },
    { ...dependencies(), exceptions: [] }, { ...dependencies(), amendments: [] }, null]) {
    const fixture = await syntheticFixture("policy"); fixture.currentInterpretations.set("f-interpretation", current);
    const result = await projectPolicyDossier(fixture.draft, fixture.context);
    assert.equal(result.interpretation.readiness, "evidence-changed"); assert.equal(result.interpretation.summary, null);
    assert.equal(result.identity.value.sourceInstrumentId, "HB 10000"); assert.equal(result.lifecycle, "active");
    assert.equal(result.sources.some(source => source.id === "evidence-f-interpretation"), false);
  }
});

test("interpretation requires human evidence-specific review for the same instrument", async () => {
  const fixture = await syntheticFixture("policy");
  fixture.facts.get("f-interpretation")!.verification.kind = "source-rule"; await fixture.refresh();
  await rejects(projectPolicyDossier(fixture.draft, fixture.context), "interpretation-review-required");
  fixture.facts.get("f-interpretation")!.verification.kind = "human-review";
  fixture.facts.get("f-interpretation")!.interpretationDependencies!.instrumentId = "other"; await fixture.refresh();
  await rejects(projectPolicyDossier(fixture.draft, fixture.context), "interpretation-subject-conflict");
});

test("an action date cannot cite evidence outside its accepted fact", async () => {
  const fixture = await syntheticFixture("policy");
  record(record(fixture.facts.get("f-action")!.value).sourceOccurredAt).evidenceIds = ["evidence-f-title"];
  await fixture.refresh();
  await rejects(projectPolicyDossier(fixture.draft, fixture.context), "date-evidence-not-bound");
});

test("a custom restricted-source local project gets context but never an OSS label", async () => {
  const fixture = await syntheticFixture("technology"), result = await projectTechnologyProfile(fixture.draft, fixture.context);
  assert.equal(result.oss, false); assert.deepEqual(result.licenseClassifications, ["restricted-source"]);
  assert.deepEqual(result.organizationIds, ["regional-lab"]); assert.equal(result.workflow!.value.steps.length, 1);
  assert.equal(result.setup!.value.verification, "maintainer-documented"); assert.ok(result.licenses[0]!.value.conditions[0]!.includes("separate authorization"));
});

test("a verified local relationship qualifies only the exact accepted artifact and entity", async () => {
  for (const change of [{ artifactId: "unrelated-artifact" }, { entityId: "nonregional-lab" }, { resourceId: "other-resource" }]) {
    const fixture = await syntheticFixture("technology"); Object.assign(record(fixture.facts.get("f-relationship")!.value), change); await fixture.refresh();
    await rejects(projectTechnologyProfile(fixture.draft, fixture.context), "verified-local-artifact-relationship-required");
  }
});

test("profile location, a star, sales office and conference appearance are not qualifying relation types", () => {
  for (const type of ["github-location", "starred-by", "sales-office", "conference-appearance", "generic-employment"]) {
    assert.equal(TechnologyRelationship.safeParse({ type, verified: true }).success, false, type);
  }
});

test("historical local creation survives transfer but expired current-use evidence cannot remain current", async () => {
  const fixture = await syntheticFixture("technology"), relation = record(fixture.facts.get("f-relationship")!.value);
  record(fixture.facts.get("f-artifact")!.value).url = "https://code.example.test/new-owner/project"; await fixture.refresh();
  assert.equal((await projectTechnologyProfile(fixture.draft, fixture.context)).organizationIds[0], "regional-lab");
  Object.assign(relation, { type: "used-at", temporalStatus: "current", validThrough: "2026-09-12T12:00:00.000Z" }); await fixture.refresh();
  await rejects(projectTechnologyProfile(fixture.draft, fixture.context), "verified-local-artifact-relationship-required");
  relation.validThrough = "2026-09-13T13:00:00.000Z"; await fixture.refresh();
  assert.equal((await projectTechnologyProfile(fixture.draft, fixture.context)).localRelationships[0]!.value.temporalStatus, "current");
});

test("unknown end dates are not fresh verification and future relationships do not qualify", async () => {
  const fixture = await syntheticFixture("technology");
  const artifact = TechnologyArtifact.parse(fixture.facts.get("f-artifact")!.value), relation = TechnologyRelationship.parse(fixture.facts.get("f-relationship")!.value);
  assert.equal(TechnologyRelationship.safeParse({ ...relation, temporalStatus: "current", validThrough: null }).success, false);
  assert.equal(TechnologyRelationship.safeParse({ ...relation, validFrom: "2026-01-01", validTo: "2026-01-01" }).success, false);
  assert.equal(technologyEligible({ resourceId: "technology-1", artifacts: [artifact], relationships: [{ ...relation, validFrom: "2027-01-01" }], regionalEntityIds: new Set(["regional-lab"]), asOf: NOW }), false);
});

test("only a current reviewed code license can enter the OSS filter", async () => {
  const fixture = await syntheticFixture("technology"), license = record(fixture.facts.get("f-license")!.value);
  Object.assign(license, { classification: "osi-open-source", spdxId: "MIT" }); await fixture.refresh();
  assert.equal((await projectTechnologyProfile(fixture.draft, fixture.context)).oss, true);
  const artifact = TechnologyArtifact.parse(fixture.facts.get("f-artifact")!.value), current = fixture.currentArtifacts.get("artifact-1")!;
  assert.equal(includeInOssFilter({ ...license, scope: "data" }, artifact, current), false);
  assert.equal(includeInOssFilter({ ...license, scope: "weights" }, artifact, current), false);
  assert.equal(includeInOssFilter({ ...license, artifactId: "other" }, artifact, current), false);
  assert.equal(includeInOssFilter(license, { ...artifact, availability: "private-link" }, current), false);
  assert.equal(includeInOssFilter(license, artifact, { ...current, version: "v2" }), false);
  assert.equal(includeInOssFilter(license, artifact, { ...current, licenseSha256s: { ...current.licenseSha256s, code: OTHER_HASH } }), false);
});

test("public repository visibility alone does not create a license assessment", async () => {
  const fixture = await syntheticFixture("technology"); (fixture.draft as TechnologyProfileDraft).licenseFactIds = []; await fixture.refresh();
  const result = await projectTechnologyProfile(fixture.draft, fixture.context);
  assert.equal(result.oss, false); assert.deepEqual(result.licenses, []); assert.deepEqual(result.licenseClassifications, ["unknown"]);
  assert.ok(result.unknowns.some(item => item.field === "license:artifact-1:code"));
});

test("changed license bytes invalidate classification while preserving accepted purpose", async () => {
  const fixture = await syntheticFixture("technology"); fixture.currentArtifacts.get("artifact-1")!.licenseSha256s.code = OTHER_HASH;
  const result = await projectTechnologyProfile(fixture.draft, fixture.context);
  assert.equal(result.oss, false); assert.deepEqual(result.licenseClassifications, ["unknown"]);
  assert.equal(result.licenses.length, 0); assert.ok(result.purpose!.value.includes("order-set"));
});

test("license knowledge requires actual reviewed bytes and human acceptance", async () => {
  const fixture = await syntheticFixture("technology"), license = record(fixture.facts.get("f-license")!.value);
  assert.equal(TechnologyLicense.safeParse({ ...license, classification: "osi-open-source", spdxId: "MIT", licenseSha256: null }).success, false);
  assert.equal(TechnologyLicense.safeParse({ ...license, licenseSha256: null }).success, false);
  fixture.facts.get("f-license")!.verification.kind = "source-rule"; await fixture.refresh();
  await rejects(projectTechnologyProfile(fixture.draft, fixture.context), "license-review-required");
});

test("artifact version changes and unregistered public guide links fail closed", async () => {
  const fixture = await syntheticFixture("technology"); fixture.currentArtifacts.get("artifact-1")!.version = "v2";
  await rejects(projectTechnologyProfile(fixture.draft, fixture.context), "artifact-binding-conflict");
  fixture.currentArtifacts.get("artifact-1")!.version = "v1";
  record(fixture.facts.get("f-setup")!.value).guideUrl = "https://unknown.example.test/guide"; await fixture.refresh();
  await rejects(projectTechnologyProfile(fixture.draft, fixture.context), "public-link-not-enrolled");
});

test("invalid public route slugs, oversized arrays and extra public fields are rejected", async () => {
  const fixture = await syntheticFixture("technology");
  assert.equal(TechnologyProfileDraft.safeParse({ ...fixture.draft, slug: "updates" }).success, false);
  assert.equal(TechnologyProfileDraft.safeParse({ ...fixture.draft, artifactFactIds: Array(13).fill("f-artifact") }).success, false);
  assert.equal(EvidenceReference.safeParse({ verified: true }).success, false);
  assert.notEqual(await evidenceReferenceDigest(fixture.evidence.get("evidence-f-title")), await sha256("arbitrary client flag"));
});

test("accepted facts and public records have byte limits, not only character limits", async () => {
  const fixture = await syntheticFixture("technology"), fact = fixture.facts.get("f-purpose")!;
  assert.equal(AcceptedFactRecord.safeParse({ ...fact, value: "\u4e2d".repeat(9000) }).success, false);
  const result = await projectTechnologyProfile(fixture.draft, fixture.context);
  const largeLicense = { ...result.licenses[0]!, value: { ...result.licenses[0]!.value, conditions: Array(4).fill("x".repeat(5000)) } };
  assert.equal(WatchPublicRecord.safeParse({ ...result, licenses: Array(8).fill(largeLicense) }).success, false);
});

test("duplicate artifacts and conflicting license assessments cannot appear as independent facts", async () => {
  const fixture = await syntheticFixture("technology"), draft = fixture.draft as TechnologyProfileDraft;
  draft.artifactFactIds.push("f-artifact"); await fixture.refresh();
  await rejects(projectTechnologyProfile(draft, fixture.context), "duplicate-artifact");
  draft.artifactFactIds.pop(); draft.licenseFactIds.push("f-license"); await fixture.refresh();
  await rejects(projectTechnologyProfile(draft, fixture.context), "conflicting-license-assessments");
});

test("missing original bytes and malformed structured values never match evidence", async () => {
  const { stored, evidence } = await textFixture();
  assert.equal(await evidenceMatches(evidence, { ...stored, representation: "" }), false);
  assert.equal(EvidenceReference.safeParse({ ...evidence, kind: "structured", pointer: "/field", valueJson: "not json" }).success, false);
});
