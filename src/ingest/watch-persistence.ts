import { z } from "zod";
import {
  CanonicalInstant, LicenseClassification, PolicyLifecycle, Sha256, TechnologyResourceType,
  WatchId, WatchJurisdiction, WatchPublicRecord, canonicalJson, sha256,
} from "../content/watch-schema";
import type { D1DatabaseLike } from "./persistence";
import { WATCH_DELIVERY_MANIFEST_BYTES, WatchDeliveryManifest, deliveryEasternDay, shapeWatchDelivery, validateDeliveryBinding } from "../content/watch-delivery";
import { deliveryEligibleSql, deliveryFieldCurrentSql, deliveryGroupCurrentSql, deliveryOssSql, deliveryValiditySql } from "./watch-delivery";

export class WatchStorageError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

const Kind = z.enum(["policy", "technology"]);
const Counter = z.number().int().nonnegative().safe();
const PageLimit = z.preprocess(value => typeof value === "string" && /^[1-9]\d?$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(50));
export const WatchDirectoryQuery = z.object({
  kind: Kind, q: z.string().refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Control characters are unsupported")
    .transform(value => value.trim()).pipe(z.string().max(120)).default(""),
  jurisdiction: WatchJurisdiction.optional(), stage: PolicyLifecycle.optional(),
  type: TechnologyResourceType.optional(), organization: WatchId.optional(), license: LicenseClassification.optional(),
  limit: PageLimit.default(20), cursor: z.string().min(1).max(2048).optional(),
}).strict().superRefine((query, context) => {
  if (query.kind === "policy" && (query.type || query.organization || query.license)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Technology filters cannot filter policy records" });
  }
  if (query.kind === "technology" && (query.jurisdiction || query.stage)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Policy filters cannot filter technology records" });
  }
});
export type WatchDirectoryQuery = z.infer<typeof WatchDirectoryQuery>;
type ReadState = { generation: number; minimum_generation: number };
type ReviewedRow = {
  id: string; subject_id: string; input_revision: number; input_sha256: string;
  expected_public_revision: number; payload_sha256: string; payload_json: string;
  reviewer_id: string; gate_version: string; reviewed_at: string;
};
type PublicRow = { subject_id: string; title_key: string; payload_json: string; payload_sha256: string;
  manifest_json: string | null; manifest_sha256: string | null; group_validity: string | null; delivery_eligible: number };
// SQL returns at most this many UTF-8 body bytes plus one <=8 KB lookahead.
// A page may be shorter than its requested limit; the cursor never skips a row.
export const WATCH_DIRECTORY_BODY_BYTES = 2_400_000;
const WATCH_DIRECTORY_ROW_OVERHEAD = 32_000;
const Cursor = z.object({ version: z.literal(1), generation: Counter,
  filter: Sha256, title: z.string().min(1).max(500), id: WatchId }).strict();

async function readState(db: D1DatabaseLike): Promise<ReadState> {
  const state = await db.prepare("SELECT generation, minimum_generation FROM watch_read_state WHERE singleton=1").first<ReadState>();
  if (!state || !Counter.safeParse(state.generation).success || !Counter.safeParse(state.minimum_generation).success
    || state.minimum_generation > state.generation) throw new WatchStorageError("watch-unavailable", 503);
  return state;
}

async function parsePublicRow(row: Pick<PublicRow, "payload_json" | "payload_sha256">): Promise<WatchPublicRecord> {
  if (new TextEncoder().encode(row.payload_json).byteLength > 200_000) throw new WatchStorageError("watch-projection-invalid", 503);
  try {
    const record = WatchPublicRecord.parse(JSON.parse(row.payload_json));
    if (await sha256(canonicalJson(record)) !== row.payload_sha256) throw new Error("checksum");
    return record;
  } catch { throw new WatchStorageError("watch-projection-invalid", 503); }
}

