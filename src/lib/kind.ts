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

/** Paint policy/AI from topics even when kind=news. Jefferson finance stays HIT. */
export function chipKind(item: Pick<ContentItem, "kind" | "topics">): ContentItem["kind"] {
  const topics = (item.topics ?? []).map((t) => t.toLowerCase());
  if (topics.includes("policy")) return "policy";
  if (topics.includes("ai")) return "ai";
  return item.kind;
}

export function kindChip(item: Pick<ContentItem, "kind" | "topics">): string {
  const painted = chipKind(item);
  if (painted === "policy") return "POLICY";
  if (painted === "ai") return "AI";
  return KIND_CHIP[item.kind];
}

export function itemHref(item: ContentItem) {
  return canonicalPath(item);
}
