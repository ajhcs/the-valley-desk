import type { ContentItem } from "../content/schema";

export const KIND_PATH: Record<ContentItem["kind"], string> = {
  news: "/news",
  event: "/events",
  voice: "/voices",
  policy: "/policy",
  ai: "/ai",
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

export function itemHref(item: ContentItem) {
  return KIND_PATH[item.kind] + "/" + item.slug;
}