async function parseDeliveryRow(row: PublicRow, deliveryAsOf: string): Promise<WatchPublicRecord> {
  const record = await parsePublicRow(row);
  if (!row.manifest_json || !row.manifest_sha256) throw new WatchStorageError("watch-evidence-changed", 409);
  let delivered: WatchPublicRecord | null;
  try {
    if (new TextEncoder().encode(row.manifest_json).byteLength > WATCH_DELIVERY_MANIFEST_BYTES) throw new Error("manifest size");
    const manifest = WatchDeliveryManifest.parse(JSON.parse(row.manifest_json));
    if (await sha256(canonicalJson(manifest)) !== row.manifest_sha256) throw new Error("manifest checksum");
    const values = z.record(z.string(), z.union([z.literal(0), z.literal(1)])).parse(JSON.parse(row.group_validity ?? "null"));
    delivered = await shapeWatchDelivery(record, manifest, new Map(Object.entries(values).map(([key, value]) => [key, value === 1])), deliveryAsOf);
  } catch { throw new WatchStorageError("watch-projection-invalid", 503); }
  if (!delivered) throw new WatchStorageError("watch-evidence-changed", 409);
  if (row.delivery_eligible !== 1) throw new WatchStorageError("watch-projection-invalid", 503);
  return delivered;
}

async function appliedDecision(db: D1DatabaseLike, id: string) {
  return db.prepare("SELECT generation FROM watch_publication_decisions WHERE decision_id=?").bind(id).first<{ generation: number }>();
}

/** Internal persistence boundary, not review authorization. The decision must
 * already exist in server-owned review storage after evidence/publication gates.
 * No request handler accepts a reviewed payload or client approval flag here. */
export async function applyReviewedWatchProjection(db: D1DatabaseLike, decisionId: string, now = new Date()) {
  WatchId.parse(decisionId);
  const appliedAt = CanonicalInstant.parse(now.toISOString());
  const decision = await db.prepare("SELECT * FROM watch_reviewed_projections WHERE id=?").bind(decisionId).first<ReviewedRow>();
  if (!decision) throw new WatchStorageError("watch-review-not-found", 404);
  const record = await parsePublicRow(decision);
  if (record.id !== decision.subject_id) throw new WatchStorageError("watch-review-subject-conflict");
  const replay = await appliedDecision(db, decisionId);
  if (replay) return { outcome: "unchanged" as const, generation: replay.generation };
  if (CanonicalInstant.parse(decision.reviewed_at) > appliedAt || record.verifiedAt > decision.reviewed_at) {
    throw new WatchStorageError("watch-review-time-conflict");
  }
  const storedManifest = await db.prepare("SELECT manifest_json,manifest_sha256 FROM watch_delivery_manifests WHERE decision_id=?")
    .bind(decisionId).first<{ manifest_json: string; manifest_sha256: string }>();
  if (!storedManifest) throw new WatchStorageError("watch-delivery-manifest-required");
  try {
    if (new TextEncoder().encode(storedManifest.manifest_json).byteLength > WATCH_DELIVERY_MANIFEST_BYTES) throw new Error("manifest size");
    const manifest = await validateDeliveryBinding(record, JSON.parse(storedManifest.manifest_json));
    if (await sha256(canonicalJson(manifest)) !== storedManifest.manifest_sha256 || manifest.gateVersion !== decision.gate_version ||
        manifest.inputRevision !== decision.input_revision || manifest.acceptedAt > appliedAt) throw new Error("manifest binding");
  } catch { throw new WatchStorageError("watch-projection-invalid", 503); }
  const titleKey = record.title.toLowerCase();
  try {
    // The trigger checks subject revision and evidence hash after this batch
    // starts. A failed final write rolls back the generation and all prior writes.
    await db.batch([
      db.prepare("INSERT INTO watch_delivery_application_clocks VALUES(?,?,?)").bind(decisionId, appliedAt, deliveryEasternDay(appliedAt)),
      db.prepare("UPDATE watch_read_state SET generation=generation+1 WHERE singleton=1"),
      db.prepare("INSERT INTO watch_generations SELECT generation,? FROM watch_read_state WHERE singleton=1").bind(appliedAt),
      db.prepare("INSERT INTO watch_publication_decisions SELECT ?,generation,? FROM watch_read_state WHERE singleton=1").bind(decisionId, appliedAt),
      db.prepare(`UPDATE watch_public_revisions SET valid_to=(SELECT generation FROM watch_read_state WHERE singleton=1)
        WHERE subject_id=? AND valid_to IS NULL`).bind(record.id),
      db.prepare(`INSERT INTO watch_public_revisions
        (subject_id,valid_from,valid_to,kind,title_key,payload_sha256,payload_json,decision_id)
        SELECT ?,generation,NULL,?,?,?,?,? FROM watch_read_state WHERE singleton=1`)
        .bind(record.id, record.kind, titleKey, decision.payload_sha256, canonicalJson(record), decisionId),
      db.prepare("UPDATE watch_subjects SET public_revision=public_revision+1 WHERE id=?").bind(record.id),
    ]);
  } catch (error) {
    // A concurrent identical decision may already have committed; it is replay,
    // not a new generation. Unrelated database errors must still propagate.
    const committed = await appliedDecision(db, decisionId);
    if (committed) return { outcome: "unchanged" as const, generation: committed.generation };
    if (error instanceof Error && /watch-(?:delivery-)?stale-acceptance/.test(error.message)) throw new WatchStorageError("watch-stale-acceptance");
    throw error;
  }
  const result = await appliedDecision(db, decisionId);
  if (!result) throw new WatchStorageError("watch-publication-unconfirmed", 503);
  return { outcome: "applied" as const, generation: result.generation };
}

