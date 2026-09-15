import { AcceptedFactRecord, PolicyDossierDraft, TechnologyProfileDraft, acceptedFactDigest, canonicalJson,
  evidenceReferenceDigest, sha256, watchDraftDigest } from "../../../src/content/watch-schema";
import type { CurrentArtifact, StoredObservation, WatchProjectionContext } from "../../../src/content/watch-projection";

export const NOW = "2026-09-12T13:00:00.000Z";
export const VERIFIED = "2026-09-11T13:00:00.000Z";
export const HASH = "a".repeat(64);
export const OTHER_HASH = "b".repeat(64);
export const dependencies = () => ({ instrumentId: "policy-1", policyVersionId: "policy-version-1", artifactSha256: HASH,
  extractionSha256: HASH, extractionVersion: "extract-v1", provisionEvidenceSha256: HASH,
  definitions: [{ id: "definition-1", sha256: HASH }], exceptions: [{ id: "exception-1", sha256: HASH }],
  references: [{ id: "reference-1", sha256: HASH }], amendments: [{ id: "amendment-1", sha256: HASH }],
  reviewDecisionId: "review-1", ruleVersion: "policy-review-v1" });
const missing = { unavailableReason: "Not established by this synthetic fixture." };

// Synthetic mechanics only: these helpers manufacture a trusted server snapshot
// for tests. They are not an ingestion, review or publication implementation.
export async function syntheticFixture(kind: "policy" | "technology") {
  const facts = new Map<string, AcceptedFactRecord>();
  const evidence = new Map<string, unknown>();
  const observations = new Map<string, StoredObservation>();
  const currentInterpretations = new Map<string, unknown>();
  const currentArtifacts = new Map<string, CurrentArtifact>();
  const subjectId = `${kind}-1`;
  const add = (id: string, field: string, value: unknown, human = false) => facts.set(id, {
    id, subjectId, field, value, evidenceIds: [`evidence-${id}`], evidenceDigests: [{ id: `evidence-${id}`, sha256: HASH }],
    verification: { kind: human ? "human-review" : "source-rule", ruleId: "synthetic-rule", ruleVersion: "v1", verifierId: "fixture-editor", verifiedAt: VERIFIED },
    interpretationDependencies: null,
  });
  let draft: PolicyDossierDraft | TechnologyProfileDraft;
  add("f-title", "title", kind === "policy" ? "Synthetic health data measure" : "Synthetic restricted-source project");
  if (kind === "policy") {
    add("f-identity", "policy-identity", { jurisdiction: "PA", jurisdictionId: "us-pa", bodyId: "pa-legislature", sessionKey: "2025-2026", instrumentType: "bill", sourceInstrumentId: "HB 10000" });
    add("f-lifecycle", "lifecycle", "active"); add("f-effect", "legal-effect", "not-in-effect");
    add("f-topics", "topics", ["data-governance"]); add("f-summary", "summary", "An illustrative health data proposal.");
    add("f-action", "latest-action", { id: "action-1", nativeCode: "PASS-HOUSE", text: "Passed the House; not enacted.", bodyId: "pa-house",
      sourceOccurredAt: { precision: "day", value: "2026-09-10", timezone: "America/New_York", timezoneReason: null, evidenceIds: ["evidence-f-action"] }, sourceOrder: 2 });
    add("f-interpretation", "interpretation", "Synthetic reviewed meaning bound to its complete dependency set.", true);
    facts.get("f-interpretation")!.interpretationDependencies = dependencies();
    currentInterpretations.set("f-interpretation", dependencies());
    draft = { kind, id: subjectId, slug: "synthetic-policy", subjectRevision: 1, titleFactId: "f-title", identityFactId: "f-identity",
      lifecycle: { factId: "f-lifecycle" }, legalEffect: { factId: "f-effect" }, topics: { factId: "f-topics" }, summary: { factId: "f-summary" },
      latestAction: { factId: "f-action" }, interpretation: { factId: "f-interpretation" }, timelineFactIds: [] };
  } else {
    add("f-resource-type", "resource-type", "software"); add("f-purpose", "purpose", "Compare institution order-set documentation offline.");
    add("f-users", "intended-users", ["Clinical informatics researchers"]);
    add("f-workflow", "workflow", { inputs: ["Institution-authorized structured data"], steps: ["Load a versioned export into an offline viewer."], outputs: ["Research comparison report"] });
    add("f-setup", "setup", { verification: "maintainer-documented", version: "v1", prerequisites: ["An authorized test export"], guideUrl: "https://code.example.test/project/docs" });
    add("f-limitations", "limitations", ["Not a live patient-care system."]);
    add("f-artifact", "artifact", { id: "artifact-1", resourceId: subjectId, artifactType: "repository", host: "code.example.test", nativeId: "123456789", version: "v1", url: "https://code.example.test/project", availability: "public" });
    add("f-relationship", "local-relationship", { id: "relationship-1", resourceId: subjectId, artifactId: "artifact-1", entityId: "regional-lab", entityName: "Synthetic Delaware Valley lab", type: "created-by",
      temporalStatus: "historical", validFrom: "2025-01-01", validTo: null, checkedAt: VERIFIED, validThrough: null }, true);
    add("f-license", "license", { artifactId: "artifact-1", artifactVersion: "v1", scope: "code", classification: "restricted-source", spdxId: null,
      licenseSha256: HASH, sourceUrl: "https://code.example.test/project/LICENSE", conditions: ["Clinical use requires separate authorization."] }, true);
    currentArtifacts.set("artifact-1", { resourceId: subjectId, version: "v1", licenseSha256s: { code: HASH, data: null, weights: null } });
    draft = { kind, id: subjectId, slug: "synthetic-technology", subjectRevision: 1, titleFactId: "f-title", resourceTypeFactId: "f-resource-type",
      purpose: { factId: "f-purpose" }, intendedUsers: { factId: "f-users" }, workflow: { factId: "f-workflow" }, setup: { factId: "f-setup" },
      limitations: { factId: "f-limitations" }, artifactFactIds: ["f-artifact"], relationshipFactIds: ["f-relationship"], licenseFactIds: ["f-license"] };
  }
  const context: WatchProjectionContext = { acceptance: null, currentSubjectRevision: 1, asOf: NOW, facts, evidence, observations,
    enrolledSourceIds: new Set(["synthetic-source"]), sourceUrlAllowed: (sourceId, url) => sourceId === "synthetic-source" && new URL(url).hostname === "fixtures.example.test",
    publicUrlAllowed: url => ["fixtures.example.test", "code.example.test"].includes(new URL(url).hostname),
    regionalEntityIds: new Set(["regional-lab"]), currentInterpretations, currentArtifacts };
  async function refresh() {
    for (const [id, fact] of facts) {
      const sourceUrl = `https://fixtures.example.test/${id}`, representation = canonicalJson({ fact: fact.value });
      const observed: StoredObservation = { id: `observation-${id}`, sourceId: "synthetic-source", sourceUrl, parserVersion: "fixture-v1", representation };
      observations.set(observed.id, observed);
      const ref = { id: `evidence-${id}`, kind: "structured", observationId: observed.id, sourceId: observed.sourceId, sourceUrl,
        sourceLabel: "Synthetic official fixture", representationSha256: await sha256(representation), parserVersion: observed.parserVersion, pointer: "/fact", valueJson: canonicalJson(fact.value) };
      evidence.set(ref.id, ref); fact.evidenceDigests = [{ id: ref.id, sha256: await evidenceReferenceDigest(ref) }];
    }
    context.acceptance = { id: "acceptance-1", subjectId, kind, subjectRevision: draft.subjectRevision,
      draftSha256: await watchDraftDigest(draft), acceptedAt: NOW, gateVersion: "synthetic-accepted-gates-v1",
      factDigests: await Promise.all([...facts.values()].map(async fact => ({ id: fact.id, sha256: await acceptedFactDigest(fact) }))) };
  }
  await refresh();
  return { draft, context, facts, evidence, observations, currentInterpretations, currentArtifacts, refresh, missing };
}
