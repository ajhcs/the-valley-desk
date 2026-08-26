import type { ContentItem } from "../content/schema";

import { canonicalPath } from "./canonical";
import { chipPaintKind, primaryDisplayLabel } from "./taxonomy";

export const KIND_PATH: Record<ContentItem["kind"], string> = {
  news: "/news",
  event: "/events",
  voice: "/voices",
  policy: "/news",
  ai: "/news",
  briefing: "/briefing",
  interview: "/news",
}

export const KIND_LABEL: Record<ContentItem["kind"], string> = {
  news: "News",
  event: "Events",
  voice: "Voices",
  policy: "Policy",
  ai: "AI",
  briefing: "Briefing",
  interview: "Interview",
}

/** Fallback chip copy by kind. Display chips use primaryDisplayLabel, never topics[0]. */
export const KIND_CHIP: Record<ContentItem["kind"], string> = {
  news: "HIT",
  event: "CHAPTER",
  voice: "OPERATIONS",
  policy: "POLICY",
  ai: "AI",
  briefing: "BRIEFING",
  interview: "HIT",
}

/** Paint group for GroupChip data-kind. Policy ink, AI admiral, news/event mute, voice ink. */
export function chipKind(item: Pick<ContentItem, "kind" | "topics" | "title" | "dek" | "body">): ContentItem["kind"] {
  return chipPaintKind(item);
}

export function kindChip(item: Pick<ContentItem, "kind" | "topics" | "title" | "dek" | "body">): string {
  return primaryDisplayLabel(item);
}

export function itemHref(item: ContentItem) {
  return canonicalPath(item);
}
