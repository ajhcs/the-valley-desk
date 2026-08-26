import { Link } from "@tanstack/react-router";
import type { ContentItem, EventItem } from "../content/schema";
import { formatEventWhen } from "../lib/calendar";
import { eventPlace, formatDate, listDek } from "../lib/format";
import { chipKind, kindChip, itemHref } from "../lib/kind";
import { eventRegisterUrl } from "../lib/register";
import { MentionText } from "./MentionText";
import { RegisterLink } from "./RegisterLink";
import { ItemJsonLd } from "./ItemJsonLd";
import { GroupChip } from "./home/GroupChip";

export function ItemCard({ item, rail }: { item: ContentItem; rail?: "news" | "events" }) {
  const meta = item.kind === "event" ? formatEventWhen(item as EventItem) : formatDate(item.publishedAt);
  const place = item.kind === "event" ? eventPlace(item as EventItem) : item.region;
  const accent = rail === "events" ? "var(--events)" : "var(--ink)";
  const blurb = rail === "events" ? listDek(item) : (item.impactSentence?.trim() ?? "");
  return (
    <article className="border-t py-3" style={{ borderColor: accent }}>
      <ItemJsonLd item={item} />
      {rail === "events" ? null : <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>}
      <p className="text-xs tracking-wide uppercase" style={{ color: accent }}>
        {place}
      </p>
      <h3 className="text-lg leading-snug mt-1">
        <Link to={itemHref(item)} className="hover:underline" style={{ color: "var(--text)" }}>
          <MentionText text={item.title} item={item} />
        </Link>
      </h3>
      {blurb ? (
        <p className="text-sm mt-1 opacity-90">
          <MentionText text={blurb} item={item} interactive />
        </p>
      ) : null}
      <p className="text-xs mt-2" style={{ color: accent }}>
        {meta}
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
