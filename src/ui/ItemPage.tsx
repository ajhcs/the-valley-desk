import { bySlug } from "../content/queries";
import { itemCitations, type ContentItem, type EventItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { itemByline } from "../lib/byline";
import { formatDate, formatWhen } from "../lib/format";
import { chipKind, kindChip } from "../lib/kind";
import { ItemJsonLd } from "./ItemJsonLd";
import { ItemFactScope, ItemFacts, itemFactHits } from "./ItemFacts";
import { MentionText } from "./MentionText";
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
    return <NotFound />;
  }
  const impact = item.impactSentence?.trim();
  const cites = itemCitations(item);
  const event = item.kind === "event" ? (item as EventItem) : undefined;
  const when = formatDate(item.publishedAt);
  const byline = itemByline(item, section);
  const hits = itemFactHits(item);
  return (
    <ItemFactScope hits={hits}>
      <article className="ItemPage">
        <ItemJsonLd item={item} />
        <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>
        <div className="ItemPage-lead">
          <h1 className="Lead-headline">
            <MentionText text={item.title} />
          </h1>
          {when || byline ? (
            <p className="mt-2 text-xs" style={{ color: "var(--mute)" }}>
              {when}
              {when && byline ? " · " : ""}
              {byline}
            </p>
          ) : null}
          {impact ? (
            <p className="mt-2 ItemPage-dek" style={{ color: "var(--mute)" }}>
              <MentionText text={impact} />
            </p>
          ) : null}
        </div>
        <ItemFacts hits={hits} />
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
        <p className="mt-6 whitespace-pre-wrap ItemPage-body">
          <MentionText text={item.body} />
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
