import { chipInstant, formatDate } from "../../lib/format";
import type { ContentItem } from "../../content/schema";

export function DateChip({ item }: { item: ContentItem }) {
  const iso = chipInstant(item);
  const label = formatDate(iso);
  if (!label) return null;
  return <time className="DateChip" dateTime={iso}>{label}</time>;
}
