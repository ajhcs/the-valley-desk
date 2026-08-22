export const SITE_ORIGIN = "https://thevalleydesk.org";

const NEWS_PERMALINK_KINDS = new Set(["news", "policy", "ai", "interview"]);

/** Permalink path. Policy/AI/interview live under /news/{slug}. Events under /events/{slug}. */
export function canonicalPath(item: { kind: string; slug: string }): string {
  if (item.kind === "event") return "/events/" + item.slug;
  if (NEWS_PERMALINK_KINDS.has(item.kind)) return "/news/" + item.slug;
  if (item.kind === "voice") return "/voices/" + item.slug;
  if (item.kind === "briefing") return "/briefing/" + item.slug;
  return "/" + item.kind + "/" + item.slug;
}

export function canonicalUrl(item: { kind: string; slug: string }): string {
  return SITE_ORIGIN + canonicalPath(item);
}
