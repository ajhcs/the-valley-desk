import type { ContentItem } from "../content/schema";
import { latestNews, latestVoices, pinnedUpcomingEvents } from "../content/queries";
import { catalog } from "../lib/catalog";
import { KIND_LABEL } from "../lib/kind";
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
  const title =
    kind === "event" ? KIND_LABEL.event : kind === "voice" ? KIND_LABEL.voice : KIND_LABEL.news;
  return (
    <article className="KindList">
      <h1 className="KindList-title">{title}</h1>
      <Rail label={label} rail={rail} items={items} />
    </article>
  );
}
