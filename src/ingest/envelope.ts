import { z } from "zod";
import { ContentItem } from "../content/schema";

export const IngestBatch = z.object({
  adapter: z.string(),
  fetchedAt: z.string().datetime(),
  items: z.array(ContentItem),
});

export type IngestBatch = z.infer<typeof IngestBatch>;

function stripIngestEditorial(item: ContentItem): ContentItem {
  if (item.source.kind !== "ingest") return item;
  if (item.kind === "news") {
    return { ...item, featured: false, clockAt: undefined, annotations: undefined };
  }
  return { ...item, featured: false, annotations: undefined };
}

export function toReviewQueue(batch: IngestBatch): ContentItem[] {
  return batch.items.map((raw) => {
    const item = stripIngestEditorial(raw);
    if (item.kind === "event" && item.autoPublish) {
      return { ...item, status: "published" as const };
    }
    if (item.source.kind === "editorial") {
      return item;
    }
    return { ...item, status: "review" as const };
  });
}
