import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DISCOVERY_PROVIDERS } from "../src/content/discovery-schema";
import { DiscoveryReferenceManifest, assessDiscoveryReferenceReadiness, discoveryFamilyKeys,
  summarizeDiscoveryEvaluation, wilson95 } from "../src/ingest/discovery-evaluation";
import type { DiscoveryReferenceManifest as Manifest, DiscoveryMetricObservation, DiscoveryReceiptVerifier } from "../src/ingest/discovery-evaluation";

// Every generated subject, source, person and receipt below is fictional test input.
// This mock resolver proves checker plumbing, never real source truth or authentication.
const verifyFixture: DiscoveryReceiptVerifier = async (receipt, expectation) => ({ status: "verified", receiptSha256: receipt.sha256,
  ...expectation, method: "synthetic-test-only-resolver" });
const hash = (n: number) => n.toString(16).padStart(64, "0");
const ref = (id: string) => ({ id, sha256: hash(900000) });
const revision = { id: "fixture-rubric", revision: 1 };
const labels = (overall: "eligible" | "ineligible" | "ambiguous") => ({ overall, identity: "supported" as const,
  professionalBasis: "supported" as const, relevance: "supported" as const, currentPresence: "ambiguous" as const,
  regionalCreation: "supported" as const, creatorRole: "supported" as const, rights: "supported" as const });
