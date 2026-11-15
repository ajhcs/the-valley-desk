import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DISCOVERY_PROVIDERS } from "../src/content/discovery-schema";
import { DiscoveryReferenceManifest, assessDiscoveryReferenceDispatchStructure as assess } from "../src/ingest/discovery-evaluation";

// Structural fixtures only: these references authenticate nothing and contain no human labels.
const ref = (id: string) => ({ id, sha256: "0".repeat(64) });
const instant = "2026-01-01T00:00:00Z";
function fixture(partition: "development" | "heldout" | "recall" = "development") {
  const m = DiscoveryReferenceManifest.parse({ schemaVersion: "discovery-reference-v1", status: "not_frozen",
    revision: { id: "structure-manifest", revision: 2 }, rubric: { id: "structure-rubric", revision: 1 },
    policy: { id: "structure-policy", revision: 1 }, design: "wp03-evaluation-design-v1", createdAt: instant,
    reviewers: [], sources: [], cases: [], sampling: { heldout: null, recall: null, audit: null },
    history: { receipt: ref("history"), previous: [], exposures: [] } });
  const append = (id: string, kind: typeof partition | "challenge", route = DISCOVERY_PROVIDERS[0]) => {
    const sourceId = `source-${id}`, origin = `origin-${id}`;
    m.sources.push({ id: sourceId, revision: { id: sourceId, revision: 1 },
      identity: { provider: route, installation: "structural-fixture", nativeId: id, kind: "artifact" },
      originFamilyId: origin, observedAt: instant,
      representationSha256: createHash("sha256").update(id).digest("hex"), evidence: ref(`evidence-${id}`), permission: ref(`permission-${id}`) });
    m.cases.push({ id, partition: kind, subject: { kind: "artifact", id: `subject-${id}` },
      claimMode: "work-regional-at-creation", primaryRoute: route, appearances: [route], counties: [], countyUnknown: true,
      families: { people: [], projects: [], origins: [origin], equivalences: [] }, sourceIds: [sourceId],
      familyReview: ref(`family-${id}`), selectionReceipt: ref(`selection-${id}`), annotations: [], adjudication: null, challenges: [] });
  };
  const size = partition === "heldout" ? 360 : partition === "recall" ? 100 : 1;
  for (let i = 0; i < size; i++) append(`case-${i}`, partition, DISCOVERY_PROVIDERS[i % 6]!);
  if (partition === "heldout") append("development", "development");
  return { m, append };
}
test("pre-annotation structure can qualify without labels but never authenticates a reference", () => {
  for (const partition of ["development", "heldout", "recall"] as const) {
    const { m } = fixture(partition), before = structuredClone(m), result = assess(m, "case-0");
    assert.equal(result.readiness, "ready_for_authenticated_dispatch_checks");
    assert.equal(result.status, "not_frozen"); assert.deepEqual(result.findings, []); assert.deepEqual(m, before);
    assert.equal(m.cases[0]!.annotations.length, 0); assert.equal(m.cases[0]!.adjudication, null);
  }
});
test("heldout dispatch requires complete route quotas; recall counts canonical candidates", () => {
  const { m } = fixture("heldout"); m.cases.pop();
  assert.ok(assess(m, "case-0").findings.includes("missing-development-set"));
  m.cases.pop(); assert.ok(assess(m, "case-0").findings.some(x => x.includes("expected-360")));
  const recall = fixture("recall").m; recall.cases.pop();
  assert.ok(assess(recall, "case-0").findings.includes("recall-independent-count:99:minimum-100"));
});
test("distinct works may share a project; native, byte and equivalent works cannot inflate quotas", () => {
  for (const partition of ["heldout", "recall"] as const) {
    const { m } = fixture(partition);
    for (const item of m.cases.filter(x => x.partition === partition)) { item.families.people = ["shared-person"]; item.families.projects = ["shared-project"]; }
    assert.equal(assess(m, "case-0").readiness, "ready_for_authenticated_dispatch_checks");
    for (const join of ["native", "bytes", "equivalence"] as const) {
      const changed = structuredClone(m);
      if (join === "native") changed.sources[1]!.identity = structuredClone(changed.sources[0]!.identity);
      else if (join === "bytes") changed.sources[1]!.representationSha256 = changed.sources[0]!.representationSha256;
      else for (const item of changed.cases.slice(0, 2)) item.families.equivalences = ["same-original"];
      assert.equal(assess(changed, "case-0").readiness, "blocked", `${partition}:${join}`);
    }
  }
});
test("intermediate challenge cases cannot hide a development to heldout connection", () => {
  const { m, append } = fixture("heldout"); append("bridge", "challenge");
  m.cases.find(x => x.id === "development")!.families.people = ["left-person"];
  m.cases.find(x => x.id === "bridge")!.families.people = ["left-person", "right-person"];
  m.cases[0]!.families.people = ["right-person"];
  assert.ok(assess(m, "case-0").findings.some(x => x.startsWith("partition-leakage:")));
});
test("exposure of a connected case and unknown exposure history both block heldout", () => {
  const { m, append } = fixture("heldout"); append("bridge", "challenge");
  m.cases[0]!.families.projects = ["linked-project"];
  m.cases.find(x => x.id === "bridge")!.families.projects = ["linked-project"];
  m.history!.exposures = [{ caseIds: ["bridge"], at: instant, reason: "label-access", receipt: ref("exposure") }];
  assert.ok(assess(m, "case-0").findings.includes("heldout-family-already-exposed:bridge"));
  m.history!.exposures[0]!.caseIds = ["unknown-case"];
  assert.ok(assess(m, "case-0").findings.includes("unknown-exposure-case:unknown-case"));
});
test("old exposed bytes and a changed rubric cannot become fresh by changing IDs", () => {
  const { m } = fixture("heldout");
  m.history!.previous = [{ revision: { id: "previous-corpus", revision: 1 }, rubric: m.rubric,
    heldoutCaseIds: ["renamed-old-id"], heldoutFamilyKeys: [`bytes:${m.sources[0]!.representationSha256}`], exposedAt: instant }];
  assert.ok(assess(m, "case-0").findings.includes("fresh-holdout-required-after-exposure-or-rubric-change"));
  m.history!.previous[0]!.exposedAt = null; m.history!.previous[0]!.rubric = { id: "previous-rubric", revision: 1 };
  assert.ok(assess(m, "case-0").findings.includes("fresh-holdout-required-after-exposure-or-rubric-change"));
  m.history!.previous[0]!.revision = m.revision;
  assert.ok(assess(m, "case-0").findings.includes("revision-reused"));
  m.history = null; assert.ok(assess(m, "case-0").findings.includes("missing-authenticated-exposure-history"));
});
test("unknown subjects, invalid source support and audit cannot pass the structural gate", () => {
  const { m } = fixture();
  assert.equal(assess({}, "case-0").readiness, "blocked");
  assert.ok(assess(m, "absent").findings.includes("unknown-dispatch-case"));
  const changes = [
    (x: typeof m) => x.cases.push(structuredClone(x.cases[0]!)),
    (x: typeof m) => { x.cases[0]!.sourceIds = ["missing-source"]; },
    (x: typeof m) => { x.cases[0]!.families.origins = ["wrong-origin"]; },
    (x: typeof m) => { x.cases[0]!.appearances.push("crossref"); },
    (x: typeof m) => { x.cases[0]!.countyUnknown = false; },
    (x: typeof m) => { x.cases[0]!.claimMode = "creator-current"; },
    (x: typeof m) => { x.cases[0]!.partition = "audit"; },
  ];
  for (const change of changes) { const changed = structuredClone(m); change(changed); assert.equal(assess(changed, "case-0").readiness, "blocked"); }
});
