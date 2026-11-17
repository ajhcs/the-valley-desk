import { z } from "zod";
import { DiscoveryId as Id, DiscoverySubject } from "../content/discovery-schema";
import { DiscoveryReferenceManifest, DiscoveryIndependentAnnotation, discoveryReferenceReviewContext,
  discoveryEvaluationDigest, discoveryFamilyKeys, assessDiscoveryReferenceDispatchStructure } from "./discovery-evaluation";
import type { DiscoveryReceiptVerifier, ReceiptExpectation } from "./discovery-evaluation";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().trim().min(1).max(4000);
const DraftAnnotation = DiscoveryIndependentAnnotation.omit({ receipt: true, blindedBatch: true });
export const DiscoveryHumanPreparationInput = z.object({ groups: z.array(z.object({
  taskId: Id, kind: z.enum(["project", "organization-background"]),
  materials: z.array(z.object({ locator: Text, bodySha256: Hash.nullable() }).strict()).min(1).max(128),
}).strict()).min(1).max(1000) }).strict();
const blankLabels = { overall: null, identity: null, professionalBasis: null, relevance: null,
  currentPresence: null, regionalCreation: null, creatorRole: null, rights: null };
const boundary = { status: "not_frozen" as const, freezeIssued: false as const, packageAccepted: false as const };
/** Development source organization only. No draft ID is a case, family, principal or receipt. */
export function prepareDiscoveryHumanReview(input: unknown) {
  const request = DiscoveryHumanPreparationInput.parse(input);
  if (new Set(request.groups.map(x => x.taskId)).size !== request.groups.length) throw new Error("duplicate-task");
  return { schemaVersion: "discovery-human-preparation-v1", ...boundary, readiness: "blocked",
    dispatchPermitted: false, developmentExposed: true, referenceCaseCredit: 0,
    blockers: ["steward-reviewed-strict-case-and-context", "authenticated-source-evidence-and-permitted-uses",
      "authenticated-family-and-selection", "independently-enrolled-human-reviewer-authority"],
    tasks: request.groups.map(group => ({ ...group, developmentExposed: true, strictCaseId: null, contextSha256: null,
      reviewerSlots: [{ reviewerId: null, labels: { ...blankLabels } }, { reviewerId: null, labels: { ...blankLabels } }], adjudication: null })),
  };
}
const SourceBytes = z.object({ sourceId: Id, bytesBase64: z.string().max(1400000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict();
const SourceDescriptor = DiscoveryReferenceManifest.shape.sources.element.omit({ evidence: true, permission: true, originFamilyId: true });
const PacketOriginal = SourceBytes.extend({ source: SourceDescriptor }).strict();
const Instructions = "Review the permitted originals independently using the complete authoritative rubric supplied separately for the specified revision. Overall uses eligible/ineligible/ambiguous for the neutral claim. Each dimension uses supported/refuted/ambiguous: identity (subject/account identity), professionalBasis (technical professional basis), relevance (health-technology relevance), currentPresence (current professional presence), regionalCreation (regional contribution at creation), creatorRole (actual creation contribution), and rights (permitted material uses). Missing facts remain ambiguous. Record rationale, confidence and exact sourceIds. Do not inspect product predictions, peer annotations or adjudication. Return does not issue source truth or a freeze.";
const Packet = z.object({ schemaVersion: z.literal("discovery-human-packet-v1"), caseId: Id, contextSha256: Hash,
  reviewerId: Id, rubric: DiscoveryReferenceManifest.shape.rubric,
  claim: z.object({ mode: z.enum(["creator-current", "creator-historical", "work-regional-at-creation", "identity-relationship"]),
    subject: DiscoverySubject }).strict(),
  instructions: z.literal(Instructions), originals: z.array(PacketOriginal).min(1).max(128),
  labels: z.object(Object.fromEntries(Object.keys(blankLabels).map(key => [key, z.null()]))).strict(),
}).strict();
export const DiscoveryHumanUnsignedReturn = z.object({ schemaVersion: z.literal("discovery-human-return-v1"),
  packetSha256: Hash, contextSha256: Hash, annotation: DraftAnnotation }).strict();
export const DiscoveryHumanSignedReturn = z.object({ schemaVersion: z.literal("discovery-human-return-v1"),
  packetSha256: Hash, contextSha256: Hash, annotation: DiscoveryIndependentAnnotation }).strict();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const duplicate = (ids: string[]) => new Set(ids).size !== ids.length;
async function checked(verify: DiscoveryReceiptVerifier, reference: { id: string; sha256: string }, purpose: ReceiptExpectation["purpose"],
  subjectId: string, payload: unknown, principalId: string | null = null) {
  const expectation = { purpose, subjectId, contentSha256: await discoveryEvaluationDigest(payload), principalId };
  const result = await verify(reference, expectation) as Record<string, unknown> | null;
  if (!result || result.status !== "verified" || result.receiptSha256 !== reference.sha256 ||
    Object.entries(expectation).some(([key, value]) => result[key] !== value)) throw new Error("unverified-human-prerequisite");
}
/** Explicit capability only: callers must use the existing authenticated/signed receipt store. */
async function dispatchContext(input: unknown, caseId: string, reviewerId: string, verify: DiscoveryReceiptVerifier) {
  const manifest = DiscoveryReferenceManifest.parse(input);
  if (assessDiscoveryReferenceDispatchStructure(manifest, caseId).readiness !== "ready_for_authenticated_dispatch_checks") throw new Error("invalid-human-dispatch-structure");
  if (typeof verify !== "function" || duplicate(manifest.cases.map(x => x.id)) || duplicate(manifest.sources.map(x => x.id)) ||
    duplicate(manifest.reviewers.map(x => x.id))) throw new Error("invalid-human-context");
  const item = manifest.cases.find(x => x.id === caseId), reviewer = manifest.reviewers.find(x => x.id === reviewerId);
  if (!item || !reviewer || manifest.reviewers.length < 2 || item.annotations.some(x => x.reviewerId === reviewerId) || item.adjudication !== null ||
    duplicate(item.sourceIds) || duplicate(item.appearances) || duplicate(item.counties) || duplicate(discoveryFamilyKeys(item.families)) ||
    !item.appearances.includes(item.primaryRoute) || (!item.countyUnknown && item.counties.length === 0) ||
    (item.claimMode.startsWith("creator-") && !["person", "organization"].includes(item.subject.kind)) ||
    (item.claimMode === "work-regional-at-creation" && !["project", "artifact"].includes(item.subject.kind))) throw new Error("invalid-human-context");
  // Selection attests the exact context, including original source descriptors and sampling.
  const context = discoveryReferenceReviewContext(manifest, item), contextSha256 = await discoveryEvaluationDigest(context);
  await checked(verify, reviewer.authority, "reviewer-authority", reviewerId, { reviewerId, policy: manifest.policy }, reviewerId);
  await checked(verify, item.familyReview, "family-review", item.id, { subject: item.subject, families: item.families, sourceIds: item.sourceIds });
  await checked(verify, item.selectionReceipt, "selection", item.id, context);
  const sources = item.sourceIds.map(id => manifest.sources.find(x => x.id === id));
  const routes = new Set(sources.map(x => x?.identity.provider));
  if (item.appearances.some(route => !routes.has(route))) throw new Error("unsupported-human-route");
  for (const source of sources) {
    if (!source || !item.families.origins.includes(source.originFamilyId)) throw new Error("missing-human-source");
    const { evidence, permission, ...descriptor } = source;
    await checked(verify, evidence, "evidence", source.id, descriptor);
    await checked(verify, permission, "permission", source.id, { ...descriptor, uses: ["fetch", "retain", "annotate", "evaluate"] });
  }
  if (item.partition === "audit") throw new Error("wp24-audit-dispatch-not-qualified");
  if (item.partition === "heldout" || item.partition === "recall") {
    const sampling = manifest.sampling[item.partition];
    if (!sampling || !manifest.history) throw new Error("missing-human-sampling-history");
    const { frame, assembly, ...samplingPayload } = sampling;
    await checked(verify, frame, "sampling", `${manifest.revision.id}/${item.partition}`, {
      ...samplingPayload, revision: manifest.revision, rubric: manifest.rubric,
    });
    await checked(verify, assembly, "sampling", `${manifest.revision.id}/${item.partition}/assembly`, {
      ...samplingPayload, frame, independence: item.partition === "recall" ? "assembled-without-system-retrieved-or-published-output" : "independent-route-balanced-selection",
    });
    const { receipt, ...historyPayload } = manifest.history;
    await checked(verify, receipt, "history", manifest.revision.id, { revision: manifest.revision, ...historyPayload });
    for (const exposure of manifest.history.exposures) await checked(verify, exposure.receipt, "exposure", manifest.revision.id, {
      caseIds: exposure.caseIds, at: exposure.at, reason: exposure.reason,
    });
    // Every graph descriptor must be authenticated before it can support family/freshness claims.
    for (const other of manifest.cases) {
      await checked(verify, other.familyReview, "family-review", other.id, { subject: other.subject, families: other.families, sourceIds: other.sourceIds });
      await checked(verify, other.selectionReceipt, "selection", other.id, discoveryReferenceReviewContext(manifest, other));
    }
  }
  return { manifest, item, contextSha256, sources: sources as NonNullable<typeof sources[number]>[] };
}
/** One recipient only. Peers, case classifications, family decisions and machine summaries are never copied. */
export async function dispatchDiscoveryHumanReview(input: unknown, caseId: string, reviewerId: string,
  originalsInput: unknown, verify: DiscoveryReceiptVerifier) {
  const originals = z.array(SourceBytes).min(1).max(128).parse(originalsInput);
  if (originals.reduce((n, x) => n + x.bytesBase64.length, 0) > 12000000) throw new Error("human-original-total");
  const { manifest, item, contextSha256, sources } = await dispatchContext(input, caseId, reviewerId, verify);
  if (duplicate(originals.map(x => x.sourceId)) || originals.length !== sources.length) throw new Error("human-original-set");
  for (const source of sources) {
    const original = originals.find(x => x.sourceId === source.id);
    if (!original) throw new Error("human-original-missing");
    const bytes = Uint8Array.from(atob(original.bytesBase64), char => char.charCodeAt(0));
    if (bytes.length > 1000000) throw new Error("human-original-size");
    // Reject alternative base64 encodings; only unchanged original bytes can be dispatched.
    let encoded = ""; for (let at = 0; at < bytes.length; at += 8192) encoded += String.fromCharCode(...bytes.subarray(at, at + 8192));
    if (btoa(encoded) !== original.bytesBase64) throw new Error("human-original-encoding");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(x => x.toString(16).padStart(2, "0")).join("");
    if (digest !== source.representationSha256) throw new Error("human-original-hash");
  }
  const packet = { schemaVersion: "discovery-human-packet-v1" as const, caseId, contextSha256, reviewerId, rubric: manifest.rubric,
    claim: { mode: item.claimMode, subject: item.subject }, instructions: Instructions,
    originals: [...originals].sort((a, b) => a.sourceId.localeCompare(b.sourceId)).map(original => {
      const { evidence: _evidence, permission: _permission, originFamilyId: _origin, ...source } = sources.find(x => x.id === original.sourceId)!;
      return { ...original, source };
    }), labels: { ...blankLabels } };
  Packet.parse(packet);
  return packet;
}
/** Checksum/context consistency is not human identity, independence, or fresh-round authentication. */
export async function checkDiscoveryHumanReturn(input: unknown, packetInput: unknown, returnInput: unknown,
  verify: DiscoveryReceiptVerifier, annotationReceipts: boolean = false) {
  const manifestSnapshot = DiscoveryReferenceManifest.parse(input);
  const packet = Packet.parse(packetInput), returnSnapshot = structuredClone(returnInput);
  const returned = (annotationReceipts ? DiscoveryHumanSignedReturn : DiscoveryHumanUnsignedReturn).parse(returnSnapshot);
  const expected = await dispatchDiscoveryHumanReview(manifestSnapshot, packet.caseId, packet.reviewerId, packet.originals.map(({ source: _source, ...original }) => original), verify);
  if (await discoveryEvaluationDigest(packet) !== await discoveryEvaluationDigest(expected)) throw new Error("changed-human-packet");
  const annotation = returned.annotation;
  if (returned.packetSha256 !== await discoveryEvaluationDigest(packet) || returned.contextSha256 !== expected.contextSha256 ||
    annotation.reviewerId !== packet.reviewerId || !same(annotation.rubric, packet.rubric) || duplicate(annotation.sourceIds) ||
    annotation.sourceIds.some(id => !packet.originals.some(x => x.sourceId === id))) throw new Error("changed-human-return");
  const { receipt: _receipt, blindedBatch: _blind, ...payload } = annotation as z.infer<typeof DiscoveryIndependentAnnotation>;
  const annotationExpectation = { schemaVersion: "discovery-independent-annotation-v2", contextSha256: packet.contextSha256, annotation: payload };
  if (annotationReceipts) {
    const signed = DiscoveryIndependentAnnotation.parse(annotation);
    await checked(verify, signed.receipt, "independent-annotation", packet.caseId, annotationExpectation, signed.reviewerId);
    await checked(verify, signed.blindedBatch, "blinding", packet.caseId, { schemaVersion: "discovery-blinding-v2", contextSha256: packet.contextSha256,
      reviewerId: signed.reviewerId, rubric: signed.rubric, annotation: signed.receipt }, signed.reviewerId);
  }
  return { schemaVersion: "discovery-human-return-check-v1", ...boundary, annotationReceiptsVerified: annotationReceipts,
    humanIdentityAndIndependenceEstablished: false, disposition: "pending-accountable-ledger-human-independence-and-adjudication", packetSha256: returned.packetSha256, contextSha256: returned.contextSha256,
    originalReturn: returnSnapshot, annotationExpectation, persistence: "detached-proposal-only",
    replayScope: "Native EX20 context and annotation binding only; same-context replay and identity aliases require accountable external records." };
}
/** Adjudicator handoff preserves both first returns; this emits no adjudication labels or signatures. */
export async function prepareDiscoveryHumanAdjudication(input: unknown, packets: [unknown, unknown], returns: [unknown, unknown], verify: DiscoveryReceiptVerifier) {
  const manifestSnapshot = DiscoveryReferenceManifest.parse(input), packetSnapshots = packets.map(packet => Packet.parse(packet));
  const returnSnapshots = structuredClone(returns), first = DiscoveryHumanSignedReturn.parse(returnSnapshots[0]), second = DiscoveryHumanSignedReturn.parse(returnSnapshots[1]);
  const target = manifestSnapshot.cases.find(item => item.id === packetSnapshots[0]?.caseId);
  // This paired handoff cannot silently replace any prior first annotations. A populated
  // case requires the separate accountable full-set process with every preserved original.
  if (!target || target.annotations.length !== 0) throw new Error("existing-annotations-require-full-set-handoff");
  const checkedReturns = await Promise.all(packetSnapshots.map((packet, i) => checkDiscoveryHumanReturn(manifestSnapshot, packet, returnSnapshots[i], verify, true)));
  if (first.contextSha256 !== second.contextSha256 || first.annotation.reviewerId === second.annotation.reviewerId) throw new Error("independent-return-pair");
  const m = manifestSnapshot, p = packetSnapshots[0]!, q = packetSnapshots[1]!;
  if (p.caseId !== q.caseId) throw new Error("independent-return-pair");
  return { schemaVersion: "discovery-human-adjudication-handoff-v1", ...boundary, contextSha256: first.contextSha256,
    caseId: p.caseId, rubric: m.rubric, annotations: [first.annotation, second.annotation],
    preservedReturns: checkedReturns.map(x => x.originalReturn), returnSha256: await Promise.all(returnSnapshots.map(discoveryEvaluationDigest)),
    disagreements: Object.keys(first.annotation.labels).filter(key => first.annotation.labels[key as keyof typeof first.annotation.labels] !== second.annotation.labels[key as keyof typeof second.annotation.labels]),
    adjudication: null, requiredBinding: "discovery-adjudication-v2: exact contextSha256, adjudication payload and entire preserved annotations array",
    humanIdentityAndIndependenceEstablished: false };
}
