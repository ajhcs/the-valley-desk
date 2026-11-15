import { z } from "zod";
import { assessDiscoveryReferenceReadiness, discoveryEvaluationDigest } from "./discovery-evaluation";
import type { DiscoveryReceiptVerifier, ReceiptExpectation } from "./discovery-evaluation";

const Id = z.string().trim().min(1).max(4000);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Purpose = z.enum(["reviewer-authority", "evidence", "permission", "sampling", "family-review", "independent-annotation", "blinding", "adjudication", "selection", "history", "exposure"]);
/** Stored only after authentication by an independently operated, caller-owned store. */
export const DiscoveryAuthenticatedReceipt = z.object({
  schemaVersion: z.literal("discovery-authenticated-receipt-v1"), id: Id, authorityId: Id,
  purpose: Purpose, subjectId: Id, principalId: Id.nullable(), contentSha256: Hash,
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export type DiscoveryAuthenticatedReceipt = z.infer<typeof DiscoveryAuthenticatedReceipt>;
export const DiscoveryReceiptAuthority = z.object({ id: Id, purposes: z.array(Purpose).min(1).max(11),
  principals: z.array(Id.nullable()).min(1).max(100), validFrom: z.string().datetime(), validUntil: z.string().datetime(),
  revoked: z.boolean(),
}).strict();
export type DiscoveryReceiptAuthority = z.infer<typeof DiscoveryReceiptAuthority>;

/** A capability supplied by trusted application wiring, never constructed from uploaded JSON.
 * Implementations authenticate records (for example a controlled local registry or verified
 * signature store), and check current revocation on every lookup. Null means absent/revoked.
 * Untrusted intake MUST NOT implement or populate this store.
 */
export interface DiscoveryTrustedReceiptStore {
  readAuthenticated(id: string): Promise<unknown | null>;
  readAuthority(id: string): Promise<unknown | null>;
}

/** Offline resolver: hashes bind authenticated records, they do not authenticate uploads. */
export function createDiscoveryReferenceReceiptVerifier(store: DiscoveryTrustedReceiptStore,
  now: () => number = Date.now): DiscoveryReceiptVerifier {
  return async (inputReference, inputExpectation: ReceiptExpectation) => {
    const reference = z.object({ id: Id, sha256: Hash }).strict().parse(inputReference);
    const expectation = z.object({ purpose: Purpose, subjectId: Id, principalId: Id.nullable(), contentSha256: Hash }).strict().parse(inputExpectation);
    const record = DiscoveryAuthenticatedReceipt.parse(await store.readAuthenticated(reference.id));
    const authority = DiscoveryReceiptAuthority.parse(await store.readAuthority(record.authorityId));
    const at = now(), issued = Date.parse(record.issuedAt), expires = Date.parse(record.expiresAt);
    const start = Date.parse(authority.validFrom), end = Date.parse(authority.validUntil);
    if (!Number.isFinite(at) || authority.id !== record.authorityId || authority.revoked ||
      !(start <= issued && issued <= at && at < expires && expires <= end && start < end) ||
      !authority.purposes.includes(record.purpose) || !authority.principals.includes(record.principalId) ||
      record.id !== reference.id || record.purpose !== expectation.purpose || record.subjectId !== expectation.subjectId ||
      record.principalId !== expectation.principalId || record.contentSha256 !== expectation.contentSha256 ||
      await discoveryEvaluationDigest(record) !== reference.sha256) throw new Error("reference-receipt-unverified");
    return { status: "verified", receiptSha256: reference.sha256, purpose: record.purpose,
      subjectId: record.subjectId, principalId: record.principalId, contentSha256: record.contentSha256,
      method: "caller-owned-authenticated-record-store-v1" };
  };
}

/** No persistence, network calls, imported labels, or automatic freeze. */
export async function assessDiscoveryReferenceIntake(manifest: unknown, store: DiscoveryTrustedReceiptStore,
  now: () => number = Date.now) {
  const assessment = await assessDiscoveryReferenceReadiness(manifest, createDiscoveryReferenceReceiptVerifier(store, now));
  return { ...assessment, intakeBoundary: "caller-owned-authenticated-record-store-v1" as const,
    authenticationIntegration: "caller_owned_store_not_verified_by_this_adapter" as const,
    requiredExternalInputs: ["independently-authenticated-store-and-trust-configuration",
      "accountable-human-corpus-and-freeze-review", ...assessment.findings],
    freezeIssued: false as const };
}
