import type { ContentItem } from "../content/schema";
import { itemJsonLd } from "../content/jsonld";
import { loadEntities } from "../content/store";

const entities = loadEntities();

export function ItemJsonLd({ item }: { item: ContentItem }) {
  const data = itemJsonLd(item, entities);
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }}
    />
  );
}

/** @deprecated alias — Event JSON-LD is the Event branch of itemJsonLd */
export { ItemJsonLd as EventJsonLd };
