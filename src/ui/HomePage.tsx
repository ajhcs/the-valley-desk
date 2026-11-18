import { Link } from "@tanstack/react-router";
import { catalog } from "../lib/catalog";
import { publicFeatures } from "../lib/public-features";
import {
  latestNews,
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
  const pinId = nextChapterEvent(catalog)?.id;
  const sessionFirst = useSessionFirstHome();
  return (
    <div className={sessionFirst ? "HomePage is-session-first" : "HomePage"}>
      {publicFeatures().discovery ? (
        <form className="HomeDiscovery" role="search" action="/discover/works" method="get">
          <label htmlFor="home-discovery">Find regional health-tech projects</label>
          <div>
            <input id="home-discovery" name="q" type="search" maxLength={200} placeholder="Search by project, topic, or institution" />
            <button type="submit">Search</button>
          </div>
        </form>
      ) : null}
      {lead ? <Lead item={lead} /> : null}
      <div className="rails">
        <Rail label="NEWS · LATEST" rail="news" items={news} />
        <Rail label="EVENTS · NEXT" rail="events" items={events} pinId={pinId} />
      </div>
      {publicFeatures().watch ? <nav className="HomeWatch" aria-label="Watch sections">
        <Link to="/policy-watch" search={{}}><span>Policy Watch</span><small>Federal / PA / NJ / DE / Delaware Valley</small></Link>
        <Link to="/technology-watch" search={{}}><span>Technology Watch</span><small>Verified Delaware Valley connections</small></Link>
      </nav> : null}
    </div>
  );
}
