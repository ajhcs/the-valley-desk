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

/**
 * Freshness classes are intentionally separate from specialist lanes. A
 * current social Voice and a current News item may use different lanes, but
 * both must be able to claim capacity ahead of an older review row.
 */
export const EDITOR_WORK_PRIORITY_ORDER = [
  "current-news",
  "time-sensitive-events",
  "current-social",
  "backlog",
] as const;

export type EditorWorkPriority = (typeof EDITOR_WORK_PRIORITY_ORDER)[number];
export type EditorWorkPriorityReservations = Partial<Record<EditorWorkPriority, number>>;

/** Default minimum pools for a normal 32-item editor pass. */
export const DEFAULT_EDITOR_WORK_PRIORITY_RESERVATIONS: Record<Exclude<EditorWorkPriority, "backlog">, number> = {
  "current-news": 4,
  "time-sensitive-events": 4,
  "current-social": 4,
};

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
  priority?: EditorWorkPriority;
};

export type EditorLaneSelectionMetrics = QueueSlaMetrics & {
  lane: EditorLane;
  budget: number;
};

export type EditorLaneSelectionResult = {
  items: ContentItem[];
  selectedByLane: Record<EditorLane, ContentItem[]>;
  selectedByPriority: Record<EditorWorkPriority, ContentItem[]>;
  metricsByLane: Record<EditorLane, EditorLaneSelectionMetrics>;
  eligibleByLane: Record<EditorLane, number>;
  totalBudget: number;
};

