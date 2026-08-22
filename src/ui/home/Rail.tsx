import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { KIND_LABEL, itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";
import { RegisterLink } from "../RegisterLink";
import { ItemJsonLd } from "../ItemJsonLd";

function newsChip(item: ContentItem) {
  const topic = item.topics[0];
  return topic ? topic.replace(/-/g, " ") : KIND_LABEL[item.kind];
}

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
            <ItemJsonLd item={item} />
            {rail === "events" ? (
              <>
                <DateChip item={item} />
                <Link to={itemHref(item)}>{item.title}</Link>
                <RegisterLink item={item} />
              </>
            ) : (
              <>
                <div className="RailRow-top">
                  <StatusChip kind={item.kind}>{newsChip(item)}</StatusChip>
                </div>
                <Link to={itemHref(item)}>{item.title}</Link>
                {item.impactSentence ? (
                  <p className="RailRow-impact">Impact: {item.impactSentence}</p>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
