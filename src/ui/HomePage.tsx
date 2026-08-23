import { catalog } from "../lib/catalog";
import {
  briefingSinceYesterday5pmET,
  latestNews,
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
  const sessionFirst = useSessionFirstHome();

  return (
    <div className={sessionFirst ? "HomePage is-session-first" : "HomePage"}>
      {lead ? <Lead item={lead} /> : null}
      <Desk items={desk} />
      <div className="rails">
        <Rail label="NEWS · LATEST" rail="news" items={news} />
        <Rail label="EVENTS · NEXT" rail="events" items={events} />
      </div>
    </div>
  );
}
