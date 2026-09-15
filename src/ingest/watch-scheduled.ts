import { CanonicalInstant } from "../content/watch-schema";
import { WatchDeliveryError } from "../content/watch-delivery";
import { WatchProjectionError } from "../content/watch-projection";
import type { D1DatabaseLike } from "./persistence";
import { decideSourceRuleProposal } from "./watch-editorial";
import { createWatchEditorialRuntime } from "./watch-editorial-runtime";
import { WatchStorageError } from "./watch-persistence";
import { WatchOperationBudgetError, watchOperationBudget } from "./watch-operation-budget";
import { runWatchCollection } from "./watch/collector";

export const WATCH_CRON = "2-57/5 * * * *";
export function watchSchedulePhase(scheduledTime: number): "collection" | "publication" {
  if (!Number.isFinite(scheduledTime)) throw new Error("watch-invalid-scheduled-time");
  const minute = new Date(scheduledTime).getUTCMinutes();
  if (minute % 10 === 2) return "collection";
  if (minute % 10 === 7) return "publication";
  throw new Error("watch-invalid-scheduled-time");
}

/** The collector's bounded lease/state writes use the unwrapped database so a
 * source exhausting its allowance still gets a failure/backoff and releases its lease. */
export async function runScheduledWatchCollection(db: D1DatabaseLike, options: {
  enabled: boolean; publishRepresentatives?: boolean; clock?: () => Date; fetchImpl?: typeof fetch;
}) {
  const budget = watchOperationBudget(db);
  const result = await runWatchCollection(db, { ...options, maxSources: 1, sourceDatabase: budget.db });
  return { ...result, operations: budget.used };
}

/** One candidate per invocation, with a persistent wraparound cursor. Held
 * records remain reviewable but cannot monopolize subsequent dispatches. */
export async function runScheduledWatchPublication(db: D1DatabaseLike, options: { enabled: boolean; now?: Date }) {
  if (!options.enabled) return { outcome: "disabled" as const, operations: 0 };
  const now = options.now ?? new Date(), at = CanonicalInstant.parse(now.toISOString());
  const owner = crypto.randomUUID(), expires = new Date(now.getTime() + 120_000).toISOString();
  await db.prepare("UPDATE watch_source_rule_dispatch SET lease_owner=?,lease_expires_at=? WHERE id='default' AND (lease_owner IS NULL OR lease_expires_at<=?)")
    .bind(owner, expires, at).run();
  const state = await db.prepare("SELECT after_draft_id,lease_owner FROM watch_source_rule_dispatch WHERE id='default'")
    .first<{ after_draft_id: string; lease_owner: string | null }>();
  if (!state) throw new Error("watch-publication-dispatch-state-missing");
  if (state.lease_owner !== owner) return { outcome: "locked" as const, operations: 0 };
  const budget = watchOperationBudget(db);
  let cursor = state.after_draft_id;
  try {
    const next = (after: string) => db.prepare(`SELECT d.id,d.input_sha256 FROM watch_editorial_drafts d
      JOIN watch_subjects s ON s.id=d.subject_id AND s.input_revision=d.subject_revision AND s.input_sha256=d.input_sha256
      LEFT JOIN watch_editorial_decisions r ON r.draft_id=d.id
      LEFT JOIN watch_publication_decisions p ON p.decision_id=r.id
      WHERE (r.id IS NULL OR (r.action='accepted' AND r.reviewer_principal='source-rule:watch-native-source-rule-v1' AND p.decision_id IS NULL))
        AND d.id>? ORDER BY d.id LIMIT 1`).bind(after).first<{ id: string; input_sha256: string }>();
    const candidate = await next(cursor) ?? (cursor ? await next("") : null);
    if (!candidate) return { outcome: "idle" as const, operations: budget.used };
    cursor = candidate.id;
    try {
      const result = await decideSourceRuleProposal(budget.db, { id: candidate.id, sha256: candidate.input_sha256 },
        createWatchEditorialRuntime(budget.db), now);
      return { outcome: result.outcome, draftId: candidate.id, operations: budget.used };
    } catch (error) {
      const held = error instanceof WatchOperationBudgetError || error instanceof WatchStorageError ||
        error instanceof WatchProjectionError || error instanceof WatchDeliveryError;
      return { outcome: held ? "held" as const : "failed" as const, draftId: candidate.id, operations: budget.used,
        reason: error instanceof Error ? error.message.slice(0, 200) : "watch-publication-failed" };
    }
  } finally {
    await db.prepare("UPDATE watch_source_rule_dispatch SET after_draft_id=?,lease_owner=NULL,lease_expires_at=NULL WHERE id='default' AND lease_owner=?")
      .bind(cursor, owner).run();
  }
}
