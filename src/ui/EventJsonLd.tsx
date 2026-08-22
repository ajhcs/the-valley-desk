import type { ContentItem } from "../content/schema";
import { eventJsonLd } from "../content/event-jsonld";

export function EventJsonLd({ item }: { item: ContentItem }) {
  const data = eventJsonLd(item);
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }}
    />
  );
}
