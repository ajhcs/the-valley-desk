import { catalog } from "../lib/catalog";
import {
  latestNews,
  latestVoices,
  leadItem,
  nextChapterEvent,
  pinnedUpcomingEvents,
} from "../content/queries";
import { Lead } from "./home/Lead";
import { Rail } from "./home/Rail";
import { useSessionFirstHome } from "./sessionMotion";

export function HomePage() {
  const rankedNews = latestNews(catalog, 7);
  const lead = rankedNews[0] ?? leadItem(catalog);
  const news = rankedNews.filter((item) => item.id !== lead?.id).slice(0, 6);
  const events = pinnedUpcomingEvents(catalog);
  const voices = latestVoices(catalog);
  const pinId = nextChapterEvent(catalog)?.id;
  const sessionFirst = useSessionFirstHome();
  return (
    <div className={sessionFirst ? "HomePage is-session-first" : "HomePage"}>
      {lead ? <Lead item={lead} /> : null}
      <div className="rails">
        <Rail label="NEWS · LATEST" rail="news" items={news} />
        <Rail label="EVENTS · NEXT" rail="events" items={events} pinId={pinId} />
        <Rail label="VOICES · LATEST" rail="voices" items={voices} />
      </div>
    </div>
  );
}