function encodeCursor(value: z.infer<typeof Cursor>): string {
  const bytes = new TextEncoder().encode(canonicalJson(Cursor.parse(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeCursor(value: string): z.infer<typeof Cursor> {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("encoding");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)));
    const cursor = Cursor.parse(JSON.parse(text));
    if (encodeCursor(cursor) !== value) throw new Error("noncanonical");
    return cursor;
  } catch { throw new WatchStorageError("watch-invalid-cursor", 400); }
}
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
async function queryFingerprint(query: WatchDirectoryQuery) {
  return sha256(canonicalJson({ kind: query.kind, q: query.q.toLowerCase(), jurisdiction: query.jurisdiction ?? null,
    stage: query.stage ?? null, type: query.type ?? null, organization: query.organization ?? null,
    license: query.license ?? null, limit: query.limit }));
}

export type WatchDirectoryPage = {
  version: "watch-directory-1"; generation: number; asOf: string | null;
  items: WatchPublicRecord[]; nextCursor: string | null;
};

/** Directory only: acceptance/check times never masquerade as new releases. */
export async function readWatchDirectory(db: D1DatabaseLike, input: unknown, now = new Date()): Promise<WatchDirectoryPage> {
  const query = WatchDirectoryQuery.parse(input);
  const deliveryAsOf = CanonicalInstant.parse(now.toISOString());
  const state = await readState(db);
  const fingerprint = await queryFingerprint(query);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor && cursor.filter !== fingerprint) throw new WatchStorageError("watch-cursor-filter-conflict", 400);
  const generation = cursor?.generation ?? state.generation;
  if (generation < state.minimum_generation) throw new WatchStorageError("watch-cursor-expired", 410);
  if (generation > state.generation) throw new WatchStorageError("watch-invalid-cursor", 400);
  const snapshot = await db.prepare("SELECT created_at FROM watch_generations WHERE generation=?").bind(generation).first<{ created_at: string | null }>();
  if (!snapshot) throw new WatchStorageError("watch-cursor-expired", 410);
  const clauses = ["r.kind=?", "r.valid_from<=?", "(r.valid_to IS NULL OR r.valid_to>?)",
    "length(r.title_key) BETWEEN 1 AND 500", "length(CAST(r.title_key AS BLOB))<=2000", "length(CAST(r.subject_id AS BLOB))<=240",
    "NOT EXISTS (SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=r.subject_id)", deliveryEligibleSql()];
  const values: unknown[] = [deliveryAsOf, deliveryEasternDay(deliveryAsOf), query.kind, generation, generation];
  if (query.q) { clauses.push("r.title_key LIKE ? ESCAPE '\\'"); values.push(`%${escapeLike(query.q.toLowerCase())}%`); }
  if (query.jurisdiction) { clauses.push("json_extract(r.payload_json,'$.jurisdiction')=?"); values.push(query.jurisdiction); }
  if (query.stage) { clauses.push(`(CASE WHEN ${deliveryFieldCurrentSql("lifecycle")} THEN json_extract(r.payload_json,'$.lifecycle') ELSE 'unknown' END)=?`); values.push(query.stage); }
  if (query.type) { clauses.push("json_extract(r.payload_json,'$.resourceType')=?"); values.push(query.type); }
  if (query.organization) { clauses.push(`EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
    WHERE json_extract(g.value,'$.groupType')='local' AND json_extract(g.value,'$.local.entityId')=? AND ${deliveryGroupCurrentSql()})`); values.push(query.organization); }
  if (query.license === "osi-open-source") clauses.push(deliveryOssSql());
  else if (query.license === "unknown") clauses.push(`(EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
    WHERE json_extract(g.value,'$.groupType')='license' AND (NOT ${deliveryGroupCurrentSql()} OR json_extract(g.value,'$.license.classification')='unknown'))
    OR EXISTS (SELECT 1 FROM json_each(r.payload_json,'$.licenseClassifications') WHERE value='unknown'))`);
  else if (query.license) { clauses.push(`EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
    WHERE json_extract(g.value,'$.groupType')='license' AND json_extract(g.value,'$.license.classification')=? AND ${deliveryGroupCurrentSql()})`); values.push(query.license); }
  if (cursor) { clauses.push("(r.title_key>? OR (r.title_key=? AND r.subject_id>?))"); values.push(cursor.title, cursor.title, cursor.id); }
  const result = await db.prepare(`WITH clock AS (SELECT ? AS instant,? AS day), eligible AS MATERIALIZED (
    SELECT r.subject_id,r.title_key,r.valid_from,
      2*length(CAST(r.payload_json AS BLOB))+4*length(CAST(m.manifest_json AS BLOB))+${WATCH_DIRECTORY_ROW_OVERHEAD} AS body_bytes
    FROM watch_public_revisions r CROSS JOIN clock
      LEFT JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id
    WHERE ${clauses.join(" AND ")} ORDER BY r.title_key,r.subject_id LIMIT ?), budgeted AS MATERIALIZED (
      SELECT *,row_number() OVER (ORDER BY title_key,subject_id) AS ordinal,
        sum(body_bytes) OVER (ORDER BY title_key,subject_id ROWS UNBOUNDED PRECEDING) AS total_bytes FROM eligible
    ), bounded AS (SELECT *,CASE WHEN ordinal<=? AND total_bytes<=${WATCH_DIRECTORY_BODY_BYTES} THEN 1 ELSE 0 END AS has_body
      FROM budgeted WHERE ordinal<=1+(SELECT count(*) FROM budgeted WHERE ordinal<=? AND total_bytes<=${WATCH_DIRECTORY_BODY_BYTES}))
    SELECT b.subject_id,b.title_key,b.has_body,
      CASE WHEN b.has_body=1 THEN r.payload_json END AS payload_json,
      CASE WHEN b.has_body=1 THEN r.payload_sha256 END AS payload_sha256,
      CASE WHEN b.has_body=1 THEN m.manifest_json END AS manifest_json,
      CASE WHEN b.has_body=1 THEN m.manifest_sha256 END AS manifest_sha256,
      CASE WHEN b.has_body=1 THEN ${deliveryValiditySql()} END AS group_validity,1 AS delivery_eligible
    FROM bounded b JOIN watch_public_revisions r ON r.subject_id=b.subject_id AND r.valid_from=b.valid_from
      JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id CROSS JOIN clock
    ORDER BY b.title_key,b.subject_id`).bind(...values, query.limit + 1, query.limit, query.limit).all<PublicRow & { has_body: number }>();
  if (!Array.isArray(result.results) || ("success" in result && result.success === false)) throw new WatchStorageError("watch-unavailable", 503);
  const rows = result.results;
  const page = rows.filter(row => row.has_body === 1);
  if (rows.length > query.limit + 1 || rows.length > page.length + 1 || (rows.length && !page.length) ||
      page.some((row, index) => rows[index] !== row) || rows.some(row => row.has_body !== 0 && row.has_body !== 1))
    throw new WatchStorageError("watch-projection-invalid", 503);
  const items: WatchPublicRecord[] = [];
  for (const row of page) {
    try { items.push(await parseDeliveryRow(row, deliveryAsOf)); }
    catch (error) { if (error instanceof WatchStorageError && error.status === 409) throw new WatchStorageError("watch-projection-invalid", 503); throw error; }
  }
  // Expiry can race an already-started request. Report it, never a false empty page.
  if (generation < (await readState(db)).minimum_generation) throw new WatchStorageError("watch-cursor-expired", 410);
  const last = page.at(-1);
  return { version: "watch-directory-1", generation, asOf: snapshot.created_at, items,
    nextCursor: rows.length > page.length && last ? encodeCursor({ version: 1, generation, filter: fingerprint, title: last.title_key, id: last.subject_id }) : null };
}

