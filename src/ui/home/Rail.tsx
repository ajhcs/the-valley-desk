import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { KIND_LABEL, itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";
import { RegisterLink } from "../RegisterLink";
import { EventJsonLd } from "../EventJsonLd";

export function Rail({
  label,
  rail,
  items,
}: {
  label: string;
  rail: "news" | "events";
  items: ContentItem[];
}) {
  return (
    <section className="Rail" data-rail={rail}>
      <h2>{label}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="RailRow">
            {rail === "events" ? <EventJsonLd item={item} /> : null}
            <div className="RailRow-top">
              <StatusChip kind={item.kind}>{KIND_LABEL[item.kind]}</StatusChip>
              <DateChip item={item} />
            </div>
            <Link to={itemHref(item)}>{item.title}</Link>
            {rail === "events" ? <RegisterLink item={item} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
