import { bySlug } from "../content/queries";
import { itemCitations, type EventItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { formatDate, formatWhen } from "../lib/format";
import { kindChip } from "../lib/kind";
import { ItemJsonLd } from "./ItemJsonLd";
import { RegisterLink } from "./RegisterLink";
import { GroupChip } from "./home/GroupChip";

/** Cole lock: aggregator card. Not a magazine template. */
export function ItemPage({ slug }: { slug: string }) {
  const item = bySlug(catalog, slug);
  if (!item) {
    return <p className="text-sm">Not found, or not published.</p>;
  }
  const impact = item.impactSentence?.trim();
  const cites = itemCitations(item);
  const event = item.kind === "event" ? (item as EventItem) : undefined;
  const when = formatDate(item.publishedAt);
  const byline = item.authors.map((a) => a.name).filter(Boolean).join(", ");
  return (
    <article>
      <ItemJsonLd item={item} />
      <GroupChip kind={item.kind}>{kindChip(item)}</GroupChip>
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