export type WatchDetail = { version: "watch-detail-1"; item: WatchPublicRecord; asOf: string };

export async function readWatchSubjectRevision(db: D1DatabaseLike, kind: "policy" | "technology", idOrSlug: string,
  lookup: "id" | "slug" = "id", now = new Date()): Promise<WatchDetail | null> {
  Kind.parse(kind); WatchId.parse(idOrSlug); z.enum(["id", "slug"]).parse(lookup);
  const deliveryAsOf = CanonicalInstant.parse(now.toISOString());
  const identityColumn = lookup === "id" ? "r.subject_id" : "s.slug";
  const row = await db.prepare(`WITH clock AS (SELECT ? AS instant,? AS day)
    SELECT r.subject_id,r.title_key,r.payload_json,r.payload_sha256,d.applied_at,m.manifest_json,m.manifest_sha256,
      ${deliveryValiditySql()} AS group_validity,CASE WHEN ${deliveryEligibleSql()} THEN 1 ELSE 0 END AS delivery_eligible
    FROM watch_public_revisions r CROSS JOIN clock JOIN watch_subjects s ON s.id=r.subject_id
    JOIN watch_publication_decisions d ON d.decision_id=r.decision_id
    LEFT JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id
    WHERE r.kind=? AND ${identityColumn}=? AND r.valid_to IS NULL
      AND NOT EXISTS (SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=r.subject_id) LIMIT 1`)
    .bind(deliveryAsOf, deliveryEasternDay(deliveryAsOf), kind, idOrSlug).first<PublicRow & { applied_at: string }>();
  if (!row) return null;
  if (!CanonicalInstant.safeParse(row.applied_at).success) throw new WatchStorageError("watch-projection-invalid", 503);
  return { version: "watch-detail-1", item: await parseDeliveryRow(row, deliveryAsOf), asOf: row.applied_at };
}

