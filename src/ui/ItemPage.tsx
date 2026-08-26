import { Navigate } from "@tanstack/react-router";
import { byPreviousSlug, bySlug } from "../content/queries";
import { itemCitations, type ContentItem, type EventItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { itemByline } from "../lib/byline";
import { eventLifecycle, formatEventWhen, googleCalendarUrl } from "../lib/calendar";
import { canonicalPath } from "../lib/canonical";
import { eventWhyCopy } from "../lib/eventCopy";
import { eventPlace, formatDate } from "../lib/format";
import { chipKind, kindChip } from "../lib/kind";
import { ItemJsonLd } from "./ItemJsonLd";
import { ItemEntityLinks, ItemFactScope, itemAllowedOrgIds, itemFactHits } from "./ItemFacts";
import { RegisterLink } from "./RegisterLink";
import { GroupChip } from "./home/GroupChip";
import { NotFound } from "./NotFound";

const NEWS_SECTION_KINDS = new Set(["news", "policy", "ai", "interview"]);

function sectionOwns(item: ContentItem, section: "news" | "event" | "voice") {
  if (section === "news") return NEWS_SECTION_KINDS.has(item.kind);
  return item.kind === section;
}

/** Cole lock: aggregator card. Not a magazine template. */
export function ItemPage({
  slug,
  section,
}: {
  slug: string;
  section: "news" | "event" | "voice";
}) {
  const item = bySlug(catalog, slug);
  if (!item || !sectionOwns(item, section)) {
    const aliased = byPreviousSlug(catalog, slug);
    if (aliased && sectionOwns(aliased, section)) {
      return <Navigate to={canonicalPath(aliased)} replace />;
    }
    return <NotFound />;
  }
  const impact = item.impactSentence?.trim();
  const cites = itemCitations(item);
  const event = item.kind === "event" ? (item as EventItem) : undefined;
  const lifecycle = event ? eventLifecycle(event) : undefined;
  const when = event ? "" : formatDate(item.publishedAt);
  const byline = itemByline(item, section);
  const hits = itemFactHits(item);
  const allowed = itemAllowedOrgIds(item);
  const why = event ? eventWhyCopy(event) : undefined;
  const context = item.contextSentence?.trim();
  const bylineCovered = byline && hits.some((hit) => {
    const line = byline.toLocaleLowerCase("en-US");
    return line.includes(hit.entityName.toLocaleLowerCase("en-US"))
      || hit.entityName.toLocaleLowerCase("en-US").includes(line);
  });
  return (
    <ItemFactScope hits={hits} allowed={allowed}>
      <article className="ItemPage">
        <ItemJsonLd item={item} />
        <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>
        <div className="ItemPage-lead">
          <h1 className="Lead-headline">
            {item.title}
          </h1>
          {when || byline || hits.length ? (
            <div className="ItemPage-meta mt-2 text-xs" style={{ color: "var(--mute)" }}>
              {when ? <time dateTime={item.publishedAt}>{when}</time> : null}
              {when && ((byline && !bylineCovered) || hits.length) ? <span aria-hidden="true">·</span> : null}
              {byline && !bylineCovered ? <span>{byline}</span> : null}
              {byline && !bylineCovered && hits.length ? <span aria-hidden="true">·</span> : null}
              <ItemEntityLinks hits={hits} />
            </div>
          ) : null}
          {impact ? (
            <p className="mt-2 ItemPage-dek" style={{ color: "var(--mute)" }}>
              {impact}
            </p>
          ) : null}
        </div>
        {context ? (
          <p className="ItemPage-context">
            <span>Context</span> {context}
          </p>
        ) : null}
        {event ? (
          <section className="EventDetail">
            {lifecycle === "cancelled" ? <p><strong>Status</strong> Cancelled</p> : null}
            {lifecycle === "completed" ? <p><strong>Status</strong> Completed</p> : null}
            <p><strong>When</strong> <time dateTime={event.startsAt}>{formatEventWhen(event)}</time></p>
            {eventPlace(event) ? <p><strong>Where</strong> {eventPlace(event)}</p> : null}
            <p><strong>Host</strong> {event.hostOrg}</p>
            <p><strong>Why it’s worth your time</strong> {why ?? "Details not yet published."}</p>
            {event.whoYoullMeet?.length ? <p><strong>Who you’ll meet</strong> {event.whoYoullMeet.join(", ")}</p> : null}
            <div className="EventDetail-actions">
              {event.registrationUrl && lifecycle === "upcoming" ? <RegisterLink item={item} /> : null}
              {lifecycle !== "cancelled" ? (
                <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">Add to calendar</a>
              ) : null}
            </div>
          </section>
        ) : null}
        <p className="mt-6 whitespace-pre-wrap ItemPage-body">
          {item.body}
        </p>
        {cites.length > 0 ? (
          <section className="mt-6 ItemPage-sources">
            <h2 className="text-sm">Sources</h2>
            <ul className="text-sm">
              {cites.map((cite) => (
                <li key={cite.url}>
                  <a href={cite.url} rel="noreferrer" style={{ color: "var(--ink)" }}>
                    {cite.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </ItemFactScope>
  );
}
