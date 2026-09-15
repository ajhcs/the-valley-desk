import { ZodError } from "zod";
import { canonicalJson, CanonicalInstant, sha256, WatchId } from "../../content/watch-schema";
import { deliveryDependencyKey } from "../../content/watch-delivery";
import type { StoredObservation } from "../../content/watch-projection";
import type { D1DatabaseLike, D1StatementLike } from "../persistence";
import { SourceEnrollment, QualificationReceipt, collectionReadiness, sourceConfigurationDigest,
  sourceEndpointAllowed, sourceLinkAllowed, WatchObservation, snapshotPageDigest,
  proposedModelInputsAfterPersistence, type WatchSnapshotResult, type SnapshotPageReceipt,
  type PersistenceAcknowledgment, type PagePersistenceAcknowledgment } from "./source-enrollment";

export type EnrolledCollectionSource = {
  source: SourceEnrollment; qualification: QualificationReceipt; configurationSha256: string;
  permissionDigest: string; revision: number; cadenceSeconds: number; activationId: string; activatedAt: string;
};
type SourceRow = { id: string; configuration_json: string; configuration_sha256: string; qualification_json: string;
  review_id: string; activation_id: string | null; activated_at: string | null; cadence_seconds: number; revision: number };
type ReviewRow = { engineering_owner_id: string; editorial_owner_id: string; qualification_sha256: string; accepted_at: string; revoked_at: string | null };
async function validateRow(db: D1DatabaseLike, row: SourceRow, now: string, requireHead = true): Promise<EnrolledCollectionSource | null> {
  try {
    const source = SourceEnrollment.parse(JSON.parse(row.configuration_json));
    const qualification = QualificationReceipt.parse(JSON.parse(row.qualification_json));
    const review = await db.prepare("SELECT * FROM watch_collection_reviews WHERE id=?").bind(row.review_id).first<ReviewRow>();
    if (source.id !== row.id || !review || review.revoked_at || review.accepted_at > now ||
        review.accepted_at < qualification.reviewedAt || qualification.reviewEvidenceId !== row.review_id ||
        review.qualification_sha256 !== await sha256(canonicalJson(qualification)) ||
        review.engineering_owner_id !== qualification.engineeringOwnerId || review.editorial_owner_id !== qualification.editorialOwnerId ||
        !row.activation_id || !row.activated_at || row.activated_at > now || row.configuration_sha256 !== await sourceConfigurationDigest(source)) return null;
    const ready = await collectionReadiness(source, { now, activeSourceIds: new Set([source.id]),
      receipts: new Map([[qualification.id, qualification]]) });
    if (!ready.ready) return null;
    const permissionDigest = await sha256(canonicalJson({ configuration: row.configuration_sha256, qualification,
      activationId: row.activation_id, activatedAt: row.activated_at, revision: row.revision }));
    if (requireHead) {
      const head = await db.prepare("SELECT digest,revision FROM watch_dependency_heads WHERE dependency_key=?")
        .bind(await deliveryDependencyKey("source-permission", [source.id])).first<{ digest: string | null; revision: number }>();
      const expiry = await db.prepare("SELECT valid_until FROM watch_dependency_expirations WHERE dependency_key=?").bind(await deliveryDependencyKey("source-permission", [source.id])).first<{ valid_until:string }>();
      if (head?.digest !== permissionDigest || head.revision !== row.revision || expiry?.valid_until !== qualification.expiresAt) return null;
    }
    return { source, qualification, configurationSha256: row.configuration_sha256, permissionDigest,
      revision: row.revision, cadenceSeconds: row.cadence_seconds, activationId:row.activation_id,activatedAt:row.activated_at };
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return null;
    throw error;
  }
}
export async function resolveEnrolledCollectionSource(db: D1DatabaseLike, id: string, now: string) {
  CanonicalInstant.parse(now); WatchId.parse(id);
  const row = await db.prepare("SELECT * FROM watch_collection_sources WHERE id=?").bind(id).first<SourceRow>();
  return row ? validateRow(db, row, now) : null;
}

