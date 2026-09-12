import { z } from "zod";
import { AcceptedFactRecord, CanonicalInstant, EvidenceIds, EvidenceReference, InterpretationDependencies,
  PolicyDossierDraft, Sha256, SubjectAcceptance, TechnologyProfileDraft, WatchId, acceptedFactDigest,
  canonicalJson, evidenceReferenceDigest, sha256, tupleKey, watchDraftDigest } from "../content/watch-schema";
import { compileWatchDelivery, compiledWatchDeliveryValue } from "../content/watch-delivery";
import type { WatchDeliveryCompileContext } from "../content/watch-delivery";
import { evidenceMatches } from "../content/watch-projection";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";
import { applyReviewedWatchProjection, WatchStorageError } from "./watch-persistence";

const Draft = z.union([PolicyDossierDraft, TechnologyProfileDraft]);
const ProposedFact = z.object({
  id: WatchId, subjectId: WatchId, field: z.string().min(1).max(240), value: z.unknown(),
  evidenceIds: EvidenceIds, interpretationDependencies: InterpretationDependencies.nullable(),
}).strict();
export const EditorialProposal = z.object({
  externalKey: z.string().min(1).max(1000), draft: Draft,
  facts: z.array(ProposedFact).min(2).max(80),
  evidence: z.array(EvidenceReference).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.facts.map(fact => fact.id)).size !== value.facts.length ||
      new Set(value.evidence.map(item => item.id)).size !== value.evidence.length ||
      value.facts.some(fact => fact.subjectId !== value.draft.id ||
        fact.evidenceIds.some(id => !value.evidence.some(item => item.id === id)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Proposal identities and evidence must be complete and unique" });
  }
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > 500_000)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Proposal exceeds byte limit" });
});
export type EditorialProposal = z.infer<typeof EditorialProposal>;
type DraftRow = { id: string; subject_id: string; subject_revision: number; input_sha256: string;
  payload_json: string; created_at: string };
type SubjectRow = { input_revision: number; input_sha256: string; public_revision: number };
type DecisionRow = { id: string; action: "accepted" | "rejected"; input_sha256: string; reviewer_principal: string };

// The runtime is built by server code from collection and current-head storage.
// Neither the request nor a proposal may supply this authority.
export type EditorialRuntime = {
  resolveContext: (proposal: EditorialProposal, now: Date) => Promise<Omit<WatchDeliveryCompileContext,
    "acceptance" | "currentSubjectRevision" | "asOf" | "facts" | "evidence"> & {
      acceptanceGuards: (decisionId: string) => D1StatementLike[] | Promise<D1StatementLike[]>;
    }>;
};
const RULE = "watch-editorial-review-v1";

export async function stageEditorialProposal(db: D1DatabaseLike, input: unknown, now = new Date()) {
  const proposal = EditorialProposal.parse(input);
  const json = canonicalJson(proposal), digest = await sha256(json), draft = proposal.draft;
  const id = await tupleKey("watch-editorial-draft-v1", [draft.id, String(draft.subjectRevision), digest]);
  const previous = await db.prepare("SELECT id,input_sha256 FROM watch_editorial_drafts WHERE subject_id=? AND subject_revision=?")
    .bind(draft.id, draft.subjectRevision).first<{ id: string; input_sha256: string }>();
  if (previous) {
    if (previous.id !== id || previous.input_sha256 !== digest) throw new WatchStorageError("watch-draft-revision-conflict");
    return { id: previous.id, sha256: digest, outcome: "unchanged" as const };
  }
  const at = CanonicalInstant.parse(now.toISOString());
  try { await db.batch([
    db.prepare(`INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        input_revision=excluded.input_revision,input_sha256=excluded.input_sha256
      WHERE watch_subjects.input_revision<excluded.input_revision
        AND watch_subjects.kind=excluded.kind AND watch_subjects.external_key=excluded.external_key
        AND watch_subjects.slug=excluded.slug`)
      .bind(draft.id, draft.kind, proposal.externalKey, draft.slug, draft.subjectRevision, digest, at),
    db.prepare(`INSERT INTO watch_editorial_drafts
      SELECT ?,id,?,?,?,? FROM watch_subjects WHERE id=? AND input_revision=? AND input_sha256=?
        AND kind=? AND external_key=? AND slug=?`)
      .bind(id, draft.subjectRevision, digest, json, at, draft.id, draft.subjectRevision, digest,
        draft.kind, proposal.externalKey, draft.slug),
  ]); } catch (error) {
    const concurrent = await db.prepare("SELECT id,input_sha256 FROM watch_editorial_drafts WHERE subject_id=? AND subject_revision=?")
      .bind(draft.id, draft.subjectRevision).first<{ id: string; input_sha256: string }>();
    if (!concurrent) throw error;
    if (concurrent.id !== id || concurrent.input_sha256 !== digest) throw new WatchStorageError("watch-draft-revision-conflict");
    return { id, sha256: digest, outcome: "unchanged" as const };
  }
  if (!await db.prepare("SELECT id FROM watch_editorial_drafts WHERE id=?").bind(id).first())
    throw new WatchStorageError("watch-draft-revision-conflict");
  return { id, sha256: digest, outcome: "staged" as const };
}

