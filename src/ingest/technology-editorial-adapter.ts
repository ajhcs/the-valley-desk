import { z } from "zod";
import { CanonicalInstant, EvidenceReference, HttpsUrl, TechnologyProfileDraft, WatchId,
  sha256, tupleKey } from "../content/watch-schema";
import { deliveryDependencyKey } from "../content/watch-delivery";
import type { CurrentArtifact, StoredObservation } from "../content/watch-projection";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";
import { readTechnologyDossierDraft } from "./technology-dossiers";

const Capture = z.object({ url: HttpsUrl, checkedAt: CanonicalInstant,
  body: z.string().min(1).refine(value => new TextEncoder().encode(value).byteLength <= 1000000) }).strict();
type Head = { source_id: string; revision: number; observation_id: string; representation_sha256: string; checked_at: string };
export type TechnologySourceHeadAssertion = { subjectId: string; sourceId: string; url: string;
  observationId: string; representationSha256: string };
const PARSER = "technology-capture-v1";

/** Server internal: sourceId is resolved from approved enrollment, never trusted
 * from a capture packet. Capture storage itself confers no source permission. */
export async function persistTechnologySourceRepresentation(db: D1DatabaseLike, subjectId: string,
  sourceId: string, raw: unknown) {
  WatchId.parse(subjectId); WatchId.parse(sourceId);
  const capture = Capture.parse(raw), digest = await sha256(capture.body);
  const previous = await db.prepare("SELECT * FROM technology_source_heads WHERE subject_id=? AND source_url=?")
    .bind(subjectId, capture.url).first<Head>();
  if (previous && capture.checkedAt < previous.checked_at) throw new Error("technology-out-of-order-capture");
  if (previous?.representation_sha256 === digest && previous.source_id === sourceId) {
    return { observationId: previous.observation_id, outcome: "unchanged" as const };
  }
  const observationId = await tupleKey("technology-observation-v1", [subjectId, sourceId,
    await sha256(capture.url), digest, capture.checkedAt]);
  const revision = (previous?.revision ?? 0) + 1;
  const statements: D1StatementLike[] = [
    db.prepare("INSERT INTO technology_review_guards SELECT ?,CASE WHEN COALESCE((SELECT revision FROM technology_source_heads WHERE subject_id=? AND source_url=?),0)=? THEN 1 ELSE 0 END")
      .bind(observationId, subjectId, capture.url, previous?.revision ?? 0),
    db.prepare("INSERT INTO technology_source_representations VALUES(?,?,?,?,?,?,?)")
      .bind(observationId, subjectId, sourceId, capture.url, digest, capture.body, capture.checkedAt),
    db.prepare("INSERT INTO technology_source_heads VALUES(?,?,?,?,?,?,?) ON CONFLICT(subject_id,source_url) DO UPDATE SET source_id=excluded.source_id,revision=excluded.revision,observation_id=excluded.observation_id,representation_sha256=excluded.representation_sha256,checked_at=excluded.checked_at")
      .bind(subjectId, capture.url, sourceId, revision, observationId, digest, capture.checkedAt),
  ];
  const knownSubject = previous || await db.prepare("SELECT observation_id FROM technology_source_heads WHERE subject_id=? LIMIT 1")
    .bind(subjectId).first();
  if (knownSubject) {
    // Raw changes may retract existing authority, but never create/repopulate it.
    const inventory = await db.prepare("SELECT revision FROM technology_dossier_heads WHERE subject_id=?")
      .bind(subjectId).first<{ revision: number }>();
    const artifacts = await db.prepare("SELECT DISTINCT artifact_id FROM technology_artifact_observations WHERE subject_id=? LIMIT 401")
      .bind(subjectId).all<{ artifact_id: string }>();
    if (!Array.isArray(artifacts.results) || ("success" in artifacts && artifacts.success === false) || artifacts.results.length > 400)
      throw new Error("technology-artifact-inventory-unavailable");
    statements.push(db.prepare("INSERT INTO technology_review_guards SELECT ?,CASE WHEN COALESCE((SELECT revision FROM technology_dossier_heads WHERE subject_id=?),0)=? THEN 1 ELSE 0 END")
      .bind(await tupleKey("technology-inventory-guard-v1", [observationId]), subjectId, inventory?.revision ?? 0));
    const artifactIds = new Set([subjectId + ":repository", ...artifacts.results.map(row => row.artifact_id)]);
    for (const artifactId of artifactIds) for (const scope of [null, "code", "data", "weights"] as const) {
      const kind = scope === null ? "artifact" : "artifact-license";
      const key = await deliveryDependencyKey(kind, scope === null ? [artifactId] : [artifactId, scope]);
      const id = await tupleKey("technology-retraction-v1", [observationId, key]);
      // Read heads inside the write transaction, including a first approval
      // that committed after source resolution but before this capture batch.
      statements.push(db.prepare("INSERT INTO watch_dependency_records SELECT ?,dependency_key,kind,revision+1,NULL,MAX(changed_at,?) FROM watch_dependency_heads WHERE dependency_key=? AND kind=? AND digest IS NOT NULL")
        .bind(id, capture.checkedAt, key, kind));
      statements.push(db.prepare("UPDATE watch_dependency_heads SET revision=(SELECT revision FROM watch_dependency_records WHERE immutable_record_id=?),digest=NULL,immutable_record_id=?,changed_at=(SELECT changed_at FROM watch_dependency_records WHERE immutable_record_id=?) WHERE dependency_key=? AND EXISTS(SELECT 1 FROM watch_dependency_records WHERE immutable_record_id=?)")
        .bind(id, id, id, key, id));
    }
  }
  await db.batch(statements);
  return { observationId, outcome: "retained" as const };
}

