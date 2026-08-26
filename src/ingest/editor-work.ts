import type { ContentItem } from "../content/schema";
import { contentPriorityFields, selectPriorityWork, summarizeQueueSla, type QueueSlaMetrics } from "./queue";
import { isOfficialChapterEvent } from "../content/publication";
import { matchingProductUses } from "./product-watch";

export const DEFAULT_EDITOR_MODEL_BUDGET = 4;
export const DEFAULT_EDITOR_MODEL_CONCURRENCY = 2;
export const DEFAULT_EDITOR_MODEL_DEADLINE_MS = 40_000;
export const DEFAULT_FAILURE_COOLDOWN_HOURS = 6;
export const MAX_FAILURE_COOLDOWN_HOURS = 24 * 7;
export const MAX_EDITOR_MODEL_BUDGET = 20;
export const MAX_EDITOR_MODEL_CONCURRENCY = 4;

export type EditorModelState = {
  id: string;
  fingerprint: string;
  enrichmentFingerprint: string | null;
  outcome: string | null;
  attemptedAt: string | null;
  attemptCount: number;
  firstSeenAt: string | null;
  queueStatus: string | null;
  hasSuccessfulEnrichment: boolean;
};

/** Official chapter events publish from deterministic rules and never spend model budget. */
export function shouldEnrichCandidate(item: ContentItem) {
  if (isOfficialChapterEvent(item)) return false;
  return item.kind === "event" || item.orgs.length > 0 || matchingProductUses(item).length > 0;
}

export function editorModelBackoffMs(
  attemptCount: number,
  baseHours = DEFAULT_FAILURE_COOLDOWN_HOURS,
) {
  const safeCount = Math.max(1, Math.trunc(attemptCount) || 1);
  const hours = Math.min(MAX_FAILURE_COOLDOWN_HOURS, baseHours * (2 ** (safeCount - 1)));
  return hours * 60 * 60 * 1000;
}

export function parseBoundedInt(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function sameAttemptFingerprint(record: EditorModelState, contentFingerprint: string) {
  if (record.enrichmentFingerprint) return record.enrichmentFingerprint === contentFingerprint;
  return record.fingerprint === contentFingerprint;
}

export function isEditorModelEligible(
  item: ContentItem,
  contentFingerprint: string,
  record: EditorModelState | undefined,
  now: Date,
  reusableIds?: Set<string>,
) {
  if (!shouldEnrichCandidate(item)) return false;
  if (record?.queueStatus === "approved" || record?.queueStatus === "rejected") return false;
  if (reusableIds?.has(item.id)) return false;
  if (!record) return true;
  if (!sameAttemptFingerprint(record, contentFingerprint)) return true;
  if (record.outcome === "success") return false;
  if (record.outcome !== "failure" && record.hasSuccessfulEnrichment) return false;
  if (!record.attemptedAt) return true;
  const elapsed = now.getTime() - Date.parse(record.attemptedAt);
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= editorModelBackoffMs(record.attemptCount);
}

export function selectEditorModelWorkWithMetrics(
  items: Array<{ item: ContentItem; fingerprint: string }>,
  records: Map<string, EditorModelState>,
  budget: number,
  now = new Date(),
  reusableIds?: Set<string>,
): { items: ContentItem[]; metrics: QueueSlaMetrics } {
  const eligible = items.filter(({ item, fingerprint }) => (
    isEditorModelEligible(item, fingerprint, records.get(item.id), now, reusableIds)
  ));
  const limit = parseBoundedInt(budget, DEFAULT_EDITOR_MODEL_BUDGET, 0, MAX_EDITOR_MODEL_BUDGET);
  const neverAttempted = eligible.filter(({ item, fingerprint }) => {
    const record = records.get(item.id);
    return !record?.attemptedAt || !sameAttemptFingerprint(record, fingerprint);
  });
  const retrying = eligible.filter((row) => !neverAttempted.includes(row));
  const toFields = (rows: typeof eligible) => rows.map(({ item }) => (
    contentPriorityFields(item, records.get(item.id)?.firstSeenAt ?? now.toISOString())
  ));
  const firstPass = selectPriorityWork(toFields(neverAttempted), limit, now);
  const remaining = limit - firstPass.selected.length;
  const secondPass = remaining > 0 ? selectPriorityWork(toFields(retrying), remaining, now) : { selected: [] as ContentItem[] };
  const selected = [...firstPass.selected, ...secondPass.selected];
  const selectedIds = new Set(selected.map((item) => item.id));
  const selectedFields = toFields(eligible).filter((row) => selectedIds.has(row.id));
  return {
    items: selected,
    metrics: summarizeQueueSla(toFields(eligible), selectedFields, now),
  };
}

export function selectEditorModelWork(
  items: Array<{ item: ContentItem; fingerprint: string }>,
  records: Map<string, EditorModelState>,
  budget: number,
  now = new Date(),
  reusableIds?: Set<string>,
) {
  return selectEditorModelWorkWithMetrics(items, records, budget, now, reusableIds).items;
}
