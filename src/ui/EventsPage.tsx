import { Link } from "@tanstack/react-router";
import type { EventItem } from "../content/schema";
import { nextChapterEvent, upcomingEvents } from "../content/queries";
import { formatEventWhen, googleCalendarUrl } from "../lib/calendar";
import { eventWhyLine } from "../lib/eventCopy";
import { catalog } from "../lib/catalog";
import { itemHref } from "../lib/kind";
import { eventRegisterUrl } from "../lib/register";
import { MentionText } from "./MentionText";
import { RegisterLink } from "./RegisterLink";
import { DateChip } from "./home/DateChip";

function inferredFormat(item: EventItem) {
  if (item.format) return item.format;
  const text = `${item.title} ${item.venue ?? ""}`.toLocaleLowerCase("en-US");
  if (text.includes("virtual")) return "virtual";
  return item.venue || item.city || item.geo ? "in-person" : "unknown";
}

function timingSignal(item: EventItem, now: Date) {
  const days = Math.ceil((Date.parse(item.startsAt) - now.getTime()) / 86_400_000);
  if (days <= 3) return "COMING UP";
  if (days <= 7) return "THIS WEEK";
  if (days <= 30) return "THIS MONTH";
  return undefined;
}

function EventCard({ item, now, radar = false }: { item: EventItem; now: Date; radar?: boolean }) {
  const signal = radar ? "DON’T MISS" : timingSignal(item, now);
  const format = inferredFormat(item);
  const register = eventRegisterUrl(item);
  const place = item.venue ?? item.city ?? item.geo;
  const why = eventWhyLine(item);
  return (
    <article className={radar ? "EventCard is-radar" : "EventCard"}>
      <div className="EventCard-date"><DateChip item={item} /></div>
      <div className="EventCard-copy">
        <div className="EventCard-signals">
          {signal ? <span>{signal}</span> : null}
          {format !== "unknown" ? <span>{format}</span> : null}
          <span>{item.hostOrg}</span>
        </div>
        <h3><Link to={itemHref(item)}><MentionText text={item.title} /></Link></h3>
        <p className="EventCard-when">{formatEventWhen(item)}{place ? ` · ${place}` : ""}</p>
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
  const now = new Date();
  const chapter = nextChapterEvent(catalog, now);
  const next = upcomingEvents(catalog, now, 50).filter((item) => item.id !== chapter?.id);
  return (
    <article className="EventsPage">
      <header className="EventsPage-head">
        <p className="EventsPage-kicker">THE ANTI-FOMO CALENDAR</p>
        <h1>Events worth leaving your desk for.</h1>
        <p>What’s next, why it matters, and the registration link before you hear about it afterward.</p>
      </header>
      {chapter ? (
        <section className="EventsSection is-radar">
          <h2>CHAPTER RADAR</h2>
          <EventCard item={chapter} now={now} radar />
        </section>
      ) : null}
      <section className="EventsSection">
        <div className="EventsSection-head">
          <h2>NEXT UP</h2>
          <span>{next.length} on the radar</span>
        </div>
        <div className="EventList">
          {next.map((item) => <EventCard key={item.id} item={item} now={now} />)}
        </div>
      </section>
    </article>
  );
}
