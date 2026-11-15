import { z } from "zod";
import { DiscoveryAuthenticatedReceipt as Receipt, DiscoveryReceiptAuthority as Authority, assessDiscoveryReferenceIntake } from "./discovery-reference-receipts";
import type { DiscoveryTrustedReceiptStore } from "./discovery-reference-receipts";
import { discoveryEvaluationDigest } from "./discovery-evaluation";

const Id = z.string().min(1).max(200);
const Instant = z.string().datetime();
const Hex = z.string().regex(/^[a-f0-9]+$/);
const Roles = z.enum(["receipt", "authority"]);
const Pin = z.object({ id: Id, algorithm: z.literal("Ed25519"), spkiHex: Hex.length(88),
  roles: z.array(Roles).min(1).max(2), authorityIds: z.array(Id).min(1).max(100),
  validFrom: Instant, validUntil: Instant, revoked: z.boolean(),
}).strict();
const Policy = z.object({ revision: Id, validFrom: Instant, validUntil: Instant,
  keys: z.array(Pin).max(100), revokedReceiptIds: z.array(Id).max(10000), revokedAuthorityIds: z.array(Id).max(1000),
}).strict();
export type DiscoverySignatureTrustPolicy = z.infer<typeof Policy>;
const AuthorityStatement = z.object({ schemaVersion: z.literal("discovery-authority-statement-v1"),
  issuedAt: Instant, expiresAt: Instant, authority: Authority,
}).strict();
const base = { algorithm: z.literal("Ed25519"), keyId: Id, signatureHex: Hex.length(128) };
const ReceiptEnvelope = z.object({ ...base, domain: z.literal("discovery-reference-receipt-signature-v1"), payload: Receipt }).strict();
const AuthorityEnvelope = z.object({ ...base, domain: z.literal("discovery-reference-authority-signature-v1"), payload: AuthorityStatement }).strict();
const Bundle = z.object({ receipts: z.array(ReceiptEnvelope).max(20000), authorities: z.array(AuthorityEnvelope).max(1000) }).strict();
export type DiscoverySignedReferenceBundle = z.infer<typeof Bundle>;
const unhex = (value: string) => Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
const unique = (values: string[]) => new Set(values).size === values.length;
/** Signing preimage binds envelope domain, exact key identifier and canonical payload digest. */
export async function discoveryReferenceSigningBytes(domain: string, keyId: string, payload: unknown) {
  if (!["discovery-reference-receipt-signature-v1", "discovery-reference-authority-signature-v1"].includes(domain)) throw new Error("signature-domain");
  Id.parse(keyId);
  return new TextEncoder().encode(JSON.stringify([domain, "Ed25519", keyId, await discoveryEvaluationDigest(payload)]));
}

/** Bound object intake before Zod clones it; reject executable/non-JSON object shapes. */
function boundedJsonInput(input: unknown, maxBytes: number) {
  let bytes = 0, nodes = 0;
  const active = new Set<object>();
  const charge = (value: string) => {
    if (value.length > maxBytes) throw new Error("signed-intake-size");
    bytes += new TextEncoder().encode(value).byteLength;
    if (bytes > maxBytes) throw new Error("signed-intake-size");
  };
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 500000 || depth > 12) throw new Error("signed-intake-shape");
    if (value === null || typeof value === "boolean") { charge(String(value)); return; }
    if (typeof value === "string") {
      if (value.length > maxBytes) throw new Error("signed-intake-size");
      charge(JSON.stringify(value)); return;
    }
    if (typeof value !== "object" || active.has(value)) throw new Error("signed-intake-shape");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("signed-intake-shape");
    if (array && Object.getPrototypeOf(value) !== Array.prototype) throw new Error("signed-intake-shape");
    active.add(value); charge(array ? "[]" : "{}");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 20001) throw new Error("signed-intake-shape");
    if (array && keys.length !== value.length + 1) throw new Error("signed-intake-shape");
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") throw new Error("signed-intake-shape");
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!property.enumerable || !("value" in property)) throw new Error("signed-intake-shape");
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error("signed-intake-shape");
      if (!array) charge(JSON.stringify(key) + ":");
      charge(","); visit(property.value, depth + 1);
    }
    active.delete(value);
  };
  visit(input, 0);
}

/** Pins are trusted operator input, separate from untrusted signed records. No enrollment,
 * private keys, networking or persistence. Revocation policy is a bounded-lived snapshot;
 * instantiate a new store when it changes. Clock and policy provenance remain trusted inputs.
 */
