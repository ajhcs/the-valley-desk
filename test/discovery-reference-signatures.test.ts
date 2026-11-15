import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDiscoverySignedReceiptStore, discoveryReferenceSigningBytes, assessDiscoverySignedReferenceIntake } from "../src/ingest/discovery-reference-signatures";
import { createDiscoveryReferenceReceiptVerifier } from "../src/ingest/discovery-reference-receipts";
import { discoveryEvaluationDigest } from "../src/ingest/discovery-evaluation";
const hex = (value: ArrayBuffer) => Buffer.from(value).toString("hex");
const from = "2026-11-01T00:00:00Z", until = "2026-12-01T00:00:00Z";
const now = () => Date.parse("2026-11-15T00:00:00Z");
// Ephemeral synthetic signers only. Never persisted or enrolled as actual human authority.
async function fixture() {
  const issuer = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const signer = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const key = async (id: string, pair: CryptoKeyPair, roles: string[]) => ({ id, algorithm: "Ed25519", spkiHex: hex(await crypto.subtle.exportKey("spki", pair.publicKey)), roles, authorityIds: ["authority"], validFrom: from, validUntil: until, revoked: false });
  const policy = { revision: "synthetic-policy", validFrom: from, validUntil: until,
    keys: [await key("issuer", issuer, ["authority"]), await key("signer", signer, ["receipt"])], revokedReceiptIds: [] as string[], revokedAuthorityIds: [] as string[] };
  const authority = { id: "authority", purposes: ["permission"], principals: [null], validFrom: from, validUntil: until, revoked: false };
  const record = { schemaVersion: "discovery-authenticated-receipt-v1", id: "receipt", authorityId: "authority", purpose: "permission", subjectId: "source", principalId: null, contentSha256: "a".repeat(64), issuedAt: from, expiresAt: until };
  const sign = async (domain: string, keyId: string, payload: unknown, pair: CryptoKeyPair) => ({ domain, algorithm: "Ed25519", keyId, payload,
    signatureHex: hex(await crypto.subtle.sign("Ed25519", pair.privateKey, await discoveryReferenceSigningBytes(domain, keyId, payload))) });
  const receipts = [await sign("discovery-reference-receipt-signature-v1", "signer", record, signer)];
  const authorities = [await sign("discovery-reference-authority-signature-v1", "issuer", { schemaVersion: "discovery-authority-statement-v1", issuedAt: from, expiresAt: until, authority }, issuer)];
  return { policy, bundle: { receipts, authorities }, record, sign, signer, issuer };
}
test("real cryptographic verification plugs into existing expectation checker", async () => {
  const x = await fixture(), store = await createDiscoverySignedReceiptStore(x.policy, x.bundle, now);
  const verify = createDiscoveryReferenceReceiptVerifier(store, now);
  const result = await verify({ id: "receipt", sha256: await discoveryEvaluationDigest(x.record) }, { purpose: "permission", subjectId: "source", principalId: null, contentSha256: "a".repeat(64) });
  assert.equal((result as { status: string }).status, "verified");
});
for (const attack of ["tamper", "signature", "key-id", "wrong-key", "unsigned-authority", "authority-tamper", "role", "scope", "revoked-key", "revoked-receipt", "revoked-authority", "stale-policy"] as const) test(`rejects ${attack}`, async () => {
  const x = await fixture();
  if (attack === "tamper") (x.bundle.receipts[0]!.payload as typeof x.record).subjectId = "forged";
  if (attack === "signature") x.bundle.receipts[0]!.signatureHex = "00".repeat(64);
  if (attack === "key-id") x.bundle.receipts[0]!.keyId = "not-enrolled";
  if (attack === "wrong-key") x.bundle.receipts[0] = await x.sign("discovery-reference-receipt-signature-v1", "signer", x.record, x.issuer);
  if (attack === "unsigned-authority") x.bundle.authorities = [];
  if (attack === "authority-tamper") (x.bundle.authorities[0]!.payload as { authority: { principals: unknown[] } }).authority.principals = ["attacker"];
  if (attack === "role") x.policy.keys[1]!.roles = ["authority"];
  if (attack === "scope") x.policy.keys[1]!.authorityIds = ["another-authority"];
  if (attack === "revoked-key") x.policy.keys[1]!.revoked = true;
  if (attack === "revoked-receipt") x.policy.revokedReceiptIds = ["receipt"];
  if (attack === "revoked-authority") x.policy.revokedAuthorityIds = ["authority"];
  if (attack === "stale-policy") x.policy.validUntil = "2026-11-15T00:00:00Z";
  const store = await createDiscoverySignedReceiptStore(x.policy, x.bundle, now);
  assert.equal(await store.readAuthenticated("receipt"), null);
});
test("rejects algorithm/domain confusion, key self-enrollment, duplicate IDs and bounds", async () => {
  const x = await fixture();
  for (const bundle of [
    { ...x.bundle, receipts: [{ ...x.bundle.receipts[0], algorithm: "ECDSA" }] },
    { ...x.bundle, receipts: [{ ...x.bundle.receipts[0], domain: "discovery-reference-authority-signature-v1" }] },
    { ...x.bundle, keys: x.policy.keys },
    { ...x.bundle, receipts: [...x.bundle.receipts, ...x.bundle.receipts] },
    { ...x.bundle, authorities: Array(1001).fill(x.bundle.authorities[0]) },
  ]) await assert.rejects(() => createDiscoverySignedReceiptStore(x.policy, bundle, now));
  await assert.rejects(() => createDiscoverySignedReceiptStore({ ...x.policy, keys: [...x.policy.keys, x.policy.keys[0]] }, x.bundle, now));
});
test("snapshots inputs before asynchronous import and returns detached values", async () => {
  const x = await fixture(), pending = createDiscoverySignedReceiptStore(x.policy, x.bundle, now);
  x.policy.keys[1]!.revoked = true;
  (x.bundle.receipts[0]!.payload as typeof x.record).subjectId = "mutated";
  const store = await pending, value = await store.readAuthenticated("receipt") as typeof x.record;
  assert.equal(value.subjectId, "source"); value.subjectId = "mutated-return";
  assert.equal((await store.readAuthenticated("receipt") as typeof x.record).subjectId, "source");
});
test("expiry during asynchronous crypto fails closed", async () => {
  const x = await fixture(); let calls = 0;
  const store = await createDiscoverySignedReceiptStore(x.policy, x.bundle, () => ++calls === 1 ? now() : Date.parse(until));
  assert.equal(await store.readAuthenticated("receipt"), null);
});
test("offline actual inventory stays blocked without enrolled keys or records", async () => {
  const manifest = JSON.parse(await readFile(new URL("../docs/discovery/reference-manifest.json", import.meta.url), "utf8"));
  const report = await assessDiscoverySignedReferenceIntake(manifest, { revision: "unenrolled-local-report", validFrom: from, validUntil: until, keys: [], revokedReceiptIds: [], revokedAuthorityIds: [] }, { receipts: [], authorities: [] }, now);
  assert.equal(report.status, "not_frozen"); assert.equal(report.readiness, "blocked"); assert.equal(report.freezeIssued, false);
  assert.ok(report.findings.includes("two-independent-reviewers-required"));
});
test("signed authority grant window constrains receipt validity", async () => {
  const x = await fixture();
  const payload = { schemaVersion: "discovery-authority-statement-v1", issuedAt: from, expiresAt: "2026-11-20T00:00:00Z",
    authority: { id: "authority", purposes: ["permission"], principals: [null], validFrom: from, validUntil: until, revoked: false } };
  x.bundle.authorities = [await x.sign("discovery-reference-authority-signature-v1", "issuer", payload, x.issuer)];
  const store = await createDiscoverySignedReceiptStore(x.policy, x.bundle, now);
  assert.equal(await store.readAuthenticated("receipt"), null);
});
test("preflight rejects oversized UTF-8 policy/bundle, cycles and accessors without evaluating them", async () => {
  const x = await fixture();
  await assert.rejects(() => createDiscoverySignedReceiptStore({ ...x.policy, revision: "é".repeat(140000) }, x.bundle, now), /signed-intake-size/);
  await assert.rejects(() => createDiscoverySignedReceiptStore(x.policy, { receipts: ["é".repeat(8100000)], authorities: [] }, now), /signed-intake-size/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  await assert.rejects(() => createDiscoverySignedReceiptStore(x.policy, cyclic, now), /signed-intake-shape/);
  let evaluated = false;
  const accessor = Object.defineProperty({}, "receipts", { enumerable: true, get() { evaluated = true; throw new Error("getter ran"); } });
  await assert.rejects(() => createDiscoverySignedReceiptStore(x.policy, accessor, now), /signed-intake-shape/);
  assert.equal(evaluated, false);
  await assert.rejects(() => createDiscoverySignedReceiptStore(x.policy, new Date(), now), /signed-intake-shape/);
});
