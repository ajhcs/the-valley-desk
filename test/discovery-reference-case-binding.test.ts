import assert from "node:assert/strict";
import test from "node:test";
import { DISCOVERY_PROVIDERS } from "../src/content/discovery-schema";
import { DiscoveryReferenceManifest, assessDiscoveryReferenceReadiness, discoveryEvaluationDigest } from "../src/ingest/discovery-evaluation";
import { createDiscoveryReferenceReceiptVerifier } from "../src/ingest/discovery-reference-receipts";
import { createDiscoverySignedReceiptStore, discoveryReferenceSigningBytes } from "../src/ingest/discovery-reference-signatures";
import type { DiscoveryReferenceManifest as Manifest } from "../src/ingest/discovery-evaluation";

// Entire fixture and signing identity are fictional and ephemeral.
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

const start = "2026-01-01T00:00:00Z", end = "2030-01-01T00:00:00Z";
const fake = async (r: any, e: any) => ({ status: "verified", receiptSha256: r.sha256, ...e, method: "fictional-test-only" });
async function attest(m: Manifest, staleSelection?: any) {
  const refs: any[] = [];
  const walk = (x: any): void => { if (!x || typeof x !== "object") return; if (typeof x.id === "string" && typeof x.sha256 === "string") refs.push(x); else Object.values(x).forEach(walk); };
  walk(m);
  const records = new Map<string, any>();
  for (let round = 0; round < 8; round++) {
    records.clear();
    await assessDiscoveryReferenceReadiness(m, async (r, e) => {
      records.set(r.id, { schemaVersion: "discovery-authenticated-receipt-v1", id: r.id, authorityId: "fictional-authority", ...e, issuedAt: start, expiresAt: end });
      return fake(r, e);
    });
    for (const r of refs) if (records.has(r.id)) r.sha256 = await discoveryEvaluationDigest(records.get(r.id));
  }
  if (staleSelection) {
    records.set(staleSelection.id, staleSelection);
    const ref = refs.find(r => r.id === staleSelection.id);
    assert.ok(ref); ref.sha256 = await discoveryEvaluationDigest(staleSelection);
  }
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const hex = (x: ArrayBuffer) => Buffer.from(x).toString("hex");
  const sign = async (domain: string, payload: any) => ({ domain, algorithm: "Ed25519", keyId: "fictional-key", payload,
    signatureHex: hex(await crypto.subtle.sign("Ed25519", pair.privateKey, await discoveryReferenceSigningBytes(domain, "fictional-key", payload))) });
  const authority = { schemaVersion: "discovery-authority-statement-v1", issuedAt: start, expiresAt: end,
    authority: { id: "fictional-authority", purposes: ["reviewer-authority", "evidence", "permission", "sampling", "family-review", "independent-annotation", "blinding", "adjudication", "selection", "history", "exposure"],
      principals: [null, "reviewer-a", "reviewer-b"], validFrom: start, validUntil: end, revoked: false } };
  const bundle = { receipts: await Promise.all([...records.values()].map(r => sign("discovery-reference-receipt-signature-v1", r))),
    authorities: [await sign("discovery-reference-authority-signature-v1", authority)] };
  const policy = { revision: "fictional", validFrom: start, validUntil: end,
    keys: [{ id: "fictional-key", algorithm: "Ed25519", spkiHex: hex(await crypto.subtle.exportKey("spki", pair.publicKey)), roles: ["receipt", "authority"], authorityIds: ["fictional-authority"], validFrom: start, validUntil: end, revoked: false }], revokedReceiptIds: [], revokedAuthorityIds: [] };
  const verify = createDiscoveryReferenceReceiptVerifier(await createDiscoverySignedReceiptStore(policy, bundle, () => Date.parse("2026-11-15T00:00:00Z")), () => Date.parse("2026-11-15T00:00:00Z"));
  return { verify, records };
}

