import { chipInstant, formatChipLabel } from "../../lib/format";
import type { ContentItem } from "../../content/schema";

export function DateChip({ item }: { item: ContentItem }) {
  const iso = chipInstant(item);
  const label = formatChipLabel(item);
  if (!label || !iso) return null;
  return (
    <time className="DateChip" dateTime={iso}>
      {label}
    </time>
  );
}
