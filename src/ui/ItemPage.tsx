import { Link, Navigate } from "@tanstack/react-router";
import { byPreviousSlug, bySlug } from "../content/queries";
import { itemCitations, type ContentItem, type EventItem, type VoiceItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { entities } from "../lib/entities";
import { itemByline } from "../lib/byline";
import { eventLifecycle, formatEventWhen, googleCalendarUrl } from "../lib/calendar";
import { canonicalPath } from "../lib/canonical";
import { eventHostLine, eventLocationLine, eventWhyCopy } from "../lib/eventCopy";
import { eventFormatLabel, formatDate, itemFreshness } from "../lib/format";
import { chipKind, itemHref, kindChip } from "../lib/kind";
import { relatedItems } from "../lib/related";
import { voiceRegisterLabel } from "../lib/voiceCopy";
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
  const freshness = itemFreshness(item);
  const related = relatedItems(item, catalog, entities);
  const voice = item.kind === "voice" ? (item as VoiceItem) : undefined;
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
        {voice ? (
          <p className="ItemPage-register">{voiceRegisterLabel(voice)}</p>
        ) : null}
        <div className="ItemPage-lead">
          <h1 className="Lead-headline">
            {item.title}
          </h1>
          {when || byline || hits.length || freshness.clock || freshness.updated ? (
            <div className="ItemPage-meta mt-2 text-xs" style={{ color: "var(--mute)" }}>
              {when ? <time dateTime={item.publishedAt}>{when}</time> : null}
              {when && (freshness.updated || freshness.clock || (byline && !bylineCovered) || hits.length) ? <span aria-hidden="true">·</span> : null}
              {freshness.updated ? <time dateTime={freshness.updated}>Updated {formatDate(freshness.updated)}</time> : null}
              {freshness.updated && (freshness.clock || (byline && !bylineCovered) || hits.length) ? <span aria-hidden="true">·</span> : null}
              {freshness.clock ? <time dateTime={freshness.clock}>Go-live {formatDate(freshness.clock)}</time> : null}
              {freshness.clock && ((byline && !bylineCovered) || hits.length) ? <span aria-hidden="true">·</span> : null}
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
            <p><strong>Where</strong> {eventLocationLine(event)}</p>
            <p><strong>Host</strong> {eventHostLine(event)}</p>
            {eventFormatLabel(event) ? <p><strong>Format</strong> {eventFormatLabel(event)}</p> : null}
            <p><strong>Why it’s worth your time</strong> {why ?? "Details not yet published."}</p>
            {event.whoYoullMeet?.length ? <p><strong>Who you’ll meet</strong> {event.whoYoullMeet.join(", ")}</p> : null}
            {event.healthSystemRelevance && event.healthSystemRelevance !== why ? (
              <p><strong>Why it belongs here</strong> {event.healthSystemRelevance}</p>
            ) : null}
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
                  <a href={cite.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)" }}>
                    {cite.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {related.length ? (
          <section className="mt-6 ItemPage-related">
            <h2 className="text-sm">Related on this desk</h2>
            <ul className="text-sm">
              {related.map((row) => (
                <li key={row.id}>
                  <Link to={itemHref(row)}>{row.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </ItemFactScope>
  );
}
