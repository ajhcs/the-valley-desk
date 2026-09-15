import { z } from "zod";
import { CanonicalInstant, DevelopmentType, HttpsUrl, SourceDate, TechnologyArtifact, TechnologyLicense,
  TechnologyRelationship, TechnologyResourceType, TechnologySetup, TechnologyWorkflow, WatchId, canonicalJson,
  developmentIdentityKey, githubRepositoryKey, sha256 } from "../content/watch-schema";
import type { D1DatabaseLike } from "./persistence";

const Label = z.string().trim().min(1).max(240);
const Text = z.string().trim().min(1).max(6000);
const Citation = z.object({ id: WatchId, url: HttpsUrl, checkedAt: CanonicalInstant,
  representationSha256: z.string().regex(/^[a-f0-9]{64}$/), quote: z.string().min(3).max(2000),
  retainedText: z.string().min(3).max(32000),
}).strict().refine(value => value.retainedText.includes(value.quote), "Evidence quote must be literal");
const ProposedFact = z.object({ value: z.unknown(), evidenceIds: z.array(WatchId).min(1).max(20) }).strict();
export const TechnologyDossierInput = z.object({
  schemaVersion: z.literal("technology-dossier-input-1"),
  repository: z.object({ numericId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), commitSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  slug: z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: Label, resourceType: TechnologyResourceType,
  metadataEvidence: z.object({ title: z.array(WatchId).min(1).max(20), resourceType: z.array(WatchId).min(1).max(20),
    repository: z.array(WatchId).min(1).max(20) }).strict().optional(),
  discoveredAt: CanonicalInstant, evidence: z.array(Citation).min(1).max(100),
  purpose: ProposedFact.nullable(), intendedUsers: ProposedFact.nullable(), workflow: ProposedFact.nullable(),
  setup: ProposedFact.nullable(), limitations: ProposedFact.nullable(),
  relationship: z.object({ value: TechnologyRelationship, evidenceIds: z.array(WatchId).min(1).max(20) }).strict(),
  licenses: z.array(z.object({ value: TechnologyLicense, evidenceIds: z.array(WatchId).min(1).max(20) }).strict()).max(24),
  developments: z.array(z.object({ nativeId: Label, type: DevelopmentType.exclude(["policy-action"]),
    artifact: TechnologyArtifact, sourceOccurredAt: SourceDate, evidenceIds: z.array(WatchId).min(1).max(20),
    title: Label, prerelease: z.boolean(), draft: z.boolean() }).strict()).max(40),
  aliasProposal: z.object({ existingId: WatchId, existingUrl: HttpsUrl, reason: Text,
    status: z.literal("review-required") }).strict().nullable(),
}).strict();
export type TechnologyDossierInput = z.infer<typeof TechnologyDossierInput>;

export async function buildTechnologyDossierDraft(raw: unknown) {
  const input = TechnologyDossierInput.parse(raw);
  const subjectId = await githubRepositoryKey(input.repository.numericId);
  const artifactId = subjectId + ":repository";
  const ids = new Set(input.evidence.map(item => item.id));
  if (ids.size !== input.evidence.length) throw new Error("technology-duplicate-evidence");
  const facts = [input.purpose, input.intendedUsers, input.workflow, input.setup, input.limitations,
    input.relationship, ...input.licenses, ...input.developments];
  if (facts.some(fact => fact?.evidenceIds.some(id => !ids.has(id))) ||
      Object.values(input.metadataEvidence ?? {}).flat().some(id => !ids.has(id))) throw new Error("technology-missing-evidence");
  if (input.purpose) Text.parse(input.purpose.value);
  if (input.intendedUsers) z.array(Label).max(20).parse(input.intendedUsers.value);
  if (input.workflow) TechnologyWorkflow.parse(input.workflow.value);
  if (input.setup) TechnologySetup.parse(input.setup.value);
  if (input.limitations) z.array(Text).max(20).parse(input.limitations.value);
  if (input.relationship.value.resourceId !== subjectId || input.relationship.value.artifactId !== artifactId) {
    throw new Error("technology-artifact-relationship-conflict");
  }
  if (input.relationship.value.checkedAt > input.discoveredAt || input.evidence.some(item => item.checkedAt > input.discoveredAt)) {
    throw new Error("technology-future-evidence");
  }
  const artifact = TechnologyArtifact.parse({ id: artifactId, resourceId: subjectId, artifactType: "repository",
    host: "github.com", nativeId: input.repository.numericId, version: input.repository.commitSha,
    url: "https://github.com/" + input.repository.fullName, availability: "public" });
  const artifacts = [artifact, ...input.developments.map(item => item.artifact)];
  if (new Set(artifacts.map(item => item.id)).size !== artifacts.length) throw new Error("technology-duplicate-artifact");
  for (const license of input.licenses) {
    const target = artifacts.find(item => item.id === license.value.artifactId);
    if (!target || target.version !== license.value.artifactVersion) throw new Error("technology-license-version-conflict");
  }
  if (new Set(input.licenses.map(item => item.value.artifactId + ":" + item.value.scope)).size !== input.licenses.length) {
    throw new Error("technology-duplicate-license-scope");
  }
  const developments = [];
  for (const item of input.developments) {
    if (item.artifact.resourceId !== subjectId) throw new Error("technology-development-subject-conflict");
    if ((["baseline", "indexing", "tag"].includes(item.type) || item.draft) && item.sourceOccurredAt.precision !== "unknown") {
      throw new Error("technology-invented-release-date");
    }
    if (item.type === "software-release" && item.artifact.artifactType !== "release") throw new Error("technology-release-artifact-required");
    if (item.type === "paper-publication" && item.artifact.artifactType !== "paper") throw new Error("technology-paper-artifact-required");
    if (item.sourceOccurredAt.precision !== "unknown" && item.sourceOccurredAt.evidenceIds.some(id => !ids.has(id))) {
      throw new Error("technology-missing-date-evidence");
    }
    const occurredAt = item.sourceOccurredAt.precision === "unknown" ? null : Date.parse(item.sourceOccurredAt.value);
    const age = occurredAt === null ? null : Date.parse(input.discoveredAt) - occurredAt;
    if (age !== null && age < 0) throw new Error("technology-future-release");
    developments.push({ ...item, id: await developmentIdentityKey(subjectId, item.type, item.nativeId),
      latestReviewEligible: ["software-release", "paper-publication", "dataset-release", "product-release"].includes(item.type)
        && !item.draft && !item.prerelease && age !== null && age <= 45 * 86400000 });
  }
  if (new Set(developments.map(item => item.id)).size !== developments.length) throw new Error("technology-duplicate-development");
  // Discovery time is not source chronology or a meaningful source-content change.
  const { discoveredAt, ...content } = input;
  const fingerprintContent = { ...content,
    evidence: content.evidence.map(({ checkedAt: _checkedAt, ...item }) => item),
    relationship: { ...content.relationship, value: { ...content.relationship.value, checkedAt: null } } };
  const inputSha256 = await sha256(canonicalJson(fingerprintContent));
  return { subjectId, inputSha256, discoveredAt, input, artifacts, developments,
    status: "review-required" as const, publicationAuthorized: false as const };
}
export type TechnologyDossierDraftRecord = Awaited<ReturnType<typeof buildTechnologyDossierDraft>>;

export async function readTechnologyDossierDraft(db: D1DatabaseLike, subjectId: string) {
  WatchId.parse(subjectId);
  const row = await db.prepare("SELECT d.revision,d.input_sha256,d.payload_json FROM technology_dossier_heads h JOIN technology_dossier_drafts d ON d.subject_id=h.subject_id AND d.revision=h.revision WHERE h.subject_id=?")
    .bind(subjectId).first<{ revision: number; input_sha256: string; payload_json: string }>();
  if (!row) return null;
  const draft = await buildTechnologyDossierDraft(JSON.parse(row.payload_json));
  if (draft.subjectId !== subjectId || draft.inputSha256 !== row.input_sha256) throw new Error("technology-stored-draft-corrupt");
  return { revision: row.revision, draft };
}

export async function persistTechnologyDossierDraft(db: D1DatabaseLike, raw: unknown, expectedRevision: number) {
  z.number().int().nonnegative().safe().parse(expectedRevision);
  const draft = await buildTechnologyDossierDraft(raw);
  const previous = await readTechnologyDossierDraft(db, draft.subjectId);
  if (previous?.draft.inputSha256 === draft.inputSha256) return { outcome: "unchanged" as const, revision: previous.revision, draft };
  if ((previous?.revision ?? 0) !== expectedRevision) throw new Error("technology-stale-draft-revision");
  const revision = expectedRevision + 1;
  const statements = [
    db.prepare("INSERT OR IGNORE INTO technology_dossier_heads(subject_id,checked_at) VALUES(?,?)").bind(draft.subjectId, draft.discoveredAt),
    // A racing revision violates NOT NULL and rolls back the complete D1 batch.
    db.prepare("INSERT INTO technology_dossier_drafts(subject_id,revision,input_sha256,payload_json,discovered_at) SELECT ?,?,CASE WHEN revision=? THEN ? ELSE NULL END,?,? FROM technology_dossier_heads WHERE subject_id=?")
      .bind(draft.subjectId, revision, expectedRevision, draft.inputSha256, canonicalJson(draft.input), draft.discoveredAt, draft.subjectId),
    ...draft.artifacts.map(item => db.prepare("INSERT INTO technology_artifact_observations VALUES(?,?,?,?)")
      .bind(draft.subjectId, revision, item.id, canonicalJson(item))),
    ...draft.developments.map(item => db.prepare("INSERT INTO technology_development_observations VALUES(?,?,?,?,?,?)")
      .bind(draft.subjectId, revision, item.id, item.type, item.sourceOccurredAt.precision === "unknown" ? null : item.sourceOccurredAt.value, canonicalJson(item))),
    db.prepare("UPDATE technology_dossier_heads SET revision=?,input_sha256=?,checked_at=? WHERE subject_id=? AND revision=?")
      .bind(revision, draft.inputSha256, draft.discoveredAt, draft.subjectId, expectedRevision),
  ];
  await db.batch(statements);
  return { outcome: "staged" as const, revision, draft };
}