export async function createDiscoverySignedReceiptStore(trustedPolicy: unknown, untrustedBundle: unknown,
  now: () => number = Date.now): Promise<DiscoveryTrustedReceiptStore> {
  boundedJsonInput(trustedPolicy, 262144);
  boundedJsonInput(untrustedBundle, 16000000);
  const policy = Policy.parse(trustedPolicy), bundle = Bundle.parse(untrustedBundle);
  if (!unique(policy.keys.map(x => x.id)) ||
    !unique(policy.keys.map(x => x.spkiHex)) || !unique(bundle.receipts.map(x => x.payload.id)) ||
    !unique(bundle.authorities.map(x => x.payload.authority.id))) throw new Error("ambiguous-or-oversized-signed-intake");
  const pins = new Map(policy.keys.map(pin => [pin.id, pin]));
  const keys = new Map<string, CryptoKey>();
  for (const pin of policy.keys) {
    if (!unique(pin.roles) || !unique(pin.authorityIds)) throw new Error("duplicate-pin-scope");
    keys.set(pin.id, await crypto.subtle.importKey("spki", unhex(pin.spkiHex), { name: "Ed25519" }, false, ["verify"]));
  }
  const inWindow = (start: string, end: string, at: number) => Number.isFinite(at) && Date.parse(start) <= at && at < Date.parse(end);
  const verify = async (envelope: z.infer<typeof ReceiptEnvelope> | z.infer<typeof AuthorityEnvelope>, role: z.infer<typeof Roles>, authorityId: string,
    issuedAt: string, expiresAt: string) => {
    const at = now(), pin = pins.get(envelope.keyId), key = keys.get(envelope.keyId);
    if (!pin || !key || pin.revoked || !pin.roles.includes(role) || !pin.authorityIds.includes(authorityId) ||
      policy.revokedAuthorityIds.includes(authorityId) || !inWindow(policy.validFrom, policy.validUntil, at) ||
      !inWindow(pin.validFrom, pin.validUntil, at) || !inWindow(issuedAt, expiresAt, at) ||
      Date.parse(issuedAt) < Date.parse(pin.validFrom) || Date.parse(expiresAt) > Date.parse(pin.validUntil)) return false;
    const valid = await crypto.subtle.verify("Ed25519", key, unhex(envelope.signatureHex),
      await discoveryReferenceSigningBytes(envelope.domain, envelope.keyId, envelope.payload));
    const completedAt = now();
    return valid && completedAt >= at && inWindow(policy.validFrom, policy.validUntil, completedAt) &&
      inWindow(pin.validFrom, pin.validUntil, completedAt) && inWindow(issuedAt, expiresAt, completedAt);
  };
  const authorities = new Map(bundle.authorities.map(x => [x.payload.authority.id, x]));
  const receipts = new Map(bundle.receipts.map(x => [x.payload.id, x]));
  const readAuthority = async (id: string) => {
    const envelope = authorities.get(id);
    if (!envelope || !await verify(envelope, "authority", id, envelope.payload.issuedAt, envelope.payload.expiresAt)) return null;
    const authority = envelope.payload.authority;
    if (authority.revoked || !inWindow(authority.validFrom, authority.validUntil, now()) ||
      Date.parse(envelope.payload.issuedAt) < Date.parse(authority.validFrom) ||
      Date.parse(envelope.payload.expiresAt) > Date.parse(authority.validUntil)) return null;
    return { ...structuredClone(authority), validFrom: envelope.payload.issuedAt, validUntil: envelope.payload.expiresAt };
  };
  return {
    readAuthority,
    readAuthenticated: async (id: string) => {
      const envelope = receipts.get(id);
      if (!envelope || policy.revokedReceiptIds.includes(id)) return null;
      const record = envelope.payload, authority = await readAuthority(record.authorityId);
      if (!authority || !authority.purposes.includes(record.purpose) || !authority.principals.includes(record.principalId) ||
        Date.parse(record.issuedAt) < Date.parse(authority.validFrom) || Date.parse(record.expiresAt) > Date.parse(authority.validUntil) ||
        !await verify(envelope, "receipt", record.authorityId, record.issuedAt, record.expiresAt)) return null;
      if (!await readAuthority(record.authorityId) || !inWindow(record.issuedAt, record.expiresAt, now())) return null;
      return structuredClone(record);
    },
  };
}

export async function assessDiscoverySignedReferenceIntake(manifest: unknown, trustedPolicy: unknown, untrustedBundle: unknown,
  now: () => number = Date.now) {
  try {
    const store = await createDiscoverySignedReceiptStore(trustedPolicy, untrustedBundle, now);
    const report = await assessDiscoveryReferenceIntake(manifest, store, now);
    return { ...report, signatureBoundary: "offline-pinned-ed25519-v1" as const,
      authenticationIntegration: "offline_signature_verification_under_supplied_operator_pins" as const,
      signatureScope: "Cryptographic record integrity under supplied operator pins; no human authority or source truth established." };
  } catch {
    return { status: "not_frozen" as const, readiness: "blocked" as const, freezeIssued: false as const,
      findings: ["invalid-signed-intake-or-trust-policy"], requiredExternalInputs: ["valid-separately-enrolled-trust-policy-and-signed-records"] };
  }
}
