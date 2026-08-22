/**
 * Machine-readable feed. Same ContentItem envelope as the site store.
 * Humans get the two-rail homepage. Agents GET this document.
 *
 *   GET /feed.json
 *   GET /feed.xml
 *
 * Rules:
 * - Published items only (status === "published").
 * - Must have a citation: source.url or citations[0].url.
 * - Interviews never appear unless Cole published them (editorial path).
 * - Do not invent a second schema for agents.
 * - Event items keep registrationUrl on the same envelope (no second model).
 */

import { z } from "zod";
import { citationUrl, ContentItem } from "../content/schema";

export const FeedDocument = z.object({
  product: z.literal("the-valley-desk"),
  version: z.literal("1"),
  generatedAt: z.string().datetime(),
  items: z.array(ContentItem),
});

export type FeedDocument = z.infer<typeof FeedDocument>;

export function toFeed(
  items: ContentItem[],
  generatedAt = new Date().toISOString(),
): FeedDocument {
  return {
    product: "the-valley-desk",
    version: "1",
    generatedAt,
    items: items
      .filter((i) => i.status === "published" && Boolean(citationUrl(i)))
      .map((item) =>
        item.kind === "event"
          ? { ...item, registrationUrl: item.registrationUrl }
          : item,
      ),
  };
}
