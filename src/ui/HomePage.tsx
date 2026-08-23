import { catalog } from "../lib/catalog";
import {
  briefingSinceYesterday5pmET,
  latestNews,
  latestVoices,
  leadItem,
  pinnedUpcomingEvents,
} from "../content/queries";
import { Desk } from "./home/Desk";
import { Lead } from "./home/Lead";
import { Rail } from "./home/Rail";
import { useSessionFirstHome } from "./sessionMotion";

export function HomePage() {
  const lead = leadItem(catalog);
  const desk = briefingSinceYesterday5pmET(catalog);
  const news = latestNews(catalog);
  const events = pinnedUpcomingEvents(catalog);
  const voices = latestVoices(catalog);
  const sessionFirst = useSessionFirstHome();

  return (
    <div className={sessionFirst ? "HomePage is-session-first" : "HomePage"}>
      {lead ? <Lead item={lead} /> : null}
      {desk.length ? <Desk items={desk} /> : null}
      <div className="rails">
        <Rail label="NEWS · LATEST" rail="news" items={news} />
        <Rail label="EVENTS · NEXT" rail="events" items={events} />
        <Rail label="VOICES · LATEST" rail="voices" items={voices} />
      </div>
    </div>
  );
}
