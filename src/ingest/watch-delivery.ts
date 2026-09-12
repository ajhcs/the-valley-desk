import { z } from "zod";
import { CanonicalInstant, Sha256, WatchId, canonicalJson, sha256 } from "../content/watch-schema";
import { DeliveryDependencyKind, WatchDeliveryManifest, compiledWatchDeliveryValue, validateDeliveryBinding } from "../content/watch-delivery";
import type { CompiledWatchDelivery } from "../content/watch-delivery";
import type { D1DatabaseLike } from "./persistence";

export const WatchDependencyHead = z.object({ key: WatchId, kind: DeliveryDependencyKind,
  revision: z.number().int().positive().safe(), digest: Sha256.nullable(), immutableRecordId: WatchId, changedAt: CanonicalInstant }).strict();
export type WatchDependencyHead = z.infer<typeof WatchDependencyHead>;

// Internal qualified-record writer, not HTTP input or raw collector authorization.
// A null digest is an explicit retained retraction, never deletion or a new approval.
export async function recordWatchDependencyHead(db: D1DatabaseLike, input: unknown) {
  const value = WatchDependencyHead.parse(input);
  const stored = await db.prepare(`SELECT dependency_key AS key,kind,revision,digest,immutable_record_id AS immutableRecordId,
    changed_at AS changedAt FROM watch_dependency_heads WHERE dependency_key=?`).bind(value.key).first<WatchDependencyHead>();
  const previous = stored ? WatchDependencyHead.parse(stored) : null;
  if (previous && canonicalJson(previous) === canonicalJson(value)) return { outcome: "unchanged" as const };
  if (previous && (value.kind !== previous.kind || value.revision <= previous.revision || value.changedAt < previous.changedAt))
    throw new Error("watch-dependency-revision-conflict");
  try {
    await db.batch([
      db.prepare("INSERT INTO watch_dependency_records VALUES(?,?,?,?,?,?)")
        .bind(value.immutableRecordId, value.key, value.kind, value.revision, value.digest, value.changedAt),
      db.prepare(`INSERT INTO watch_dependency_heads VALUES(?,?,?,?,?,?) ON CONFLICT(dependency_key) DO UPDATE SET
        revision=excluded.revision,digest=excluded.digest,immutable_record_id=excluded.immutable_record_id,changed_at=excluded.changed_at`)
        .bind(value.key, value.kind, value.revision, value.digest, value.immutableRecordId, value.changedAt),
    ]);
  } catch (error) {
    const current = await db.prepare(`SELECT dependency_key AS key,kind,revision,digest,immutable_record_id AS immutableRecordId,
      changed_at AS changedAt FROM watch_dependency_heads WHERE dependency_key=?`).bind(value.key).first<WatchDependencyHead>();
    if (current && canonicalJson(WatchDependencyHead.parse(current)) === canonicalJson(value)) return { outcome: "unchanged" as const };
    throw error;
  }
  return { outcome: "recorded" as const };
}
export async function persistCompiledWatchDelivery(db: D1DatabaseLike, decisionId: string, compiled: CompiledWatchDelivery) {
  WatchId.parse(decisionId);
  const { manifest, record } = compiledWatchDeliveryValue(compiled);
  await validateDeliveryBinding(record, manifest);
  const review = await db.prepare(`SELECT subject_id,payload_sha256,gate_version,input_revision,reviewed_at
    FROM watch_reviewed_projections WHERE id=?`).bind(decisionId).first<{
    subject_id: string; payload_sha256: string; gate_version: string; input_revision: number; reviewed_at: string }>();
  if (!review || review.subject_id !== manifest.subjectId || review.payload_sha256 !== manifest.payloadSha256 ||
      review.gate_version !== manifest.gateVersion || review.input_revision !== manifest.inputRevision || review.reviewed_at < manifest.acceptedAt)
    throw new Error("watch-delivery-review-binding-conflict");
  const json = canonicalJson(WatchDeliveryManifest.parse(manifest)), digest = await sha256(json);
  const previous = await db.prepare("SELECT manifest_sha256 FROM watch_delivery_manifests WHERE decision_id=?").bind(decisionId).first<{ manifest_sha256: string }>();
  if (previous) {
    if (previous.manifest_sha256 !== digest) throw new Error("watch-delivery-manifest-conflict");
    return { outcome: "unchanged" as const };
  }
  try {
    await db.prepare("INSERT INTO watch_delivery_manifests VALUES(?,?,?,?,?,?,?)")
      .bind(decisionId, manifest.subjectId, manifest.kind, manifest.payloadSha256, manifest.gateVersion, digest, json).run();
  } catch (error) {
    const concurrent = await db.prepare("SELECT manifest_sha256 FROM watch_delivery_manifests WHERE decision_id=?")
      .bind(decisionId).first<{ manifest_sha256: string }>();
    if (concurrent?.manifest_sha256 === digest) return { outcome: "unchanged" as const };
    throw error;
  }
  return { outcome: "recorded" as const };
}

