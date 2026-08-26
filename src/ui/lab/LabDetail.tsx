import { Link } from "@tanstack/react-router";
import type { ContentItem, EventItem } from "../../content/schema";
import { formatEventWhen, googleCalendarUrl } from "../../lib/calendar";
import { eventWhyCopy, isBoilerplateEventCopy } from "../../lib/eventCopy";
import { eventPlace, formatDate, listDek } from "../../lib/format";
import { itemHref } from "../../lib/kind";
import { eventRegisterUrl } from "../../lib/register";
import { MentionText } from "../MentionText";
import { RegisterLink } from "../RegisterLink";
import { topicLabel } from "./lab";

export function LabDetail({
  item,
  labelledBy,
}: {
  item: ContentItem;
  labelledBy?: string;
}) {
  const event = item.kind === "event" ? (item as EventItem) : undefined;
  const register = event ? eventRegisterUrl(event) : undefined;
  const blurb = item.impactSentence?.trim()
    || (event ? eventWhyCopy(event) : undefined)
    || listDek(item)
    || (item.body && !isBoilerplateEventCopy(item.body) ? item.body : undefined);
  return (
    <article className="LabDetail" aria-labelledby={labelledBy}>
      <p className="LabDetail-kicker">{topicLabel(item)}</p>
      <h3 id={labelledBy} className="LabDetail-title">
        <Link to={itemHref(item)}>
          <MentionText text={item.title} item={item} />
        </Link>
      </h3>
      {event ? (
        <p className="LabDetail-meta">
          {formatEventWhen(event)}
          {eventPlace(event) ? ` · ${eventPlace(event)}` : ""}
          {` · ${event.hostOrg}`}
        </p>
      ) : (
        <p className="LabDetail-meta">{formatDate(item.publishedAt)}</p>
      )}
      {blurb ? (
        <p className="LabDetail-body">
          <MentionText text={blurb} item={item} interactive />
        </p>
      ) : null}
      <div className="LabDetail-actions">
        <Link to={itemHref(item)}>Open permalink</Link>
        {register ? <RegisterLink item={item} /> : null}
        {event ? (
          <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
            Add to calendar
          </a>
        ) : null}
      </div>
    </article>
  );
}
