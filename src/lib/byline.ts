import type { ContentItem, VoiceItem } from "../content/schema";
import { entityLookup } from "./entities";

const HOUSE = "Valley Desk";

export function firstOrgName(item: Pick<ContentItem, "orgs">): string {
  const id = item.orgs[0];
  if (!id) return "";
  return entityLookup.byId.get(id)?.name ?? id;
}

/** News byline: first org name, or authors if present. Never the house string. */
export function newsByline(item: ContentItem): string {
  const authors = item.authors.map((a) => a.name.trim()).filter((n) => n && n !== HOUSE);
  if (authors.length) return authors.join(", ");
  return firstOrgName(item);
}

/** Voices keep person/org. News never prints Valley Desk. */
export function itemByline(item: ContentItem, section: "news" | "event" | "voice"): string {
  if (section === "voice" && item.kind === "voice") {
    const voice = item as VoiceItem;
    return voice.person?.trim() || voice.org?.trim() || "";
  }
  if (section === "news") return newsByline(item);
  return item.authors.map((a) => a.name.trim()).filter((n) => n && n !== HOUSE).join(", ");
}