export async function readEditorialProposal(db: D1DatabaseLike, id: string) {
  WatchId.parse(id);
  const row = await db.prepare("SELECT * FROM watch_editorial_drafts WHERE id=?").bind(id).first<DraftRow>();
  if (!row) return null;
  const proposal = EditorialProposal.parse(JSON.parse(row.payload_json));
  if (await sha256(canonicalJson(proposal)) !== row.input_sha256 ||
      proposal.draft.id !== row.subject_id || proposal.draft.subjectRevision !== row.subject_revision)
    throw new WatchStorageError("watch-draft-integrity-error", 503);
  const decision = await db.prepare("SELECT id,action,input_sha256,reviewer_principal FROM watch_editorial_decisions WHERE draft_id=?")
    .bind(id).first<DecisionRow>();
  return { id, sha256: row.input_sha256, createdAt: row.created_at, proposal, decision };
}

/** Internal, called only after the existing review API authenticates a named
 * operator. The operator approves stored facts; model-provided receipts are not accepted. */
export async function decideEditorialProposal(db: D1DatabaseLike, input: {
  id: string; sha256: string; action: "accepted" | "rejected";
}, reviewerPrincipal: string, runtime: EditorialRuntime, now = new Date()) {
  const request = z.object({ id: WatchId, sha256: Sha256, action: z.enum(["accepted", "rejected"]) }).strict().parse(input);
  const principal = z.string().trim().min(1).max(320).parse(reviewerPrincipal);
  const stored = await readEditorialProposal(db, request.id);
  if (!stored) throw new WatchStorageError("watch-draft-not-found", 404);
  if (stored.sha256 !== request.sha256) throw new WatchStorageError("watch-draft-hash-conflict");
  const reviewerId = await tupleKey("watch-reviewer-v1", [principal]);
  const decisionId = await tupleKey("watch-editorial-decision-v1", [stored.id, request.action, principal]);
  const replayDecision = async (decision: DecisionRow) => {
    if (decision.id !== decisionId || decision.input_sha256 !== request.sha256 ||
        decision.action !== request.action || decision.reviewer_principal !== principal)
      throw new WatchStorageError("watch-review-already-decided");
    return request.action === "accepted"
      ? { decisionId: decision.id, ...await applyReviewedWatchProjection(db, decision.id, now) }
      : { decisionId: decision.id, outcome: "unchanged" as const };
  };
  const recoverDecision = async (error: unknown) => {
    const concurrent = await readEditorialProposal(db, request.id);
    if (!concurrent?.decision) throw error;
    return replayDecision(concurrent.decision);
  };
  if (stored.decision) return replayDecision(stored.decision);
  const at = CanonicalInstant.parse(now.toISOString()), proposal = stored.proposal, draft = proposal.draft;
  if (stored.createdAt > at) throw new WatchStorageError("watch-review-time-conflict");
  const subject = await db.prepare("SELECT input_revision,input_sha256,public_revision FROM watch_subjects WHERE id=?")
    .bind(draft.id).first<SubjectRow>();
  if (!subject || subject.input_revision !== draft.subjectRevision || subject.input_sha256 !== stored.sha256)
    throw new WatchStorageError("watch-editorial-stale-draft");
  const decisionStatement = (acceptance: SubjectAcceptance | null) =>
    db.prepare("INSERT INTO watch_editorial_decisions VALUES(?,?,?,?,?,?,?,?)")
      .bind(decisionId, stored.id, stored.sha256, request.action, reviewerId, principal, at,
        acceptance ? canonicalJson(acceptance) : null);
  if (request.action === "rejected") {
    try { await decisionStatement(null).run(); } catch (error) { return recoverDecision(error); }
    return { decisionId, outcome: "rejected" as const };
  }
  const resolved = await runtime.resolveContext(proposal, now);
  const evidence = new Map(proposal.evidence.map(item => [item.id, item]));
  for (const item of evidence.values()) {
    const observation = resolved.observations.get(item.observationId);
    if (!observation || !resolved.enrolledSourceIds.has(item.sourceId) ||
        !resolved.sourceUrlAllowed(item.sourceId, item.sourceUrl) || !await evidenceMatches(item, observation))
      throw new WatchStorageError("watch-review-evidence-unavailable");
  }
  const facts = new Map<string, AcceptedFactRecord>();
  for (const fact of proposal.facts) {
    const bindings = [];
    for (const id of fact.evidenceIds) bindings.push({ id, sha256: await evidenceReferenceDigest(evidence.get(id)) });
    facts.set(fact.id, AcceptedFactRecord.parse({ ...fact, evidenceDigests: bindings,
      verification: { kind: "human-review", ruleId: RULE, ruleVersion: "1", verifierId: reviewerId, verifiedAt: at } }));
  }
  const factDigests = [];
  for (const fact of facts.values()) factDigests.push({ id: fact.id, sha256: await acceptedFactDigest(fact) });
  const acceptance = SubjectAcceptance.parse({ id: decisionId, subjectId: draft.id, kind: draft.kind,
    subjectRevision: draft.subjectRevision, draftSha256: await watchDraftDigest(draft),
    acceptedAt: at, gateVersion: RULE, factDigests });
  const compiled = await compileWatchDelivery(draft, { ...resolved, acceptance, facts, evidence,
    currentSubjectRevision: subject.input_revision, asOf: at });
  const { manifest, record } = compiledWatchDeliveryValue(compiled);
  const dependencies = new Map(manifest.groups.flatMap(group => group.dependencies).map(item => [item.key, item]));
  const guards = await resolved.acceptanceGuards(decisionId);
  if (!guards.length) throw new WatchStorageError("watch-review-current-evidence-guard-required");
  const statements: D1StatementLike[] = [...guards, decisionStatement(acceptance)];
  for (const fact of facts.values()) statements.push(db.prepare("INSERT INTO watch_editorial_facts VALUES(?,?,?,?)")
    .bind(decisionId, fact.id, await acceptedFactDigest(fact), canonicalJson(fact)));
  for (const dependency of dependencies.values()) {
    const head = await db.prepare("SELECT kind,digest,revision,changed_at,immutable_record_id FROM watch_dependency_heads WHERE dependency_key=?")
      .bind(dependency.key).first<{ kind: string; digest: string | null; revision: number; changed_at: string; immutable_record_id: string }>();
    if (head) {
      const renewed = head.digest !== dependency.expectedDigest;
      const reviewable = ["artifact", "artifact-license", "local-relationship", "regional-current", "regional-historical"].includes(dependency.kind);
      if (head.kind !== dependency.kind || (renewed && !reviewable) || head.changed_at > at)
        throw new WatchStorageError("watch-review-current-evidence-conflict");
      statements.push(db.prepare(`INSERT INTO watch_editorial_dependency_guards
        VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM watch_dependency_heads h
          WHERE h.dependency_key=? AND h.kind=? AND h.digest IS ? AND h.revision=?
            AND h.changed_at=? AND h.immutable_record_id=? AND h.changed_at<=?
            AND NOT EXISTS(SELECT 1 FROM watch_dependency_expirations e WHERE e.dependency_key=h.dependency_key AND e.valid_until<=?))
          THEN 1 ELSE 0 END)`)
        .bind(decisionId, dependency.key, at, dependency.key, head.kind, head.digest, head.revision,
          head.changed_at, head.immutable_record_id, at, at));
      if (renewed) {
        // Only this named review can replace a retracted artifact/relationship.
        // Source permission and verification-rule authority remain external.
        const recordId = await tupleKey("watch-reviewed-dependency-v1", [decisionId, dependency.key]);
        statements.push(db.prepare("INSERT INTO watch_dependency_records VALUES(?,?,?,?,?,?)")
          .bind(recordId, dependency.key, dependency.kind, head.revision + 1, dependency.expectedDigest, at));
        statements.push(db.prepare("UPDATE watch_dependency_heads SET revision=?,digest=?,immutable_record_id=?,changed_at=? WHERE dependency_key=?")
          .bind(head.revision + 1, dependency.expectedDigest, recordId, at, dependency.key));
      }
      continue;
    }
    if (dependency.kind === "source-permission") throw new WatchStorageError("watch-review-source-permission-required");
    const recordId = await tupleKey("watch-reviewed-dependency-v1", [decisionId, dependency.key]);
    statements.push(db.prepare("INSERT INTO watch_dependency_records VALUES(?,?,?,?,?,?)")
      .bind(recordId, dependency.key, dependency.kind, 1, dependency.expectedDigest, at));
    statements.push(db.prepare("INSERT INTO watch_dependency_heads VALUES(?,?,?,?,?,?)")
      .bind(dependency.key, dependency.kind, 1, dependency.expectedDigest, recordId, at));
  }
  const payload = canonicalJson(record), manifestJson = canonicalJson(manifest);
  statements.push(db.prepare("INSERT INTO watch_reviewed_projections VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(decisionId, draft.id, draft.subjectRevision, stored.sha256, subject.public_revision,
      await sha256(payload), payload, reviewerId, RULE, at));
  statements.push(db.prepare("INSERT INTO watch_delivery_manifests VALUES(?,?,?,?,?,?,?)")
    .bind(decisionId, draft.id, draft.kind, manifest.payloadSha256, RULE, await sha256(manifestJson), manifestJson));
  try { await db.batch(statements); } catch (error) { return recoverDecision(error); }
  return { decisionId, ...await applyReviewedWatchProjection(db, decisionId, now) };
}