function fixture(): Manifest {
  const m: Manifest = { schemaVersion: "discovery-reference-v1", status: "not_frozen", revision: { id: "fixture-reference", revision: 1 },
    policy: { id: "fixture-policy", revision: 1 }, rubric: revision, design: "wp03-evaluation-design-v1", createdAt: "2026-11-14T00:00:00Z",
    reviewers: ["reviewer-a", "reviewer-b"].map(id => ({ id, authority: ref(`authority-${id}`) })), sources: [], cases: [],
    sampling: { heldout: null, recall: null, audit: null }, history: { receipt: ref("history"), previous: [], exposures: [] } };
  for (const kind of ["heldout", "recall"] as const) m.sampling[kind] = { frame: ref(`frame-${kind}`), method: "Synthetic complete-frame test selection",
    selectedAt: "2026-11-13T00:00:00Z", sourceScopes: ["fixture-scope"], from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z", assembly: ref(`assembly-${kind}`) };
  m.sampling.audit = { frameDefinition: "Complete admitted frame during a prespecified WP24 interval", selectionMethod: "Prespecified seeded sampling or complete enumeration; no cherry-picking",
    intervalRule: "WP24 freezes actual start/end before inspecting outcomes", minimumIndependentItems: 100, procedure: ref("audit-procedure") };
  let index = 0;
  const append = (partition: "development" | "heldout" | "recall" | "audit", count: number) => {
    for (let i = 0; i < count; i++, index++) {
      const id = `fixture-${index}`, sourceId = `source-${index}`, origin = `origin-${index}`, route = DISCOVERY_PROVIDERS[i % 6]!;
      const truth = partition === "heldout" ? ["eligible", "ineligible", "ambiguous"][Math.floor(i / 6) % 3] as "eligible" | "ineligible" | "ambiguous" : "eligible";
      m.sources.push({ id: sourceId, revision: { id: sourceId, revision: 1 }, identity: { provider: route, installation: "fixture", nativeId: id, kind: "artifact" },
        originFamilyId: origin, observedAt: "2026-10-10T00:00:00Z", representationSha256: hash(index + 1), evidence: ref(`evidence-${index}`), permission: ref(`permission-${index}`) });
      m.cases.push({ id, partition, claimMode: "work-regional-at-creation", subject: { kind: "artifact", id }, primaryRoute: route, appearances: [route], counties: ["PA:Philadelphia"], countyUnknown: false,
        families: { people: [`person-${index}`], projects: [], origins: [origin], equivalences: [] }, sourceIds: [sourceId], familyReview: ref(`family-${index}`),
        annotations: ["reviewer-a", "reviewer-b"].map(reviewerId => ({ reviewerId, labels: labels(truth), rationale: "Synthetic label with fictional evidence.", confidence: "medium", sourceIds: [sourceId],
          rubric: revision, recordedAt: "2026-11-13T01:00:00Z", blindedBatch: ref(`blind-${index}-${reviewerId}`), receipt: ref(`label-${index}-${reviewerId}`) })),
        adjudication: { reviewerId: "reviewer-a", labels: labels(truth), rationale: "Synthetic adjudication; original labels retained.", sourceIds: [sourceId], rubric: revision,
          recordedAt: "2026-11-13T02:00:00Z", receipt: ref(`adjudication-${index}`) }, selectionReceipt: ref(`selection-${index}`),
        challenges: [["ambiguous-name", "account-person", "expired-affiliation", "adoption-only", "generic-ai", "repository-free-paper", "creator-without-work", "partial-date", "retraction", "mirror", "unsupported-project-join"][index % 11] as Manifest["cases"][number]["challenges"][number]] });
    }
  };
  append("development", 1); append("heldout", 360); append("recall", 100); append("audit", 100);
  return DiscoveryReferenceManifest.parse(m);
}
async function blocked(m: unknown, substring: string, verifier = verifyFixture) {
  const result = await assessDiscoveryReferenceReadiness(m, verifier);
  assert.equal(result.readiness, "blocked"); assert.ok(result.findings.some(x => x.includes(substring)), `${substring}: ${result.findings.slice(0, 10)}`);
}

test("actual checked-in inventory is empty, unfrozen and blocked", async () => {
  const m = DiscoveryReferenceManifest.parse(JSON.parse(await readFile(new URL("../docs/discovery/reference-manifest.json", import.meta.url), "utf8")));
  assert.equal(m.status, "not_frozen"); assert.equal(m.cases.length, 0);
  const result = await assessDiscoveryReferenceReadiness(m);
  assert.equal(result.readiness, "blocked");
  for (const expected of ["heldout-total:0", "recall-independent-count:0", "missing-audit-selection-plan", "missing-independent-receipt-verifier"])
    assert.ok(result.findings.some(x => x.includes(expected)));
});
test("strict schema refuses malformed, additional fields and self-issued frozen claims", async () => {
  await blocked({ bogus: true }, "schema:");
  await blocked({ ...fixture(), status: "frozen" }, "schema:status");
  await blocked({ ...fixture(), independent: true }, "schema:");
  const m = fixture(); m.sources[0]!.observedAt = "yesterday"; await blocked(m, "schema:");
});
test("complete synthetic fixture can reach review readiness but never authenticated freeze", async () => {
  const result = await assessDiscoveryReferenceReadiness(fixture(), verifyFixture);
  assert.deepEqual(result.findings, []); assert.equal(result.readiness, "ready_for_accountable_freeze_review"); assert.equal(result.status, "not_frozen");
});
test("conflicting independent labels and adjudicated ambiguity remain intact", async () => {
  const m = fixture(), item = m.cases[1]!;
  item.annotations[0]!.labels = labels("eligible"); item.annotations[0]!.rationale = "Synthetic source A supports the claim.";
  item.annotations[1]!.labels = labels("ineligible"); item.annotations[1]!.rationale = "Synthetic source B contradicts the claim.";
  item.adjudication!.labels = labels("ambiguous"); item.adjudication!.rationale = "The fictional conflict is unresolved; retain both judgments.";
  const before = JSON.stringify(m);
  assert.equal((await assessDiscoveryReferenceReadiness(m, verifyFixture)).readiness, "ready_for_accountable_freeze_review");
  assert.equal(JSON.stringify(m), before);
});
test("Boolean claims, missing resolver, forged or stale receipt bindings cannot authenticate labels", async () => {
  const m = fixture();
  assert.equal((await assessDiscoveryReferenceReadiness(m)).readiness, "blocked");
  await blocked(m, "unverified:", async () => true);
  await blocked(m, "unverified:", async (r, e) => ({ status: "verified", receiptSha256: r.sha256, ...e, contentSha256: hash(1), method: "synthetic" }));
  await blocked(m, "unverified:", async () => { throw Error("unavailable"); });
});
test("case IDs, routes, independent reviewer records and source permissions are mandatory", async () => {
  const duplicate = fixture(); duplicate.cases[1]!.id = duplicate.cases[0]!.id; await blocked(duplicate, "duplicate-case-id");
  const quota = fixture(); quota.cases[1]!.primaryRoute = "pubmed"; quota.cases[1]!.appearances = ["pubmed"]; await blocked(quota, "heldout-route:");
  const sameReviewer = fixture(); sameReviewer.cases[1]!.annotations[1]!.reviewerId = "reviewer-a"; await blocked(sameReviewer, "independent-annotations-required");
  const missingAdjudication = fixture(); missingAdjudication.cases[1]!.adjudication = null; await blocked(missingAdjudication, "missing-adjudication");
  const wrongKind = fixture(); wrongKind.cases[1]!.claimMode = "creator-current"; await blocked(wrongKind, "claim-subject-kind");
  await blocked(fixture(), "unverified:permission", async (r, e) => e.purpose === "permission" ? { status: "unavailable" } : verifyFixture(r, e));
});
test("person, project, provenance, DOI/preprint, identical bytes and account alias leakage are blocked", async () => {
  for (const field of ["people", "projects", "origins", "equivalences"] as const) {
    const m = fixture(); m.cases[0]!.families[field] = ["shared-doi-preprint-mirror-alias"]; m.cases[1]!.families[field] = ["shared-doi-preprint-mirror-alias"];
    await blocked(m, "partition-leakage:");
  }
  const m = fixture(); m.sources[1]!.representationSha256 = m.sources[0]!.representationSha256; await blocked(m, "partition-leakage:bytes:");
  const alias = fixture(); alias.sources[1]!.identity = alias.sources[0]!.identity; await blocked(alias, "partition-leakage:native:");
});
test("origin-equivalent copies cannot fill heldout or recall quotas", async () => {
  const m = fixture(); m.cases[2]!.families.origins.push(...m.cases[1]!.families.origins); await blocked(m, "heldout-cross-route-or-family-duplicates");
  const n = fixture(), rows = n.cases.filter(x => x.partition === "recall"); rows[1]!.families.origins.push(...rows[0]!.families.origins);
  await blocked(n, "recall-independent-count:99");
  const ambiguousRecall = fixture(); ambiguousRecall.cases.find(x => x.partition === "recall")!.adjudication!.labels.overall = "ambiguous";
  await blocked(ambiguousRecall, "recall-not-independently-eligible");
});
test("WP03 requires an audit plan, not future admitted audit data", async () => {
  const m = fixture(); m.cases = m.cases.filter(x => x.partition !== "audit");
  assert.equal((await assessDiscoveryReferenceReadiness(m, verifyFixture)).readiness, "ready_for_accountable_freeze_review");
  m.sampling.audit = null; await blocked(m, "missing-audit-selection-plan");
});
test("distinct works may share heldout creator/project families and recall/audit may overlap", async () => {
  const m = fixture(); m.cases[2]!.families.people = m.cases[1]!.families.people; m.cases[1]!.families.projects = ["shared-project"]; m.cases[2]!.families.projects = ["shared-project"];
  const recall = m.cases.find(x => x.partition === "recall")!, audit = m.cases.find(x => x.partition === "audit")!;
  audit.subject = recall.subject; audit.families = structuredClone(recall.families); audit.sourceIds = recall.sourceIds;
  audit.primaryRoute = recall.primaryRoute; audit.appearances = recall.appearances;
  for (const annotation of audit.annotations) annotation.sourceIds = recall.sourceIds;
  audit.adjudication!.sourceIds = recall.sourceIds;
  assert.equal((await assessDiscoveryReferenceReadiness(m, verifyFixture)).readiness, "ready_for_accountable_freeze_review");
});
test("heldout exposure, rubric changes and relabeled IDs require new families and new revision", async () => {
  const m = fixture(), item = m.cases[1]!;
  m.history!.exposures.push({ caseIds: [item.id], at: "2026-11-13T10:00:00Z", reason: "tuning", receipt: ref("exposure") });
  await blocked(m, "heldout-already-exposed");
  for (const exposed of [true, false]) {
    const n = fixture(); n.history!.previous.push({ revision: { id: "old", revision: 1 }, rubric: { ...revision, revision: exposed ? 1 : 2 },
      heldoutCaseIds: ["renamed-id"], heldoutFamilyKeys: discoveryFamilyKeys(n.cases[1]!.families), exposedAt: exposed ? "2026-11-12T00:00:00Z" : null });
    await blocked(n, "fresh-holdout-required");
  }
  const reused = fixture(); reused.history!.previous.push({ revision: reused.revision, rubric: revision, heldoutCaseIds: [], heldoutFamilyKeys: [], exposedAt: null });
  await blocked(reused, "revision-reused");
});
test("current exposure through another case in a heldout family blocks freshness", async () => {
  const m = fixture(), recall = m.cases.find(x => x.partition === "recall")!;
  recall.families.people = m.cases[1]!.families.people;
  m.history!.exposures.push({ caseIds: [recall.id], at: "2026-11-13T10:00:00Z", reason: "tuning", receipt: ref("family-exposure") });
  await blocked(m, "heldout-family-already-exposed");
  const unknown = fixture(); unknown.history!.exposures.push({ caseIds: ["unknown-case"], at: "2026-11-13T10:00:00Z", reason: "tuning", receipt: ref("unknown-exposure") });
  await blocked(unknown, "unknown-exposure-case");
});
test("transitive exposure through an intermediate non-heldout case blocks freshness", async () => {
  const m = fixture(), a = m.cases.find(x => x.partition === "recall")!, b = m.cases.find(x => x.partition === "audit")!, c = m.cases[1]!;
  a.families.people = ["bridge-person"]; b.families.people = ["bridge-person"];
  b.families.projects = ["bridge-project"]; c.families.projects = ["bridge-project"];
  m.history!.exposures.push({ caseIds: [a.id], at: "2026-11-13T10:00:00Z", reason: "tuning", receipt: ref("transitive-exposure") });
  await blocked(m, "heldout-family-already-exposed");
  const split = fixture(), bridge = split.cases.find(x => x.partition === "audit")!;
  split.cases[0]!.families.people = ["split-person"]; bridge.families.people = ["split-person"];
  bridge.families.projects = ["split-project"]; split.cases[1]!.families.projects = ["split-project"];
  await blocked(split, "partition-leakage:connected-component");
  const copies = fixture(); copies.cases.find(x => x.partition === "audit")!.families.origins = [...copies.cases[1]!.families.origins, ...copies.cases[2]!.families.origins];
  await blocked(copies, "heldout-cross-route-or-family-duplicates");
});
const observation = (i: number, truth: "eligible" | "ineligible" | "ambiguous" = "eligible"): DiscoveryMetricObservation => ({ caseId: `metric-${i}`,
  cohorts: ["admitted-audit", "recall-roster", "candidate-evaluation"],
  families: { people: [`p-${i}`], projects: [], origins: [`o-${i}`], equivalences: [] }, truth, predictedPositive: true, captured: true, admitted: true, criticalErrors: [] });
test("Wilson 95/100 passes point estimate but fails lower-bound gate", () => {
  const result = summarizeDiscoveryEvaluation(Array.from({ length: 100 }, (_, i) => observation(i, i < 95 ? "eligible" : "ineligible")));
  assert.equal(result.precision.value, .95); assert.ok(result.precision.interval!.lower < .90); assert.ok(Math.abs(result.precision.interval!.lower - .8882480347) < 1e-8);
  assert.equal(result.precision.numericalGate, false);
  assert.equal(summarizeDiscoveryEvaluation(Array.from({ length: 100 }, (_, i) => observation(i))).precision.numericalGate, true);
});
test("unresolved positives remain denominator failures and never true positives", () => {
  const r = summarizeDiscoveryEvaluation([observation(0), observation(1, "ambiguous"), observation(2, "ineligible")]);
  assert.deepEqual([r.precision.numerator, r.precision.denominator], [1, 3]);
  assert.deepEqual([r.recall.numerator, r.recall.denominator], [1, 2]);
  assert.deepEqual(r.unresolvedPositiveCases, ["metric-1"]); assert.deepEqual(r.recallExclusions, [{ caseId: "metric-2", reason: "explicitly-ineligible-reference" }]);
});
test("transitively clustered duplicates count as one conservative trial", () => {
  const a = observation(0), b = observation(1), c = observation(2, "ambiguous"); b.families.people = a.families.people; c.families.origins = b.families.origins;
  const result = summarizeDiscoveryEvaluation([a, b, c]);
  assert.equal(result.rawCases, 3); assert.equal(result.canonicalCaseComponents, 2); assert.equal(result.correlatedFamilyComponents, 1);
  assert.deepEqual([result.precision.numerator, result.precision.denominator], [1, 2]);
  assert.deepEqual([result.clustering.conservativeAdmissionPrecision.numerator, result.clustering.conservativeAdmissionPrecision.denominator], [0, 1]);
  assert.equal(result.precision.numericalGate, false);
});
test("unadmitted model proposals cannot satisfy the admission precision gate", () => {
  const r = summarizeDiscoveryEvaluation(Array.from({ length: 100 }, (_, i) => ({ ...observation(i), cohorts: ["candidate-evaluation", "recall-roster"], admitted: false })));
  assert.equal(r.precision.denominator, 0); assert.equal(r.precision.value, null); assert.equal(r.precision.numericalGate, false);
  assert.equal(r.candidatePrecision.value, 1); assert.equal(r.admittedRecall.numerator, 0); assert.equal(r.publishedRecall.status, "unavailable");
  const ambiguous = summarizeDiscoveryEvaluation([{ ...observation(0, "ambiguous"), predictedPositive: false }]);
  assert.deepEqual([ambiguous.precision.numerator, ambiguous.precision.denominator], [0, 1]);
});
test("candidate-only critical observations cannot establish a public-output audit gate", () => {
  const r = summarizeDiscoveryEvaluation([{ ...observation(0), cohorts: ["candidate-evaluation"], admitted: false }]);
  assert.equal(r.criticalIdentityGate, false);
});
test("published recall requires explicit publication observations and stays separate", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...observation(i), published: i < 80 }));
  const r = summarizeDiscoveryEvaluation(rows);
  assert.equal(r.admittedRecall.numerator, 100); assert.equal(r.publishedRecall.status, "available");
  if (r.publishedRecall.status === "available") assert.equal(r.publishedRecall.numerator, 80);
  assert.throws(() => summarizeDiscoveryEvaluation([{ ...observation(0), admitted: false, published: true }]));
});
test("mixed audit and recall populations cannot contaminate each other's denominators", () => {
  const audit: DiscoveryMetricObservation = { ...observation(0), cohorts: ["admitted-audit"], truth: "ineligible" };
  const recall: DiscoveryMetricObservation = { ...observation(1), cohorts: ["recall-roster"], published: false };
  const candidate: DiscoveryMetricObservation = { ...observation(2), cohorts: ["candidate-evaluation"], admitted: false };
  const r = summarizeDiscoveryEvaluation([audit, recall, candidate]);
  assert.deepEqual([r.precision.numerator, r.precision.denominator], [0, 1]);
  assert.deepEqual([r.recall.numerator, r.recall.denominator], [1, 1]);
  assert.deepEqual([r.candidatePrecision.numerator, r.candidatePrecision.denominator], [1, 1]);
  assert.equal(r.publishedRecall.status, "available");
  assert.deepEqual(r.recallExclusions, []);
  assert.throws(() => summarizeDiscoveryEvaluation([{ ...audit, cohorts: [] }]));
  assert.throws(() => summarizeDiscoveryEvaluation([{ ...audit, cohorts: undefined }]));
  assert.throws(() => summarizeDiscoveryEvaluation([{ ...audit, admitted: false }]), /audit-cohort-requires-admission-at-sampling/);
});
test("empty or malformed metrics never pass, and admitted recall stays separate", () => {
  assert.equal(summarizeDiscoveryEvaluation([]).precision.value, null); assert.equal(wilson95(0, 0), null);
  for (const args of [[101, 100], [-1, 100], [1.5, 100], [NaN, 100]]) assert.throws(() => wilson95(args[0]!, args[1]!));
  assert.throws(() => summarizeDiscoveryEvaluation([observation(1), observation(1)]));
  const row = observation(1); row.cohorts = ["recall-roster", "candidate-evaluation"]; row.admitted = false; row.criticalErrors = ["false-current-affiliation"];
  const r = summarizeDiscoveryEvaluation([row]); assert.equal(r.recall.numerator, 1); assert.equal(r.admittedRecall.numerator, 0); assert.equal(r.criticalErrorCount, 1);
  assert.equal(r.criticalIdentityGate, false);
  assert.throws(() => summarizeDiscoveryEvaluation([{ ...observation(0), captured: false }]));
  assert.equal(r.acceptance, "not_evaluated");
});
