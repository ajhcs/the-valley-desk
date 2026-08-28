import type { ContentItem } from "../content/schema";
import { officialSourceRegistry, type OfficialSourceCategory } from "./official-source-discovery";

/**
 * Specialist queues keep one content class from consuming every editor slot.
 * The lanes are intentionally deterministic: the same item always goes to
 * the same specialist, regardless of which source surfaced it.
 */
export const EDITOR_LANE_ORDER = [
  "news",
  "policy",
  "finance",
  "procurement",
  "product",
  "events",
  "voices",
  "leadership",
] as const;

export type EditorLane = (typeof EDITOR_LANE_ORDER)[number];
export type EditorLaneBudgets = Record<EditorLane, number>;

/** Per-lane defaults. The total scheduler cap is intentionally separate. */
export const DEFAULT_EDITOR_LANE_BUDGETS: EditorLaneBudgets = {
  news: 12,
  policy: 6,
  finance: 4,
  procurement: 3,
  product: 4,
  events: 6,
  voices: 4,
  leadership: 3,
};

export const DEFAULT_EDITOR_LANE_TOTAL_BUDGET = 32;
export const MAX_EDITOR_LANE_BUDGET = 20;
export const MAX_EDITOR_LANE_TOTAL_BUDGET = 64;

function laneForOfficialCategory(category: OfficialSourceCategory): EditorLane {
  switch (category) {
    case "policy":
      return "policy";
    case "finance":
    case "filing":
      return "finance";
    case "procurement":
      return "procurement";
    case "product":
      return "product";
    case "events":
      return "events";
    case "news":
    default:
      return "news";
  }
}

function officialLaneForOrigin(origin: string): EditorLane | undefined {
  const source = officialSourceRegistry.sources.find((row) => `official-${row.id}` === origin);
  return source ? laneForOfficialCategory(source.category) : undefined;
}

/**
 * Classify a ContentItem before editor work is selected. Content kind wins for
 * explicit social/events/policy/product rows; official registry metadata then
 * preserves finance/procurement/product categories that may be represented as
 * a generic NewsItem after conversion.
 */
export function editorLaneForItem(item: Pick<ContentItem, "kind" | "source">): EditorLane {
  if (item.kind === "voice") return "voices";
  if (item.kind === "event") return "events";
  if (item.kind === "policy") return "policy";
  if (item.kind === "ai") return "product";
  if (item.source.origin === "executive-leadership-monitor") return "leadership";
  return officialLaneForOrigin(item.source.origin) ?? "news";
}

/** Alias for callers that use “classify” terminology. */
export const classifyEditorLane = editorLaneForItem;

export function emptyEditorLaneBudgets(): EditorLaneBudgets {
  return Object.fromEntries(
    EDITOR_LANE_ORDER.map((lane) => [lane, 0]),
  ) as EditorLaneBudgets;
}

