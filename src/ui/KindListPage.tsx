import type { ContentItem } from "../content/schema";
import { latestNews, pinnedUpcomingEvents } from "../content/queries";
import { catalog } from "../lib/catalog";
import { Rail } from "./home/Rail";

export function KindListPage({ kind }: { kind: ContentItem["kind"] }) {
  const items =
    kind === "event"
      ? pinnedUpcomingEvents(catalog, new Date(), 50)
      : latestNews(catalog, Number.MAX_SAFE_INTEGER);
  const rail = kind === "event" ? "events" : "news";
  const label = kind === "event" ? "EVENTS · NEXT" : "NEWS · LATEST";
  return <Rail label={label} rail={rail} items={items} />;
}
