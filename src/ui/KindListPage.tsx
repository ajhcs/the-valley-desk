import type { ContentItem } from "../content/schema";
import { byKind, pinnedUpcomingEvents } from "../content/queries";
import { catalog } from "../lib/catalog";
import { KIND_LABEL } from "../lib/kind";
import { ItemCard } from "./ItemCard";

export function KindListPage({ kind }: { kind: ContentItem["kind"] }) {
  const items = kind === "event" ? pinnedUpcomingEvents(catalog, new Date(), 50) : byKind(catalog, kind);
  const rail = kind === "event" ? "events" : "news";
  return (
    <section>
      <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ color: kind === "event" ? "var(--events)" : "var(--ink)" }}>
        {KIND_LABEL[kind]}
      </h1>
      {items.length === 0 ? (
        <p className="mt-4 text-sm">Nothing published in this section yet.</p>
      ) : (
        items.map((item) => <ItemCard key={item.id} item={item} rail={rail} />)
      )}
    </section>
  );
}
