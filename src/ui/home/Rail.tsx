import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { KIND_LABEL, itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

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
            <div className="RailRow-top">
              <StatusChip kind={item.kind}>{KIND_LABEL[item.kind]}</StatusChip>
              <DateChip item={item} />
            </div>
            <Link to={itemHref(item)}>{item.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
