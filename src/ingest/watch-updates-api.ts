import { z } from "zod";
import { CanonicalInstant, Sha256, WatchId, WatchPublicRecord, canonicalJson, sha256, tupleKey } from "../content/watch-schema";
import { MAX_WATCH_UPDATES_BYTES, WatchUpdate, WatchUpdatesResponse } from "../content/watch-updates";
import { WATCH_DELIVERY_MANIFEST_BYTES, WatchDeliveryManifest, deliveryEasternDay, shapeWatchDelivery } from "../content/watch-delivery";
import { deliveryEligibleSql, deliveryGroupCurrentSql, deliveryValiditySql } from "./watch-delivery";
import { WatchStorageError } from "./watch-persistence";
import type { D1DatabaseLike } from "./persistence";

const Count = z.number().int().nonnegative().safe();
const Query = z.object({ kind: z.enum(["policy", "technology"]), cursor: z.string().min(1).max(2048).optional(),
  limit: z.preprocess(value => typeof value === "string" && /^[1-9]\d?$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(50)).default(20) }).strict();
const Cursor = z.object({ version: z.literal(1), kind: z.enum(["policy", "technology"]), generation: Count,
  date: z.string().min(10).max(30), subject: WatchId, item: WatchId }).strict();
function decode(value: string) {
  try { return Cursor.parse(JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")))); }
  catch { throw new WatchStorageError("watch-invalid-cursor", 400); }
}
function encode(value: z.infer<typeof Cursor>) { return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function state(db: D1DatabaseLike) {
  const row = await db.prepare("SELECT generation,minimum_generation FROM watch_read_state WHERE singleton=1").first<{ generation: number; minimum_generation: number }>();
  if (!row || !Count.safeParse(row.generation).success || !Count.safeParse(row.minimum_generation).success || row.minimum_generation > row.generation)
    throw new WatchStorageError("watch-unavailable", 503);
  return row;
}
type Row = { subject_id: string; item_id: string; source_date: string; payload_json: string; payload_sha256: string;
  manifest_json: string; manifest_sha256: string; group_validity: string; has_body: number };
async function shape(row: Row, at: string): Promise<WatchPublicRecord> {
  try {
    if (new TextEncoder().encode(row.payload_json).length > 200000 ||
        new TextEncoder().encode(row.manifest_json).length > WATCH_DELIVERY_MANIFEST_BYTES) throw new Error("size");
    const record = WatchPublicRecord.parse(JSON.parse(row.payload_json));
    const manifest = WatchDeliveryManifest.parse(JSON.parse(row.manifest_json));
    Sha256.parse(row.payload_sha256); Sha256.parse(row.manifest_sha256);
    if (await sha256(canonicalJson(record)) !== row.payload_sha256 || await sha256(canonicalJson(manifest)) !== row.manifest_sha256)
      throw new Error("checksum");
    const validity = z.record(z.string(), z.union([z.literal(0), z.literal(1)])).parse(JSON.parse(row.group_validity));
    const delivered = await shapeWatchDelivery(record, manifest, new Map(Object.entries(validity).map(([key, value]) => [key, value === 1])), at);
    if (!delivered || delivered.id !== row.subject_id) throw new Error("held");
    return delivered;
  } catch { throw new WatchStorageError("watch-projection-invalid", 503); }
}
async function update(record: WatchPublicRecord, row: Row): Promise<WatchUpdate> {
  const fact = record.kind === "policy" ? [...record.timeline, ...(record.latestAction ? [record.latestAction] : [])].find(item => item.value.id === row.item_id)
    : record.artifacts.find(item => item.value.id === row.item_id);
  if (!fact) throw new WatchStorageError("watch-projection-invalid", 503);
  const value = fact.value;
  const date = "sourceOccurredAt" in value ? value.sourceOccurredAt : undefined;
  if (!date || date.precision === "unknown" || date.value !== row.source_date) throw new WatchStorageError("watch-projection-invalid", 503);
  const type = "artifactType" in value ? ({ release: "software-release", paper: "paper-publication", dataset: "dataset-release", product: "product-release" } as const)[value.artifactType as "release"]
    : "policy-action";
  const title = "text" in value ? value.text.slice(0, 240) : value.nativeId + " " + value.version;
  const evidenceIds = new Set([...fact.evidenceIds, ...date.evidenceIds]);
  return WatchUpdate.parse({ id: await tupleKey("watch-update-v1", [record.id, value.id]), subjectId: record.id,
    subjectSlug: record.slug, subjectTitle: record.title, title: title.slice(0, 240),
    summary: "text" in value ? value.text : null, type, sourceOccurredAt: date,
    sources: record.sources.filter(item => evidenceIds.has(item.id)) });
}

/** Latest is a read of accepted projections, never a raw collection ledger.
 * Day-only values sort after instants on the same date as a stable display
 * convention, not a claim of within-day chronological precision. */
export async function readWatchUpdates(db: D1DatabaseLike, input: unknown, now = new Date()): Promise<WatchUpdatesResponse> {
  const query = Query.parse(input), at = CanonicalInstant.parse(now.toISOString()), current = await state(db);
  const cursor = query.cursor ? decode(query.cursor) : null;
  if (cursor && cursor.kind !== query.kind) throw new WatchStorageError("watch-cursor-filter-conflict", 400);
  const generation = cursor?.generation ?? current.generation;
  if (generation < current.minimum_generation) throw new WatchStorageError("watch-cursor-expired", 410);
  if (generation > current.generation) throw new WatchStorageError("watch-invalid-cursor", 400);
  const snapshot = await db.prepare("SELECT created_at FROM watch_generations WHERE generation=?").bind(generation).first<{ created_at: string | null }>();
  if (!snapshot) throw new WatchStorageError("watch-cursor-expired", 410);
  const position = cursor ? "AND (u.source_date<? OR (u.source_date=? AND (u.subject_id>? OR (u.subject_id=? AND u.item_id>?))))" : "";
  // Group ordinal, not guessed array position, binds each repeated native fact to
  // its exact manifest group. Current eligibility is evaluated before LIMIT.
  const result = await db.prepare(`WITH clock AS (SELECT ? AS instant,? AS day), facts AS MATERIALIZED (
    SELECT r.subject_id,r.valid_from,
      CASE json_extract(g.value,'$.field')
        WHEN 'latest-action' THEN json_extract(r.payload_json,'$.latestAction')
        ELSE json_extract(r.payload_json,CASE WHEN r.kind='policy' THEN '$.timeline[' ELSE '$.artifacts[' END ||
          (SELECT count(*) FROM json_each(m.manifest_json,'$.groups') prior
           WHERE prior.key<g.key AND json_extract(prior.value,'$.field')=json_extract(g.value,'$.field')) || ']') END AS fact,
      CASE WHEN json_extract(g.value,'$.field')='timeline-action' THEN 0 ELSE 1 END AS preference
    FROM watch_public_revisions r JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id
      CROSS JOIN clock JOIN json_each(m.manifest_json,'$.groups') g
    WHERE r.kind=? AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)
      AND NOT EXISTS(SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=r.subject_id)
      AND ${deliveryEligibleSql()} AND ${deliveryGroupCurrentSql()}
      AND ((r.kind='policy' AND json_extract(g.value,'$.field') IN ('timeline-action','latest-action'))
        OR (r.kind='technology' AND json_extract(g.value,'$.field')='artifact'))
  ), dated AS MATERIALIZED (
    SELECT *,json_extract(fact,'$.value.id') AS item_id,
      json_extract(fact,'$.value.sourceOccurredAt.value') AS source_date
    FROM facts CROSS JOIN clock WHERE
      ((json_extract(fact,'$.value.sourceOccurredAt.precision')='instant' AND json_extract(fact,'$.value.sourceOccurredAt.value')<=clock.instant)
       OR (json_extract(fact,'$.value.sourceOccurredAt.precision')='day' AND json_extract(fact,'$.value.sourceOccurredAt.value')<=clock.day))
      AND (json_extract(fact,'$.value.artifactType') IS NULL OR
        (json_extract(fact,'$.value.artifactType') IN ('release','paper','dataset','product') AND json_extract(fact,'$.value.availability')='public'))
  ), unique_items AS (
    SELECT *,row_number() OVER(PARTITION BY subject_id,item_id ORDER BY preference) AS duplicate FROM dated
  ), eligible AS MATERIALIZED (
    SELECT u.subject_id,u.valid_from,u.item_id,u.source_date,
      2*length(CAST(r.payload_json AS BLOB))+4*length(CAST(m.manifest_json AS BLOB))+32000 AS body_bytes
    FROM unique_items u JOIN watch_public_revisions r ON r.subject_id=u.subject_id AND r.valid_from=u.valid_from
      JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id
    WHERE duplicate=1 ${position} ORDER BY u.source_date DESC,u.subject_id,u.item_id LIMIT ?
  ), budgeted AS (
    SELECT *,row_number() OVER(ORDER BY source_date DESC,subject_id,item_id) AS ordinal,
      sum(body_bytes) OVER(ORDER BY source_date DESC,subject_id,item_id ROWS UNBOUNDED PRECEDING) AS total_bytes FROM eligible
  ), bounded AS (
    SELECT *,CASE WHEN ordinal<=? AND total_bytes<=2400000 THEN 1 ELSE 0 END AS has_body
    FROM budgeted WHERE ordinal<=1+(SELECT count(*) FROM budgeted WHERE ordinal<=? AND total_bytes<=2400000)
  )
  SELECT b.subject_id,b.item_id,b.source_date,b.has_body,
    CASE WHEN has_body=1 THEN r.payload_json END AS payload_json,
    CASE WHEN has_body=1 THEN r.payload_sha256 END AS payload_sha256,
    CASE WHEN has_body=1 THEN m.manifest_json END AS manifest_json,
    CASE WHEN has_body=1 THEN m.manifest_sha256 END AS manifest_sha256,
    CASE WHEN has_body=1 THEN ${deliveryValiditySql()} END AS group_validity
  FROM bounded b JOIN watch_public_revisions r ON r.subject_id=b.subject_id AND r.valid_from=b.valid_from
    JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id CROSS JOIN clock
  ORDER BY b.source_date DESC,b.subject_id,b.item_id`)
    .bind(at, deliveryEasternDay(at), query.kind, generation, generation,
      ...(cursor ? [cursor.date, cursor.date, cursor.subject, cursor.subject, cursor.item] : []), query.limit + 1, query.limit, query.limit).all<Row>();
  if (!Array.isArray(result.results) || ("success" in result && result.success === false)) throw new WatchStorageError("watch-unavailable", 503);
  const rows = result.results;
  if (rows.length > query.limit + 1 || rows.some(row => row.has_body !== 0 && row.has_body !== 1))
    throw new WatchStorageError("watch-projection-invalid", 503);
  const items: WatchUpdate[] = []; let last: Row | undefined, bytes = 4000;
  for (const row of rows) {
    if (!row.has_body) break;
    const item = await update(await shape(row, at), row), itemBytes = new TextEncoder().encode(JSON.stringify(item)).length + 1;
    if (bytes + itemBytes > MAX_WATCH_UPDATES_BYTES) break;
    bytes += itemBytes; items.push(item); last = row;
  }
  if (rows.length && !last) throw new WatchStorageError("watch-projection-invalid", 503);
  if (generation < (await state(db)).minimum_generation) throw new WatchStorageError("watch-cursor-expired", 410);
  return WatchUpdatesResponse.parse({ version: "watch-updates-1", kind: query.kind, generation, asOf: snapshot.created_at, items,
    nextCursor: rows.length > items.length && last ? encode({ version: 1, kind: query.kind, generation,
      date: last.source_date, subject: last.subject_id, item: last.item_id }) : null });
}
export async function handleWatchUpdatesRead(request: Request, env: { VALLEY_DESK_DB?: D1DatabaseLike; WATCH_PUBLIC_ENABLED?: string }): Promise<Response> {
  const respond = (status: number, payload: unknown, headers: Record<string, string> = {}) => new Response(request.method === "HEAD" ? null : JSON.stringify(payload),
    { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "no-store",
      "x-robots-tag": "noindex", "access-control-allow-origin": "*", ...headers } });
  const error = (status: number, code: string) => respond(status, { error: { code, message: status === 410 ? "This result snapshot has expired." : "Watch updates could not be returned." } });
  if (request.method !== "GET" && request.method !== "HEAD") return respond(405, { error: { code: "watch-method-not-allowed" } }, { allow: "GET, HEAD" });
  const url = new URL(request.url), match = /^\/api\/v2\/watch\/(policy|technology)\/updates\/?$/.exec(url.pathname);
  if (!match) return error(404, "watch-not-found");
  if (env.WATCH_PUBLIC_ENABLED !== "true" || !env.VALLEY_DESK_DB) return error(503, "watch-not-enabled");
  try {
    if (url.searchParams.toString().length > 4096) return error(400, "watch-invalid-query");
    const values: Record<string, string> = Object.create(null);
    for (const [key, value] of url.searchParams) {
      if (!["cursor", "limit"].includes(key) || Object.hasOwn(values, key)) return error(400, "watch-invalid-query");
      values[key] = value;
    }
    return respond(200, await readWatchUpdates(env.VALLEY_DESK_DB, { ...values, kind: match[1] }));
  } catch (failure) {
    if (failure instanceof z.ZodError) return error(400, "watch-invalid-query");
    if (failure instanceof WatchStorageError) return error(failure.status, failure.code);
    return error(503, "watch-unavailable");
  }
}