// Internal operator writer only. Approval must already exist in the review store;
// no collector, model output, or request body creates that authority.
export async function configureWatchCollectionSource(db: D1DatabaseLike, input: {
  source: unknown; qualification: unknown; activationId: string | null; cadenceSeconds: number; expectedRevision: number;
}, now = new Date().toISOString()) {
  CanonicalInstant.parse(now);
  const source = SourceEnrollment.parse(input.source), qualification = QualificationReceipt.parse(input.qualification);
  if (!Number.isInteger(input.cadenceSeconds) || input.cadenceSeconds < 60 || input.cadenceSeconds > 604800 ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw Error("watch-source-config-invalid");
  if (input.activationId) WatchId.parse(input.activationId);
  const previous = await db.prepare("SELECT revision FROM watch_collection_sources WHERE id=?").bind(source.id).first<{ revision: number }>();
  if ((previous?.revision ?? 0) !== input.expectedRevision) throw Error("watch-source-revision-conflict");
  const row: SourceRow = { id: source.id, configuration_json: canonicalJson(source), configuration_sha256: await sourceConfigurationDigest(source),
    qualification_json: canonicalJson(qualification), review_id: qualification.reviewEvidenceId, activation_id: input.activationId,
    activated_at: input.activationId ? now : null, cadence_seconds: input.cadenceSeconds, revision: input.expectedRevision + 1 };
  const accepted = input.activationId ? await validateRow(db, row, now, false) : null;
  if (input.activationId && !accepted) throw Error("watch-source-qualification-required");
  const key = await deliveryDependencyKey("source-permission", [source.id]), recordId = crypto.randomUUID();
  // The revision predicate and immutable dependency record make competing writes
  // fail as a batch, without exposing a new config under an old permission head.
  await db.batch([
    db.prepare(`INSERT INTO watch_collection_sources VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET configuration_json=excluded.configuration_json,configuration_sha256=excluded.configuration_sha256,
      qualification_json=excluded.qualification_json,review_id=excluded.review_id,activation_id=excluded.activation_id,
      activated_at=excluded.activated_at,cadence_seconds=excluded.cadence_seconds,revision=excluded.revision
      WHERE watch_collection_sources.revision=?`).bind(row.id,row.configuration_json,row.configuration_sha256,row.qualification_json,row.review_id,
        row.activation_id,row.activated_at,row.cadence_seconds,row.revision,input.expectedRevision),
    db.prepare("INSERT INTO watch_dependency_records VALUES(?,?,?,?,?,?)").bind(recordId,key,"source-permission",row.revision,accepted?.permissionDigest ?? null,now),
    db.prepare(`INSERT INTO watch_dependency_heads VALUES(?,?,?,?,?,?) ON CONFLICT(dependency_key) DO UPDATE SET
      revision=excluded.revision,digest=excluded.digest,immutable_record_id=excluded.immutable_record_id,changed_at=excluded.changed_at`)
      .bind(key,"source-permission",row.revision,accepted?.permissionDigest ?? null,recordId,now),
    db.prepare(`INSERT INTO watch_dependency_expirations VALUES(?,?) ON CONFLICT(dependency_key) DO UPDATE SET valid_until=excluded.valid_until`)
      .bind(key,qualification.expiresAt),
    db.prepare(`INSERT INTO watch_collection_state(source_id,next_due_at) VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET next_due_at=excluded.next_due_at`)
      .bind(source.id,now),
  ]);
  return { revision: row.revision, permissionDigest: accepted?.permissionDigest ?? null };
}

export async function revokeWatchCollectionReview(db: D1DatabaseLike, reviewId: string, now = new Date().toISOString()) {
  WatchId.parse(reviewId); CanonicalInstant.parse(now);
  const review=await db.prepare("SELECT accepted_at,revoked_at FROM watch_collection_reviews WHERE id=?").bind(reviewId)
    .first<{accepted_at:string;revoked_at:string|null}>();
  if(!review || now<review.accepted_at)throw Error("watch-source-review-not-found-or-future");
  if(review.revoked_at)return {outcome:"unchanged" as const};
  const rows=(await db.prepare("SELECT id,revision FROM watch_collection_sources WHERE review_id=?").bind(reviewId)
    .all<{id:string;revision:number}>()).results??[];
  const statements=[];
  for(const row of rows){
    const key=await deliveryDependencyKey("source-permission",[row.id]),recordId=crypto.randomUUID(),revision=row.revision+1;
    statements.push(db.prepare("UPDATE watch_collection_sources SET activation_id=NULL,activated_at=NULL,revision=? WHERE id=? AND revision=?").bind(revision,row.id,row.revision),
      db.prepare("INSERT INTO watch_dependency_records VALUES(?,?,?,?,?,?)").bind(recordId,key,"source-permission",revision,null,now),
      db.prepare("UPDATE watch_dependency_heads SET revision=?,digest=NULL,immutable_record_id=?,changed_at=? WHERE dependency_key=?").bind(revision,recordId,now,key));
  }
  statements.push(db.prepare("UPDATE watch_collection_reviews SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now,reviewId));
  await db.batch(statements);
  return {outcome:"revoked" as const,sourceIds:rows.map(row=>row.id)};
}

export type RetainedRepresentation = { id: string; source_id: string; endpoint: string; representation_sha256: string;
  representation: ArrayBuffer | Uint8Array | number[]; normalized_text: string; normalizer_version: string;
  parser_version: string; configuration_sha256: string; first_seen_at: string; etag: string | null; last_modified: string | null };
export function retainedBytes(row: RetainedRepresentation): Uint8Array {
  return row.representation instanceof Uint8Array ? row.representation : new Uint8Array(row.representation);
}
export async function retainedGoodRepresentation(db: D1DatabaseLike, enrolled: EnrolledCollectionSource, endpoint: string) {
  return db.prepare(`SELECT r.* FROM watch_raw_representations r JOIN watch_collection_pages p ON p.representation_id=r.id
    WHERE r.source_id=? AND r.endpoint=? AND r.configuration_sha256=?
    AND json_extract(p.page_json,'$.state') IN ('healthy','healthy-empty')
    AND json_extract(p.page_json,'$.truncated')=0 AND json_extract(p.page_json,'$.rejectedItems')=0
    ORDER BY p.persisted_at DESC LIMIT 1`).bind(enrolled.source.id,endpoint,enrolled.configurationSha256).first<RetainedRepresentation>();
}
export async function persistWatchCollectionPage(db: D1DatabaseLike, enrolled: EnrolledCollectionSource, input: {
  snapshotId: string; endpoint: string; bytes: Uint8Array; body: string; headers: Headers; result: WatchSnapshotResult; now: string; leaseOwner: string;
}) {
  const { result, now } = input, hash = await sha256(input.bytes), source = enrolled.source;
  if (hash !== result.representationSha256 || new TextDecoder("utf-8",{fatal:true}).decode(input.bytes) !== input.body ||
      !sourceEndpointAllowed(source,input.endpoint) || input.bytes.byteLength > source.maxBytes) throw Error("watch-representation-conflict");
  const representationId = await sha256(canonicalJson([source.id,input.endpoint,hash,enrolled.configurationSha256]));
  const page: SnapshotPageReceipt = { sourceId: source.id,snapshotId:input.snapshotId,parserVersion:source.parserVersion,
    ...result.pagination,completeness:result.health.completeness ?? "partial",state:result.health.state,truncated:result.truncated,
    rejectedItems:result.rejectedItems,observationIds:result.observations.map(item=>item.id),representationSha256:hash };
  const pageHash = await snapshotPageDigest(page), pageId = await sha256(canonicalJson([input.snapshotId,page.pageKey]));
  for (const item of result.observations) {
    WatchObservation.parse(item);
    if (item.sourceId !== source.id || item.representationSha256 !== hash || await sha256(canonicalJson(item.payload)) !== item.payloadSha256)
      throw Error("watch-observation-conflict");
  }
  const current = await resolveEnrolledCollectionSource(db,source.id,now);
  if (current?.permissionDigest !== enrolled.permissionDigest) throw Error("watch-source-permission-changed");
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO watch_raw_representations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(representationId,source.id,input.endpoint,hash,input.bytes.buffer.slice(input.bytes.byteOffset,input.bytes.byteOffset+input.bytes.byteLength),
        input.body,"watch-utf8-v1",source.parserVersion,enrolled.configurationSha256,input.headers.get("content-type"),
        input.headers.get("etag"),input.headers.get("last-modified"),result.health.checkedAt),
    ...result.observations.map(item=>db.prepare("INSERT OR IGNORE INTO watch_raw_observations VALUES(?,?,?,?,?,?)")
      .bind(item.id,source.id,representationId,item.payloadSha256,canonicalJson(item),item.fetchedAt)),
    db.prepare("INSERT INTO watch_collection_pages VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(pageId,source.id,input.snapshotId,page.pageKey,representationId,pageHash,canonicalJson(page),now,input.leaseOwner),
  ]);
  const persisted = new Map<string,PersistenceAcknowledgment>();
  for (const item of result.observations) {
    const row = await db.prepare("SELECT payload_sha256,first_seen_at FROM watch_raw_observations WHERE id=?").bind(item.id)
      .first<{ payload_sha256: string; first_seen_at: string }>();
    if (!row || row.payload_sha256 !== item.payloadSha256) throw Error("watch-persisted-observation-conflict");
    persisted.set(item.id,{observationId:item.id,sourceId:source.id,representationSha256:hash,payloadSha256:row.payload_sha256,
      firstSeenAt:row.first_seen_at,persistedAt:now,receiptId:item.id});
  }
  const acknowledgment: PagePersistenceAcknowledgment = {sourceId:source.id,snapshotId:input.snapshotId,pageKey:page.pageKey,
    pageReceiptSha256:pageHash,persistedAt:now,receiptId:pageId};
  return {page,persisted,acknowledgment,proposed:await proposedModelInputsAfterPersistence(result,persisted)};
}

export async function resolveWatchCollectionEvidence(db: D1DatabaseLike, observationIds: string[], now: string) {
  if (observationIds.length>400) throw Error("watch-evidence-limit");
  const observations = new Map<string,StoredObservation>(), enrolled = new Map<string,EnrolledCollectionSource>();
  for (const id of new Set(observationIds)) {
    WatchId.parse(id);
    const row = await db.prepare(`SELECT r.*,o.observation_json,o.payload_sha256 FROM watch_raw_observations o
      JOIN watch_raw_representations r ON r.id=o.representation_id WHERE o.id=?`).bind(id)
      .first<RetainedRepresentation & { observation_json:string; payload_sha256:string }>();
    if (!row) continue;
    const source = enrolled.get(row.source_id) ?? await resolveEnrolledCollectionSource(db,row.source_id,now);
    if (!source || row.configuration_sha256 !== source.configurationSha256) continue;
    const observation = WatchObservation.parse(JSON.parse(row.observation_json)), bytes = retainedBytes(row);
    if (observation.id!==id || observation.sourceId!==row.source_id || observation.representationSha256!==row.representation_sha256 ||
        await sha256(bytes)!==row.representation_sha256 || await sha256(canonicalJson(observation.payload))!==row.payload_sha256 ||
        new TextDecoder("utf-8",{fatal:true}).decode(bytes)!==row.normalized_text) throw Error("watch-evidence-integrity");
    enrolled.set(row.source_id,source);
    observations.set(id,{id,sourceId:row.source_id,sourceUrl:row.endpoint,parserVersion:row.parser_version,
      representation:bytes,normalizedText:row.normalized_text,normalizerVersion:row.normalizer_version});
  }
  return { ...await collectionPermissionContext(db, enrolled, now), observations };
}

// Native dossier adapters retain their own observations but share the same
// enrolled-source authority and transactional qualification checks.
export async function resolveWatchSourcePermissions(db: D1DatabaseLike, sourceIds: readonly string[], now: string) {
  CanonicalInstant.parse(now);
  if (sourceIds.length > 100) throw Error("watch-source-permission-limit");
  const enrolled = new Map<string, EnrolledCollectionSource>();
  for (const id of new Set(sourceIds)) {
    const source = await resolveEnrolledCollectionSource(db, id, now);
    if (source) enrolled.set(id, source);
  }
  return collectionPermissionContext(db, enrolled, now);
}

async function collectionPermissionContext(db: D1DatabaseLike, enrolled: ReadonlyMap<string, EnrolledCollectionSource>, now: string) {
  const permissionKeys=new Map<string,string>(),qualificationDigests=new Map<string,string>();
  for(const [id,value] of enrolled){
    permissionKeys.set(id,await deliveryDependencyKey("source-permission",[id]));
    qualificationDigests.set(id,await sha256(canonicalJson(value.qualification)));
  }
  return { enrolledSourceIds:new Set(enrolled.keys()),
    sourcePermissionDigests:new Map([...enrolled].map(([id,value])=>[id,value.permissionDigest])),
    sourceRevisions:new Map([...enrolled].map(([id,value])=>[id,value.revision])),
    sourceUrlAllowed:(id:string,url:string)=>{const value=enrolled.get(id);return !!value && sourceEndpointAllowed(value.source,url);},
    publicUrlAllowed:(url:string)=>[...enrolled.values()].some(value=>sourceLinkAllowed(value.source,url)),
    acceptanceGuards:(decisionId:string):D1StatementLike[]=>{
      WatchId.parse(decisionId);
      return [...enrolled.values()].map(value=>db.prepare(`INSERT INTO watch_collection_acceptance_guards
        VALUES(?,?,?,?,CASE WHEN EXISTS(
          SELECT 1 FROM watch_collection_sources s JOIN watch_collection_reviews r ON r.id=s.review_id
          JOIN watch_dependency_heads h ON h.dependency_key=? JOIN watch_dependency_expirations e ON e.dependency_key=h.dependency_key
          WHERE s.id=? AND s.configuration_json=? AND s.configuration_sha256=? AND s.qualification_json=?
            AND s.revision=? AND s.activation_id=? AND s.activated_at=? AND s.activated_at<=?
            AND r.id=? AND r.qualification_sha256=? AND r.revoked_at IS NULL AND r.accepted_at<=? AND r.accepted_at>=?
            AND r.engineering_owner_id=? AND r.editorial_owner_id=?
            AND h.kind='source-permission' AND h.digest=? AND h.revision=? AND h.changed_at<=?
            AND e.valid_until=? AND e.valid_until>?
        ) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),decisionId,value.source.id,now,
          permissionKeys.get(value.source.id),value.source.id,canonicalJson(value.source),value.configurationSha256,canonicalJson(value.qualification),
          value.revision,value.activationId,value.activatedAt,now,value.qualification.reviewEvidenceId,qualificationDigests.get(value.source.id),now,value.qualification.reviewedAt,
          value.qualification.engineeringOwnerId,value.qualification.editorialOwnerId,value.permissionDigest,value.revision,now,
          value.qualification.expiresAt,now));
    } };
}
