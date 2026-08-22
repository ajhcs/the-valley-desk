/**
 * Machine-readable feed. Same ContentItem envelope as the site store.
 * Humans get the two-rail homepage. Agents GET this document.
 *
 * Suggested route once the repo exists:
 *   GET /feed.json
 *   GET /feed.json?kind=news|event|voice|policy|ai|briefing|interview
 *
 * Rules:
 * - Published items only (status === "published").
 * - Ingest-sourced items keep source.url + source.origin so every card is cited.
 * - Interviews never appear unless Cole published them (editorial path).
 * - Do not invent a second schema for agents.
 */

import { z } from "zod";
import { ContentItem } from "../content/schema";

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
    items: items.filter((i) => i.status === "published"),
  };
}
