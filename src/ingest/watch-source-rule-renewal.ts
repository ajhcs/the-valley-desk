import { tupleKey } from "../content/watch-schema";
import type { D1DatabaseLike } from "./persistence";

/** Only a fresh, fully reverified technology proposal may use this check.
 * Explicit revocation is not equivalent to routine raw-capture invalidation. */
export async function sourceRuleMayRenewTechnologyDependency(db: D1DatabaseLike, subjectId: string,
  dependency: { kind: string; key: string }, head: { digest: string | null; immutable_record_id: string; changed_at: string }) {
  if (!["artifact", "artifact-license", "local-relationship", "regional-current"].includes(dependency.kind)) return false;
  if (head.digest !== null) return true;
  if (!["artifact", "artifact-license"].includes(dependency.kind)) return false;
  // A machine invalidation has a content-bound identity. Looking immediately
  // before the head change bounds work and never treats a manual null as proof.
  const rows = await db.prepare(`SELECT id FROM technology_source_representations
    WHERE subject_id=? AND checked_at<=? ORDER BY checked_at DESC,id LIMIT 32`)
    .bind(subjectId, head.changed_at).all<{ id: string }>();
  if (!Array.isArray(rows.results) || ("success" in rows && rows.success === false)) return false;
  for (const row of rows.results) {
    if (await tupleKey("technology-retraction-v1", [row.id, dependency.key]) === head.immutable_record_id) return true;
  }
  return false;
}
