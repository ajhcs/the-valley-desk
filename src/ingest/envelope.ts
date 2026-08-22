import { z } from "zod";
import { ContentItem } from "../content/schema";

export const IngestBatch = z.object({
  adapter: z.string(),
  fetchedAt: z.string().datetime(),
  items: z.array(ContentItem),
});

export type IngestBatch = z.infer<typeof IngestBatch>;

export function toReviewQueue(batch: IngestBatch): ContentItem[] {
  return batch.items.map((item) => {
    if (item.kind === "event" && item.autoPublish) {
      return { ...item, status: "published" as const };
    }
    if (item.source.kind === "editorial") {
      return item;
    }
    return { ...item, status: "review" as const };
  });
}
