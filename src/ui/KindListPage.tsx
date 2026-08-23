import type { ContentItem } from "../content/schema";
import { latestNews, latestVoices, pinnedUpcomingEvents } from "../content/queries";
import { catalog } from "../lib/catalog";
import { Rail } from "./home/Rail";

export function KindListPage({ kind }: { kind: ContentItem["kind"] }) {
  const items =
    kind === "event"
      ? pinnedUpcomingEvents(catalog, new Date(), 50)
      : kind === "voice"
        ? latestVoices(catalog, Number.MAX_SAFE_INTEGER)
        : latestNews(catalog, Number.MAX_SAFE_INTEGER);
  const rail = kind === "event" ? "events" : kind === "voice" ? "voices" : "news";
  const label =
    kind === "event" ? "EVENTS · NEXT" : kind === "voice" ? "VOICES · LATEST" : "NEWS · LATEST";
  return <Rail label={label} rail={rail} items={items} />;
}