test("signed case selection binds all descriptors and evaluation context; re-attestation restores review readiness", async () => {
  const m = fixture(), { verify, records } = await attest(m);
  const baseline = await assessDiscoveryReferenceReadiness(m, verify);
  assert.equal(baseline.readiness, "ready_for_accountable_freeze_review");
  assert.equal(baseline.status, "not_frozen");
  const target = m.cases[1]!;
  const checks: [string, (x: Manifest) => void][] = [
    ["county", x => { x.cases[1]!.counties = ["PA:Bucks"]; }],
    ["unknown county", x => { x.cases[1]!.countyUnknown = true; }],
    ["challenge", x => { x.cases[1]!.challenges = ["mirror"]; }],
    ["appearances", x => { x.cases[1]!.appearances.push("forum"); }],
    ["subject", x => { x.cases[1]!.subject.id = "changed-subject"; }],
    ["claim mode", x => { x.cases[1]!.claimMode = "identity-relationship"; }],
    ["partition", x => { x.cases[1]!.partition = "challenge"; }],
    ["primary route", x => { x.cases[1]!.primaryRoute = "forum"; }],
    ["family", x => { x.cases[1]!.families.people.push("changed-person"); }],
    ["sources", x => { x.cases[1]!.sourceIds.push(x.sources[2]!.id); }],
    ["manifest revision", x => { x.revision.revision++; }],
    ["rubric", x => { x.rubric.revision++; }],
    ["policy", x => { x.policy.revision++; }],
    ["sampling", x => { x.sampling.heldout!.method += " changed"; }],
    ["source version", x => { x.sources[1]!.revision.revision++; }],
    ["source identity", x => { x.sources[1]!.identity.nativeId = "changed-native"; }],
    ["source origin", x => { x.sources[1]!.originFamilyId = "changed-origin"; }],
    ["source observation time", x => { x.sources[1]!.observedAt = "2026-10-11T00:00:00Z"; }],
    ["missing referenced source", x => { x.sources = x.sources.filter(source => source.id !== x.cases[1]!.sourceIds[0]); }],
    ["source representation", x => { x.sources[1]!.representationSha256 = hash(999999); }],
  ];
  for (const [name, mutate] of checks) {
    const changed = structuredClone(m); mutate(changed);
    // Only the selected receipt is authenticated in this focused mutation check;
    // the full baseline and final re-attestation use the actual store for every receipt.
    const result = await assessDiscoveryReferenceReadiness(changed, (r, e) => e.purpose === "selection" && e.subjectId === target.id ? verify(r, e) : fake(r, e));
    assert.ok(result.findings.includes(`unverified:selection:${target.id}`), `${name}: ${result.findings.slice(0, 5)}`);
    assert.equal(result.readiness, "blocked");
  }
  // Reissue evidence and permission records for a changed source while retaining
  // the old signed selection statement: authentic source replacement is not selection review.
  const replaced = structuredClone(m); replaced.sources[1]!.revision.revision++;
  const oldSelection = records.get(target.selectionReceipt.id);
  const separatelyReissued = await attest(replaced, oldSelection);
  const sourceResult = await assessDiscoveryReferenceReadiness(replaced, separatelyReissued.verify);
  assert.deepEqual(sourceResult.findings, [`unverified:selection:${target.id}`]);
  assert.equal(sourceResult.readiness, "blocked");
  // A legitimately signed legacy partial payload has no compatibility fallback.
  const legacy = structuredClone(m);
  const oldPayload = { revision: legacy.revision, partition: target.partition, claimMode: target.claimMode,
    primaryRoute: target.primaryRoute, sampling: legacy.sampling.heldout };
  const oldRecord = { ...oldSelection, contentSha256: await discoveryEvaluationDigest(oldPayload) };
  const legacyStore = await attest(legacy, oldRecord);
  const legacyResult = await assessDiscoveryReferenceReadiness(legacy, legacyStore.verify);
  assert.deepEqual(legacyResult.findings, [`unverified:selection:${target.id}`]);
  assert.equal(legacyResult.readiness, "blocked");
  const changed = structuredClone(m); changed.cases[1]!.countyUnknown = true;
  const replacement = await attest(changed);
  const final = await assessDiscoveryReferenceReadiness(changed, replacement.verify);
  assert.equal(final.readiness, "ready_for_accountable_freeze_review"); assert.equal(final.status, "not_frozen");
});
