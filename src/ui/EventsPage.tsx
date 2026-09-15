import { Link, useRouterState } from "@tanstack/react-router";
import type { EventItem } from "../content/schema";
import { upcomingEvents } from "../content/queries";
import { filterOptions, filteredEventsPage } from "../content/news-event-filters";
import { formatEventWhen, googleCalendarUrl } from "../lib/calendar";
import { eventHostLine, eventLocationLine, eventWhyLine } from "../lib/eventCopy";
import { eventFormatLabel } from "../lib/format";
import { catalog } from "../lib/catalog";
import { entityLookup } from "../lib/entities";
import { itemHref } from "../lib/kind";
import { eventRegisterUrl } from "../lib/register";
import { MentionText } from "./MentionText";
import { RegisterLink } from "./RegisterLink";
import { DateChip } from "./home/DateChip";
import { NewsEventEmpty, NewsEventFilters, NewsEventPagination } from "./NewsEventFilters";
import { CalendarSubscription } from "./CalendarSubscription";

function timingSignal(item: EventItem, now: Date) {
  const days = Math.ceil((Date.parse(item.startsAt) - now.getTime()) / 86_400_000);
  if (days <= 3) return "COMING UP";
  if (days <= 7) return "THIS WEEK";
  if (days <= 30) return "THIS MONTH";
  return undefined;
}

function EventCard({ item, now, radar = false }: { item: EventItem; now: Date; radar?: boolean }) {
  const signal = radar ? "DON’T MISS" : timingSignal(item, now);
  const format = eventFormatLabel(item) ?? "Format not confirmed";
  const register = eventRegisterUrl(item);
  const place = eventLocationLine(item);
  const why = eventWhyLine(item);
  return (
    <article className={radar ? "EventCard is-radar" : "EventCard"}>
      <div className="EventCard-date"><DateChip item={item} /></div>
      <div className="EventCard-copy">
        <div className="EventCard-signals">
          {signal ? <span>{signal}</span> : null}
          <span>{format}</span>
          <span>{eventHostLine(item)}</span>
        </div>
        <h3><Link to={itemHref(item)}><MentionText text={item.title} item={item} /></Link></h3>
        <p className="EventCard-when">{formatEventWhen(item)} · {place}</p>
        <p className="EventCard-why"><strong>Why it’s worth your time:</strong> {why}</p>
        {item.whoYoullMeet?.length ? (
          <p className="EventCard-meet"><strong>Who you’ll meet:</strong> {item.whoYoullMeet.join(", ")}</p>
        ) : null}
      </div>
      <div className="EventCard-actions">
        {register ? <RegisterLink item={item} /> : null}
        <a href={googleCalendarUrl(item)} target="_blank" rel="noreferrer">Add to calendar</a>
      </div>
    </article>
  );
}

export function EventsPage() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const busy = useRouterState({ select: (s) => s.isLoading });
  const now = new Date();
  const choices = upcomingEvents(catalog, now, Number.MAX_SAFE_INTEGER);
  const { request, chapter, page } = filteredEventsPage(catalog, searchStr, now);
  const visibleChapter = page.items.find((item) => item.id === chapter?.id);
  const next = page.items.filter((item) => item.id !== visibleChapter?.id);
  const matchText = page.total === 1 ? " matches these filters" : " match these filters";
  const resultStatus = busy ? "Updating events..."
    : request.errors.length ? "Filters need attention."
    : !page.indexable ? "Page unavailable."
    : `${page.total} upcoming ${page.total === 1 ? "event" : "events"}${request.active ? matchText : " listed"}.`;
  return (
    <article className="EventsPage">
      <header className="EventsPage-head">
        <p className="EventsPage-kicker">THE ANTI-FOMO CALENDAR</p>
        <h1>Events worth leaving your desk for.</h1>
        <p>What’s next, why it matters, and the registration link before you hear about it afterward.</p>
      </header>
      <CalendarSubscription />
      <NewsEventFilters key={searchStr} section="events" request={request} busy={busy}
        organizations={filterOptions(choices.map((item) => item.hostOrg), (id) => entityLookup.match(id)?.name ?? id)}
        topics={filterOptions(choices.flatMap((item) => item.topics))} />
      <div className="NewsEventResults" aria-busy={busy}>
        <p className="NewsEventResults-count" role="status">
          {resultStatus}
        </p>
        {visibleChapter ? (
          <section className="EventsSection is-radar">
            <h2>CHAPTER RADAR</h2>
            <EventCard item={visibleChapter} now={now} radar />
          </section>
        ) : null}
        {next.length ? <section className="EventsSection">
          <div className="EventsSection-head">
            <h2>NEXT UP</h2>
            <span>{next.length} on the radar</span>
          </div>
          <div className="EventList">
            {next.map((item) => <EventCard key={item.id} item={item} now={now} />)}
          </div>
        </section> : null}
        {!page.items.length ? <NewsEventEmpty path="/events" request={request} invalidPage={!page.indexable} /> : null}
        <NewsEventPagination path="/events" request={request} pageWindow={page} />
      </div>
    </article>
  );
}
