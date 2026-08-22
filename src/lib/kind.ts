import type { ContentItem } from "../content/schema";

import { canonicalPath } from "./canonical";

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

/** Kind chip copy. Never topics[0]. News is HIT. Event is CHAPTER. */
export const KIND_CHIP: Record<ContentItem["kind"], string> = {
  news: "HIT",
  event: "CHAPTER",
  voice: "VOICE",
  policy: "POLICY",
  ai: "AI",
  briefing: "BRIEFING",
  interview: "HIT",
}

/** Chip = item.kind. Jefferson loss (topics[0]=finance) is HIT. */
export function kindChip(item: Pick<ContentItem, "kind">): string {
  return KIND_CHIP[item.kind];
}

export function itemHref(item: ContentItem) {
  return canonicalPath(item);
}
