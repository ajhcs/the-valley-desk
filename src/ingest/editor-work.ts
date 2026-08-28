import type { ContentItem } from "../content/schema";
import { contentPriorityFields, selectPriorityWork, summarizeQueueSla, type QueueSlaMetrics } from "./queue";
import { isOfficialChapterEvent } from "../content/publication";
import { matchingProductUses } from "./product-watch";
import {
  DEFAULT_EDITOR_LANE_BUDGETS,
  DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
  EDITOR_LANE_ORDER,
  MAX_EDITOR_LANE_BUDGET,
  MAX_EDITOR_LANE_TOTAL_BUDGET,
  editorLaneForItem,
  type EditorLane,
  type EditorLaneBudgets,
} from "./editor-lanes";

export {
  DEFAULT_EDITOR_LANE_BUDGETS,
  DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
  EDITOR_LANE_ORDER,
  MAX_EDITOR_LANE_BUDGET,
  MAX_EDITOR_LANE_TOTAL_BUDGET,
  editorLaneForItem,
};
export type { EditorLane, EditorLaneBudgets } from "./editor-lanes";

export const DEFAULT_EDITOR_MODEL_BUDGET = 4;
export const DEFAULT_EDITOR_MODEL_CONCURRENCY = 2;
export const DEFAULT_EDITOR_MODEL_DEADLINE_MS = 110_000;
export const DEFAULT_FAILURE_COOLDOWN_HOURS = 6;
export const MAX_FAILURE_COOLDOWN_HOURS = 24 * 7;
export const MAX_EDITOR_MODEL_BUDGET = MAX_EDITOR_LANE_TOTAL_BUDGET;
export const MAX_EDITOR_MODEL_CONCURRENCY = 4;

