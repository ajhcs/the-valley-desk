import type { ContentItem, EventItem } from "../content/schema";

/** Register URL is EventItem.registrationUrl only. No source fallback. Never invent. */
export function eventRegisterUrl(item: ContentItem): string | undefined {
  if (item.kind !== "event") return undefined;
  return (item as EventItem).registrationUrl;
}
