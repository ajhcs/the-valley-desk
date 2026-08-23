import { Link } from "@tanstack/react-router";
import type { ContentItem, EventItem } from "../content/schema";
import { formatDate, formatWhen, listDek, listSourceLine } from "../lib/format";
import { kindChip, itemHref } from "../lib/kind";
import { eventRegisterUrl } from "../lib/register";
import { RegisterLink } from "./RegisterLink";
import { ItemJsonLd } from "./ItemJsonLd";
import { GroupChip } from "./home/GroupChip";

export function ItemCard({ item, rail }: { item: ContentItem; rail?: "news" | "events" }) {
  const meta = item.kind === "event" ? formatWhen((item as EventItem).startsAt) : formatDate(item.publishedAt);
  const place = item.kind === "event" ? [(item as EventItem).venue, (item as EventItem).city].filter(Boolean).join(", ") : item.orgs.join(", ");
  const accent = rail === "events" ? "var(--events)" : "var(--ink)";
  const dek = listDek(item);
  const crumb = rail === "events" ? "" : listSourceLine(item);
  return (
    <article className="border-t py-3" style={{ borderColor: accent }}>
      <ItemJsonLd item={item} />
      {rail === "events" ? null : <GroupChip kind={item.kind}>{kindChip(item)}</GroupChip>}
      <p className="text-xs tracking-wide uppercase" style={{ color: accent }}>
        {item.region}
        {place ? " · " + place : ""}
      </p>
      <h3 className="text-lg leading-snug mt-1">
        <Link to={itemHref(item)} className="hover:underline" style={{ color: "var(--text)" }}>
          {item.title}
        </Link>
      </h3>
      {dek ? <p className="text-sm mt-1 opacity-90">{dek}</p> : null}
      <p className="text-xs mt-2" style={{ color: accent }}>
        {meta}
        {crumb ? (
          <>
            {" · "}
            {crumb}
          </>
        ) : null}
        {rail === "events" && eventRegisterUrl(item) ? (
          <>
            {" · "}
            <RegisterLink item={item} />
          </>
        ) : null}
      </p>
    </article>
  );
}