export type EditorModelState = {
  id: string;
  fingerprint: string;
  enrichmentFingerprint: string | null;
  outcome: string | null;
  attemptedAt: string | null;
  attemptCount: number;
  firstSeenAt: string | null;
  contentChangedAt?: string | null;
  lastSeenAt?: string | null;
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
  if (record?.queueStatus === "approved") return false;
  if (record?.queueStatus === "rejected" && sameAttemptFingerprint(record, contentFingerprint)) return false;
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
  const toFields = (rows: typeof eligible) => rows.map(({ item, fingerprint }) => (
    contentPriorityFields(
      item,
      records.get(item.id)?.firstSeenAt ?? now.toISOString(),
      now,
      records.get(item.id)?.contentChangedAt
        ?? (records.get(item.id) && !sameAttemptFingerprint(records.get(item.id)!, fingerprint) ? now.toISOString() : undefined),
    )
  ));
  // Never split fresh and retrying rows into separate passes: doing so lets a
  // stale never-attempted row consume the slot that a fresh retry needs.
  const selectedWork = selectPriorityWork(toFields(eligible), limit, now);
  const selected = selectedWork.selected;
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

export type EditorLaneWorkItem = {
  item: ContentItem;
  fingerprint: string;
};

export type EditorLaneSelectionMetrics = QueueSlaMetrics & {
  lane: EditorLane;
  budget: number;
};

export type EditorLaneSelectionResult = {
  items: ContentItem[];
  selectedByLane: Record<EditorLane, ContentItem[]>;
  metricsByLane: Record<EditorLane, EditorLaneSelectionMetrics>;
  eligibleByLane: Record<EditorLane, number>;
  totalBudget: number;
};

export type EditorLaneSelectionOptions = {
  laneBudgets?: Partial<EditorLaneBudgets>;
  totalBudget?: number;
  now?: Date;
  reusableIds?: Set<string>;
};

function boundedLaneBudget(value: number | undefined, fallback: number) {
  return parseBoundedInt(value, fallback, 0, MAX_EDITOR_LANE_BUDGET);
}

function laneBudgetMap(options: EditorLaneSelectionOptions) {
  const budgets = {} as EditorLaneBudgets;
  for (const lane of EDITOR_LANE_ORDER) {
    budgets[lane] = boundedLaneBudget(
      options.laneBudgets?.[lane],
      DEFAULT_EDITOR_LANE_BUDGETS[lane],
    );
  }
  return budgets;
}

/**
 * Select editor work by specialist lane while retaining the existing
 * eligibility, failure backoff, freshness, and source-origin fairness rules.
 *
 * Each lane first selects its own priority-ordered pool up to its quota. The
 * pools are then interleaved round-robin: every non-empty lane receives its
 * first available slot before a lane receives a second. If a lane has fewer
 * eligible rows than its quota, its unused capacity naturally redistributes to
 * the other lanes. The totalBudget is an independent hard ceiling.
 */
export function selectEditorModelWorkWithLanes(
  items: EditorLaneWorkItem[],
  records: Map<string, EditorModelState>,
  options: EditorLaneSelectionOptions = {},
): EditorLaneSelectionResult {
  const now = options.now ?? new Date();
  const budgets = laneBudgetMap(options);
  const totalBudget = parseBoundedInt(
    options.totalBudget,
    DEFAULT_EDITOR_LANE_TOTAL_BUDGET,
    0,
    MAX_EDITOR_LANE_TOTAL_BUDGET,
  );
  const pools = {} as Record<EditorLane, ContentItem[]>;
  const metricsByLane = {} as Record<EditorLane, EditorLaneSelectionMetrics>;
  const eligibleByLane = {} as Record<EditorLane, number>;

  for (const lane of EDITOR_LANE_ORDER) {
    const laneItems = items.filter(({ item }) => editorLaneForItem(item) === lane);
    const selected = selectEditorModelWorkWithMetrics(
      laneItems,
      records,
      totalBudget,
      now,
      options.reusableIds,
    );
    pools[lane] = selected.items;
    eligibleByLane[lane] = selected.metrics.eligibleCount;
    metricsByLane[lane] = {
      lane,
      budget: budgets[lane],
      ...selected.metrics,
      // The per-lane selection is only a pool; the final interleaving below
      // may trim it to the global hard ceiling.
      selectedCount: 0,
    };
  }

  const selectedByLane = {} as Record<EditorLane, ContentItem[]>;
  for (const lane of EDITOR_LANE_ORDER) selectedByLane[lane] = [];
  const selected: ContentItem[] = [];
  // Phase one reserves each specialist's configured quota. Round-robin keeps
  // every non-empty lane moving before a busy lane receives another slot.
  let round = 0;
  while (selected.length < totalBudget) {
    let added = false;
    for (const lane of EDITOR_LANE_ORDER) {
      if (round >= budgets[lane]) continue;
      const candidate = pools[lane][round];
      if (!candidate) continue;
      selected.push(candidate);
      selectedByLane[lane].push(candidate);
      added = true;
      if (selected.length >= totalBudget) break;
    }
    if (!added) break;
    round += 1;
  }

  // Phase two lends unused reservations to lanes that still have eligible
  // work. This lets an all-News cycle consume the complete global budget
  // without allowing News to starve policy, finance, events, or other desks
  // when those specialists have candidates waiting.
  while (selected.length < totalBudget) {
    let added = false;
    for (const lane of EDITOR_LANE_ORDER) {
      const candidate = pools[lane][selectedByLane[lane].length];
      if (!candidate) continue;
      selected.push(candidate);
      selectedByLane[lane].push(candidate);
      added = true;
      if (selected.length >= totalBudget) break;
    }
    if (!added) break;
  }

  for (const lane of EDITOR_LANE_ORDER) {
    const laneSelected = selectedByLane[lane];
    metricsByLane[lane] = {
      ...metricsByLane[lane],
      selectedCount: laneSelected.length,
    };
  }
  return { items: selected, selectedByLane, metricsByLane, eligibleByLane, totalBudget };
}

/** Short alias for scheduler callers. */
export const selectEditorModelWorkByLane = selectEditorModelWorkWithLanes;