export async function readWatchSubject(db: D1DatabaseLike, kind: "policy" | "technology", idOrSlug: string,
  lookup: "id" | "slug" = "id", now = new Date()): Promise<WatchPublicRecord | null> {
  return (await readWatchSubjectRevision(db, kind, idOrSlug, lookup, now))?.item ?? null;
}

export async function withdrawWatchSubject(db: D1DatabaseLike, input: unknown) {
  const value = z.object({ subjectId: WatchId, reason: z.string().trim().min(1).max(1000),
    reviewerId: WatchId, withdrawnAt: CanonicalInstant }).strict().parse(input);
  if (await db.prepare("SELECT subject_id FROM watch_delivery_tombstones WHERE subject_id=?").bind(value.subjectId).first()) return { outcome: "unchanged" as const };
  // Internal, separately authorized withdrawal. Tombstones are never cleared by ingestion.
  try {
    await db.batch([
      db.prepare("INSERT INTO watch_delivery_tombstones VALUES(?,?,?,?)").bind(value.subjectId, value.reason, value.reviewerId, value.withdrawnAt),
      db.prepare("UPDATE watch_read_state SET generation=generation+1 WHERE singleton=1"),
      db.prepare("INSERT INTO watch_generations SELECT generation,? FROM watch_read_state WHERE singleton=1").bind(value.withdrawnAt),
      db.prepare(`UPDATE watch_public_revisions SET valid_to=(SELECT generation FROM watch_read_state WHERE singleton=1)
        WHERE subject_id=? AND valid_to IS NULL`).bind(value.subjectId),
    ]);
  } catch (error) {
    if (await db.prepare("SELECT subject_id FROM watch_delivery_tombstones WHERE subject_id=?").bind(value.subjectId).first()) return { outcome: "unchanged" as const };
    throw error;
  }
  return { outcome: "withdrawn" as const };
}

/** Explicit local/operations retention operation; not a background schedule. */
export async function expireWatchGenerations(db: D1DatabaseLike, minimumGeneration: number) {
  Counter.parse(minimumGeneration);
  const state = await readState(db);
  if (minimumGeneration > state.generation) throw new WatchStorageError("watch-invalid-retention-generation", 400);
  await db.batch([
    db.prepare("UPDATE watch_read_state SET minimum_generation=MAX(minimum_generation,?) WHERE singleton=1").bind(minimumGeneration),
    db.prepare("DELETE FROM watch_public_revisions WHERE valid_to IS NOT NULL AND valid_to<=?").bind(minimumGeneration),
    db.prepare("DELETE FROM watch_generations WHERE generation<?").bind(minimumGeneration),
  ]);
  return { minimumGeneration: (await readState(db)).minimum_generation };
}