// SQL identifiers below are internal fixed aliases, never caller-controlled strings.
export function deliveryGroupCurrentSql(group = "g", instant = "clock.instant", day = "clock.day") {
  return `(json_array_length(${group}.value,'$.dependencies') BETWEEN 1 AND 400
    AND NOT EXISTS (SELECT 1 FROM json_each(${group}.value,'$.dependencies') dep
      LEFT JOIN watch_dependency_heads head ON head.dependency_key=json_extract(dep.value,'$.key')
      WHERE head.dependency_key IS NULL OR head.kind<>json_extract(dep.value,'$.kind') OR head.digest IS NULL
        OR head.digest<>json_extract(dep.value,'$.expectedDigest') OR head.changed_at>${instant}
        OR EXISTS (SELECT 1 FROM watch_dependency_expirations expiry
          WHERE expiry.dependency_key=head.dependency_key AND expiry.valid_until<=${instant}))
    AND (json_extract(${group}.value,'$.groupType')<>'local' OR (
      json_extract(${group}.value,'$.local.checkedAt')<=${instant}
      AND (json_extract(${group}.value,'$.local.validFrom') IS NULL OR json_extract(${group}.value,'$.local.validFrom')<=${day})
      AND (json_extract(${group}.value,'$.local.temporalStatus')='historical' OR
        (json_extract(${group}.value,'$.local.validThrough') IS NOT NULL AND ${instant}<json_extract(${group}.value,'$.local.validThrough')
          AND json_extract(${group}.value,'$.regionalTerm.validFrom')<=${day}
          AND (json_extract(${group}.value,'$.regionalTerm.validTo') IS NULL OR ${day}<json_extract(${group}.value,'$.regionalTerm.validTo')))))))`;
}
export function deliveryFieldCurrentSql(field: string) {
  return `EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g WHERE json_extract(g.value,'$.field')='${field}' AND ${deliveryGroupCurrentSql()})`;
}
export function deliveryEligibleSql() {
  return `(m.decision_id IS NOT NULL AND m.subject_id=r.subject_id AND m.kind=r.kind AND m.payload_sha256=r.payload_sha256
    AND ${deliveryFieldCurrentSql("title")} AND (r.kind<>'policy' OR ${deliveryFieldCurrentSql("identity")})
    AND (r.kind<>'technology' OR (${deliveryFieldCurrentSql("resource-type")} AND ${deliveryFieldCurrentSql("artifact")} AND ${deliveryFieldCurrentSql("local-relationship")}))
    AND NOT EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
      WHERE json_extract(g.value,'$.groupType') IN ('required','artifact') AND NOT ${deliveryGroupCurrentSql()}))`;
}
export function deliveryValiditySql() {
  return `(SELECT json_group_object(json_extract(g.value,'$.key'),CASE WHEN ${deliveryGroupCurrentSql()} THEN 1 ELSE 0 END)
    FROM json_each(m.manifest_json,'$.groups') g)`;
}
export function deliveryOssSql() {
  return `EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g WHERE json_extract(g.value,'$.groupType')='license'
    AND json_extract(g.value,'$.license.scope')='code' AND json_extract(g.value,'$.license.classification')='osi-open-source'
    AND ${deliveryGroupCurrentSql()} AND EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') a
      WHERE json_extract(a.value,'$.artifact.id')=json_extract(g.value,'$.license.artifactId')
        AND json_extract(a.value,'$.artifact.version')=json_extract(g.value,'$.license.artifactVersion')
        AND json_extract(a.value,'$.artifact.availability')='public' AND ${deliveryGroupCurrentSql("a")}))`;
}