/** Capture these predicates during resolution; execute guards inside the same
 * transaction as acceptance. A refresh between resolution and commit must fail. */
export async function technologyAcceptanceGuards(db: D1DatabaseLike,
  assertions: readonly TechnologySourceHeadAssertion[], decisionId: string) {
  WatchId.parse(decisionId);
  if (assertions.length < 1 || assertions.length > 30) throw new Error("technology-guard-count");
  const statements = [];
  for (const [index, item] of assertions.entries()) {
    const id = await tupleKey("technology-acceptance-guard-v1", [decisionId, String(index)]);
    statements.push(db.prepare("INSERT INTO technology_review_guards SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM technology_source_heads WHERE subject_id=? AND source_id=? AND source_url=? AND observation_id=? AND representation_sha256=?) THEN 1 ELSE 0 END")
      .bind(id, item.subjectId, item.sourceId, item.url, item.observationId, item.representationSha256));
  }
  return statements;
}

export async function prepareTechnologyEditorialProposal(db: D1DatabaseLike, subjectId: string) {
  const stored = await readTechnologyDossierDraft(db, subjectId);
  if (!stored) throw new Error("technology-draft-not-found");
  const { draft: record, revision } = stored, input = record.input;
  // Legacy captures remain readable, but affiliation-only citations cannot be
  // promoted into title, artifact identity or practical-use evidence.
  if (!input.metadataEvidence) throw new Error("technology-field-evidence-review-required");
  const evidence: EvidenceReference[] = [], observations = new Map<string, StoredObservation>();
  const sourceHeadAssertions: TechnologySourceHeadAssertion[] = [];
  for (const citation of input.evidence) {
    const row = await db.prepare("SELECT r.*,h.observation_id AS current_id,h.representation_sha256 AS current_sha FROM technology_source_heads h JOIN technology_source_representations r ON r.id=h.observation_id WHERE h.subject_id=? AND h.source_url=?")
      .bind(subjectId, citation.url).first<{ id: string; source_id: string; source_url: string;
        representation_sha256: string; representation: string; current_id: string; current_sha: string }>();
    if (!row || row.current_sha !== citation.representationSha256 ||
        await sha256(row.representation) !== row.representation_sha256) throw new Error("technology-current-source-conflict");
    const start = row.representation.indexOf(citation.quote);
    if (start < 0) throw new Error("technology-literal-evidence-conflict");
    observations.set(row.id, { id: row.id, sourceId: row.source_id, sourceUrl: row.source_url,
      parserVersion: PARSER, representation: row.representation, normalizedText: row.representation, normalizerVersion: PARSER });
    evidence.push(EvidenceReference.parse({ id: citation.id, kind: "text", observationId: row.id,
      sourceId: row.source_id, sourceUrl: row.source_url, sourceLabel: input.title + " source",
      representationSha256: row.representation_sha256, parserVersion: PARSER, quote: citation.quote, start,
      end: start + citation.quote.length, normalizerVersion: PARSER, normalizedTextSha256: row.representation_sha256 }));
    if (!sourceHeadAssertions.some(item => item.url === citation.url)) sourceHeadAssertions.push({
      subjectId, sourceId: row.source_id, url: citation.url, observationId: row.id, representationSha256: row.representation_sha256 });
  }
  const facts: Array<{ id: string; subjectId: string; field: string; value: unknown; evidenceIds: string[];
    interpretationDependencies: null }> = [];
  function fact(field: string, value: unknown, ids: string[], suffix = field) {
    const id = subjectId + ":fact:" + suffix;
    facts.push({ id, subjectId, field, value, evidenceIds: ids, interpretationDependencies: null });
    return id;
  }
  const titleFactId = fact("title", input.title, input.metadataEvidence.title);
  const resourceTypeFactId = fact("resource-type", input.resourceType, input.metadataEvidence.resourceType);
  const artifactFactIds = record.artifacts.map((artifact, index) => {
    const development = record.developments.find(item => item.artifact.id === artifact.id);
    const ids = index === 0 ? input.metadataEvidence!.repository
      : development!.evidenceIds;
    const expectedType = { "software-release": "release", "paper-publication": "paper",
      "dataset-release": "dataset", "product-release": "product" };
    const sourceDate = development?.sourceOccurredAt;
    // Only the matching retained development can supply a release/publication date.
    const dated = development && !development.draft && !development.prerelease && sourceDate?.precision !== "unknown" &&
      expectedType[development.type as keyof typeof expectedType] === artifact.artifactType;
    const { sourceOccurredAt: _untrustedDate, ...value } = artifact;
    return fact("artifact", dated ? { ...value, sourceOccurredAt: sourceDate } : value,
      [...new Set([...ids, ...(dated && sourceDate ? sourceDate.evidenceIds : [])])], "artifact-" + index);
  });
  const relationshipFactIds = [fact("local-relationship", input.relationship.value, input.relationship.evidenceIds)];
  const licenseFactIds = input.licenses.map((item, index) => fact("license", item.value, item.evidenceIds, "license-" + index));
  const optional = (field: string, value: typeof input.purpose) => value
    ? { factId: fact(field, value.value, value.evidenceIds) }
    : { unavailableReason: "Field-specific source evidence has not been established." };
  const draft = TechnologyProfileDraft.parse({ id: subjectId, slug: input.slug, kind: "technology", subjectRevision: revision,
    titleFactId, resourceTypeFactId, artifactFactIds, relationshipFactIds, licenseFactIds,
    purpose: optional("purpose", input.purpose), intendedUsers: optional("intended-users", input.intendedUsers),
    workflow: optional("workflow", input.workflow), setup: optional("setup", input.setup),
    limitations: optional("limitations", input.limitations) });
  const currentArtifacts = new Map<string, CurrentArtifact>(record.artifacts.map(artifact => [artifact.id, {
    resourceId: subjectId, version: artifact.version, licenseSha256s: {
      code: input.licenses.find(item => item.value.artifactId === artifact.id && item.value.scope === "code")?.value.licenseSha256 ?? null,
      data: input.licenses.find(item => item.value.artifactId === artifact.id && item.value.scope === "data")?.value.licenseSha256 ?? null,
      weights: input.licenses.find(item => item.value.artifactId === artifact.id && item.value.scope === "weights")?.value.licenseSha256 ?? null } }]));
  return { proposal: { externalKey: "github:repository:" + input.repository.numericId, draft, facts, evidence },
    observations, currentArtifacts, sourceHeadAssertions };
}