export type EditorLaneSelectionOptions = {
  laneBudgets?: Partial<EditorLaneBudgets>;
  totalBudget?: number;
  now?: Date;
  reusableIds?: Set<string>;
  priorityReservations?: EditorWorkPriorityReservations;
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

function priorityOf(item: EditorLaneWorkItem) {
  return item.priority ?? "backlog";
}

function priorityReservationMap(options: EditorLaneSelectionOptions) {
  const reservations = {} as Record<EditorWorkPriority, number>;
  for (const priority of EDITOR_WORK_PRIORITY_ORDER) {
    const fallback = priority === "backlog"
      ? 0
      : DEFAULT_EDITOR_WORK_PRIORITY_RESERVATIONS[priority];
    reservations[priority] = parseBoundedInt(
      options.priorityReservations?.[priority],
      fallback,
      0,
      MAX_EDITOR_LANE_TOTAL_BUDGET,
    );
  }
  return reservations;
}

function reservePriorityWork(
  items: EditorLaneWorkItem[],
  records: Map<string, EditorModelState>,
  options: EditorLaneSelectionOptions,
  budgets: EditorLaneBudgets,
  totalBudget: number,
  now: Date,
) {
  const selected: ContentItem[] = [];
  const selectedIds = new Set<string>();
  if (!options.priorityReservations || totalBudget === 0) return { selected, selectedIds };
  const reservations = priorityReservationMap(options);
  const addFromPriority = (priority: EditorWorkPriority, count: number) => {
    if (count <= 0 || selected.length >= totalBudget) return;
    const candidates = items.filter((row) => (
      priorityOf(row) === priority
      && !selectedIds.has(row.item.id)
      && budgets[editorLaneForItem(row.item)] > 0
    ));
    const picked = selectEditorModelWorkWithMetrics(
      candidates,
      records,
      Math.min(count, totalBudget - selected.length),
      now,
      options.reusableIds,
    ).items;
    for (const item of picked) {
      if (selected.length >= totalBudget || selectedIds.has(item.id)) break;
      selected.push(item);
      selectedIds.add(item.id);
    }
  };

  // Give each non-empty requested class one slot first. This matters when an
  // operator lowers the total budget below the sum of the configured pools.
  for (const priority of EDITOR_WORK_PRIORITY_ORDER) {
    if (reservations[priority] <= 0) continue;
    addFromPriority(priority, 1);
  }
  // Spend the rest of each requested reservation in deterministic order.
  for (const priority of EDITOR_WORK_PRIORITY_ORDER) {
    addFromPriority(priority, reservations[priority] - 1);
  }
  return { selected, selectedIds };
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
  const reservedPools = {} as Record<EditorLane, ContentItem[]>;
  const pools = {} as Record<EditorLane, ContentItem[]>;
  const metricsByLane = {} as Record<EditorLane, EditorLaneSelectionMetrics>;
  const eligibleByLane = {} as Record<EditorLane, number>;
  const selectedByLane = {} as Record<EditorLane, ContentItem[]>;
  for (const lane of EDITOR_LANE_ORDER) selectedByLane[lane] = [];
  const selected: ContentItem[] = [];
  const priorityReservation = reservePriorityWork(items, records, options, budgets, totalBudget, now);
  const selectedIds = priorityReservation.selectedIds;
  for (const item of priorityReservation.selected) {
    selected.push(item);
    selectedByLane[editorLaneForItem(item)].push(item);
  }

  for (const lane of EDITOR_LANE_ORDER) {
    const laneItems = items.filter(({ item }) => editorLaneForItem(item) === lane && !selectedIds.has(item.id));
    const reserved = selectEditorModelWorkWithMetrics(
      laneItems,
      records,
      budgets[lane],
      now,
      options.reusableIds,
    );
    const expanded = selectEditorModelWorkWithMetrics(
      laneItems,
      records,
      totalBudget,
      now,
      options.reusableIds,
    );
    reservedPools[lane] = reserved.items;
    pools[lane] = budgets[lane] > 0 ? expanded.items : [];
    eligibleByLane[lane] = expanded.metrics.eligibleCount;
    metricsByLane[lane] = {
      lane,
      budget: budgets[lane],
      ...expanded.metrics,
      // The per-lane selection is only a pool; the final interleaving below
      // may trim it to the global hard ceiling.
      selectedCount: 0,
    };
  }

  // Phase one reserves each specialist's configured quota. Round-robin keeps
  // every non-empty lane moving before a busy lane receives another slot.
  let round = 0;
  while (selected.length < totalBudget) {
    let added = false;
    for (const lane of EDITOR_LANE_ORDER) {
      if (round >= budgets[lane]) continue;
      const candidate = reservedPools[lane][round];
      if (!candidate) continue;
      selected.push(candidate);
      selectedByLane[lane].push(candidate);
      selectedIds.add(candidate.id);
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
  const poolCursor = Object.fromEntries(EDITOR_LANE_ORDER.map((lane) => [lane, 0])) as Record<EditorLane, number>;
  while (selected.length < totalBudget) {
    let added = false;
    for (const lane of EDITOR_LANE_ORDER) {
      if (budgets[lane] === 0) continue;
      let candidate = pools[lane][poolCursor[lane]++];
      while (candidate && selectedIds.has(candidate.id)) {
        candidate = pools[lane][poolCursor[lane]++];
      }
      if (!candidate) continue;
      selected.push(candidate);
      selectedByLane[lane].push(candidate);
      selectedIds.add(candidate.id);
      added = true;
      if (selected.length >= totalBudget) break;
    }
    if (!added) break;
  }

  for (const lane of EDITOR_LANE_ORDER) {
    const laneSelected = selectedByLane[lane];
    const selectedOriginCounts: Record<string, number> = {};
    for (const item of laneSelected) {
      selectedOriginCounts[item.source.origin] = (selectedOriginCounts[item.source.origin] ?? 0) + 1;
    }
    metricsByLane[lane] = {
      ...metricsByLane[lane],
      selectedCount: laneSelected.length,
      selectedOriginCounts,
    };
  }
  const priorityById = new Map<string, EditorWorkPriority>(
    items.map((row): [string, EditorWorkPriority] => [row.item.id, priorityOf(row)]),
  );
  const selectedByPriority = {} as Record<EditorWorkPriority, ContentItem[]>;
  for (const priority of EDITOR_WORK_PRIORITY_ORDER) selectedByPriority[priority] = [];
  for (const item of selected) selectedByPriority[priorityById.get(item.id) ?? "backlog"].push(item);
  return { items: selected, selectedByLane, selectedByPriority, metricsByLane, eligibleByLane, totalBudget };
}

/** Short alias for scheduler callers. */
export const selectEditorModelWorkByLane = selectEditorModelWorkWithLanes;
