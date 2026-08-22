import { z } from "zod";
import { ContentItem } from "../content/schema";

export const FeedDocument = z.object({
  product: z.literal("the-valley-desk"),
  version: z.literal("1"),
  generatedAt: z.string().datetime(),
  items: z.array(ContentItem),
});

export type FeedDocument = z.infer<typeof FeedDocument>;

export function toFeed(items: ContentItem[], generatedAt = new Date().toISOString()): FeedDocument {
  return {
    product: "the-valley-desk",
    version: "1",
    generatedAt,
    items: items.filter((i) => i.status === "published"),
  };
}
