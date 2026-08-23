import { bySlug } from "../content/queries";
import { itemCitations, type ContentItem, type EventItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { itemByline } from "../lib/byline";
import { formatDate, formatWhen } from "../lib/format";
import { chipKind, kindChip } from "../lib/kind";
import { ItemJsonLd } from "./ItemJsonLd";
import { RegisterLink } from "./RegisterLink";
import { GroupChip } from "./home/GroupChip";

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
    return <p className="text-sm">Not found, or not published.</p>;
  }
  const impact = item.impactSentence?.trim();
  const cites = itemCitations(item);
  const event = item.kind === "event" ? (item as EventItem) : undefined;
  const when = formatDate(item.publishedAt);
  const byline = itemByline(item, section);
  return (
    <article className="ItemPage">
      <ItemJsonLd item={item} />
      <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>
      <h1 className="Lead-headline">{item.title}</h1>
      {when || byline ? (
        <p className="mt-2 text-xs" style={{ color: "var(--mute)" }}>
          {when}
          {when && byline ? " · " : ""}
          {byline}
        </p>
      ) : null}
      {impact ? (
        <p className="mt-2" style={{ color: "var(--mute)" }}>{impact}</p>
      ) : null}
      {event ? (
        <p className="mt-2 text-xs" style={{ color: "var(--mute)" }}>
          {formatWhen(event.startsAt)}
          {event.registrationUrl ? (
            <>
              {" · "}
              <RegisterLink item={item} />
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-6 whitespace-pre-wrap">{item.body}</p>
      {cites.length > 0 ? (
        <section className="mt-6">
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
  );
}
