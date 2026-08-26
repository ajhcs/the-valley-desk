import type { ContentItem } from "../content/schema";
import { matchingProductUses } from "./product-watch";

export const DEFAULT_EDITOR_MODEL_BUDGET = 4;
export const DEFAULT_EDITOR_MODEL_CONCURRENCY = 2;
export const DEFAULT_EDITOR_MODEL_DEADLINE_MS = 40_000;
export const DEFAULT_FAILURE_COOLDOWN_HOURS = 6;
export const MAX_FAILURE_COOLDOWN_HOURS = 24 * 7;
export const MAX_EDITOR_MODEL_BUDGET = 20;
export const MAX_EDITOR_MODEL_CONCURRENCY = 4;

const OFFICIAL_CHAPTER_ORIGINS = new Set(["dvhimss-events", "njhimss-events"]);

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

export function isOfficialChapterEvent(item: ContentItem) {
  return item.kind === "event" && OFFICIAL_CHAPTER_ORIGINS.has(item.source.origin);
}

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

export function selectEditorModelWork(
  items: Array<{ item: ContentItem; fingerprint: string }>,
  records: Map<string, EditorModelState>,
  budget: number,
  now = new Date(),
  reusableIds?: Set<string>,
) {
  const eligible = items.filter(({ item, fingerprint }) => (
    isEditorModelEligible(item, fingerprint, records.get(item.id), now, reusableIds)
  ));
  const newItemSeenAt = now.getTime();
  eligible.sort((a, b) => {
    const ra = records.get(a.item.id);
    const rb = records.get(b.item.id);
    const neverA = !ra?.attemptedAt || !sameAttemptFingerprint(ra, a.fingerprint);
    const neverB = !rb?.attemptedAt || !sameAttemptFingerprint(rb, b.fingerprint);
    if (neverA !== neverB) return neverA ? -1 : 1;
    if (neverA && neverB) {
      const ta = Date.parse(ra?.firstSeenAt ?? "") || newItemSeenAt;
      const tb = Date.parse(rb?.firstSeenAt ?? "") || newItemSeenAt;
      if (ta !== tb) return ta - tb;
      return a.item.id.localeCompare(b.item.id);
    }
    const ta = Date.parse(ra?.attemptedAt ?? "") || 0;
    const tb = Date.parse(rb?.attemptedAt ?? "") || 0;
    if (ta !== tb) return ta - tb;
    return a.item.id.localeCompare(b.item.id);
  });
  const limit = parseBoundedInt(budget, DEFAULT_EDITOR_MODEL_BUDGET, 0, MAX_EDITOR_MODEL_BUDGET);
  return eligible.slice(0, limit).map((row) => row.item);
}
