import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { discoveryEvaluationDigest } from "../src/ingest/discovery-evaluation";
import { createDiscoveryReferenceReceiptVerifier, assessDiscoveryReferenceIntake } from "../src/ingest/discovery-reference-receipts";
import type { DiscoveryAuthenticatedReceipt, DiscoveryReceiptAuthority } from "../src/ingest/discovery-reference-receipts";

// Fictitious authenticated-store capability. No real authority, permission or reviewer is created.
const now = () => Date.parse("2026-11-15T00:00:00Z");
async function setup() {
  let record: unknown = { schemaVersion: "discovery-authenticated-receipt-v1", id: "receipt-one", authorityId: "authority-one",
    purpose: "independent-annotation", subjectId: "case-one", principalId: "reviewer-one", contentSha256: "a".repeat(64),
    issuedAt: "2026-11-14T00:00:00Z", expiresAt: "2026-11-16T00:00:00Z" } satisfies DiscoveryAuthenticatedReceipt;
  let authority: unknown = { id: "authority-one", purposes: ["independent-annotation"], principals: ["reviewer-one"],
    validFrom: "2026-11-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z", revoked: false } satisfies DiscoveryReceiptAuthority;
  const reference = { id: "receipt-one", sha256: await discoveryEvaluationDigest(record) };
  const expectation = { purpose: "independent-annotation" as const, subjectId: "case-one", principalId: "reviewer-one", contentSha256: "a".repeat(64) };
  const store = { readAuthenticated: async () => record, readAuthority: async () => authority };
  return { reference, expectation, store, verify: createDiscoveryReferenceReceiptVerifier(store, now),
    record: (value: unknown) => { record = value; }, authority: (value: unknown) => { authority = value; },
    originalRecord: structuredClone(record) as DiscoveryAuthenticatedReceipt, originalAuthority: structuredClone(authority) as DiscoveryReceiptAuthority };
}
test("authenticated record resolves with all bindings; expectation stays untouched", async () => {
  const x = await setup(), before = structuredClone(x.expectation);
  assert.equal((await x.verify(x.reference, x.expectation) as { status: string }).status, "verified");
  assert.deepEqual(x.expectation, before);
});
test("a forged upload with matching digest cannot establish store membership or authority", async () => {
  const x = await setup();
  x.record(null); // An attacker can upload the original record and its hash; the trusted registry has no entry.
  await assert.rejects(() => x.verify(x.reference, x.expectation));
  x.record(x.originalRecord); x.authority(null);
  await assert.rejects(() => x.verify(x.reference, x.expectation));
});
for (const field of ["purpose", "principalId", "subjectId", "contentSha256"] as const) test(`rejects wrong ${field} even with a recomputed digest`, async () => {
  const x = await setup();
  const changed = { ...x.originalRecord, [field]: field === "purpose" ? "permission" : field === "contentSha256" ? "b".repeat(64) : "attacker" };
  x.record(changed);
  const sha256 = await discoveryEvaluationDigest(changed);
  await assert.rejects(() => x.verify({ ...x.reference, sha256 }, x.expectation));
});
for (const variation of ["expired", "future", "authority-expired", "revoked", "scope", "principal-scope", "identity"] as const) test(`rejects ${variation} authenticated records`, async () => {
  const x = await setup(), record = { ...x.originalRecord }, authority = { ...x.originalAuthority };
  if (variation === "expired") record.expiresAt = "2026-11-15T00:00:00Z";
  if (variation === "future") record.issuedAt = "2026-11-15T00:00:01Z";
  if (variation === "authority-expired") authority.validUntil = "2026-11-14T00:00:00Z";
  if (variation === "revoked") authority.revoked = true;
  if (variation === "scope") authority.purposes = ["permission"];
  if (variation === "principal-scope") authority.principals = [null];
  if (variation === "identity") authority.id = "another-authority";
  x.record(record); x.authority(authority);
  const sha256 = await discoveryEvaluationDigest(record);
  await assert.rejects(() => x.verify({ ...x.reference, sha256 }, x.expectation));
});
test("revocation/config changes are checked on every resolution", async () => {
  const x = await setup(); await x.verify(x.reference, x.expectation);
  x.authority({ ...x.originalAuthority, revoked: true });
  await assert.rejects(() => x.verify(x.reference, x.expectation));
  x.authority(x.originalAuthority); x.record(null);
  await assert.rejects(() => x.verify(x.reference, x.expectation));
});
test("hash substitution and self asserted authentication fields fail closed", async () => {
  const x = await setup();
  await assert.rejects(() => x.verify({ ...x.reference, sha256: "f".repeat(64) }, x.expectation));
  x.record({ ...x.originalRecord, authenticated: true });
  await assert.rejects(() => x.verify(x.reference, x.expectation));
});
test("actual empty inventory yields actionable blockers and never freezes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../docs/discovery/reference-manifest.json", import.meta.url), "utf8"));
  const report = await assessDiscoveryReferenceIntake(manifest, { readAuthenticated: async () => null, readAuthority: async () => null }, now);
  assert.equal(report.status, "not_frozen"); assert.equal(report.readiness, "blocked"); assert.equal(report.freezeIssued, false);
  assert.ok(report.requiredExternalInputs.includes("two-independent-reviewers-required"));
  assert.ok(report.requiredExternalInputs.includes("missing-heldout-sampling"));
});
test("caller cannot mutate reference or expectation during asynchronous store lookup", async () => {
  const x = await setup();
  const verifier = createDiscoveryReferenceReceiptVerifier({
    readAuthenticated: async () => {
      x.reference.sha256 = "f".repeat(64);
      x.expectation.subjectId = "changed-during-lookup";
      return x.originalRecord;
    }, readAuthority: async () => x.originalAuthority,
  }, now);
  assert.equal((await verifier(x.reference, x.expectation) as { status: string }).status, "verified");
});
