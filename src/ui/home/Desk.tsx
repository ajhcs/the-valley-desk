import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

function deskAsk(item: ContentItem) {
  return item.annotations?.find((ann) => ann.type === "ask");
}

export function Desk({ items }: { items: ContentItem[] }) {
  return (
    <ul className="desk">
      {items.map((item, i) => {
        const ask = deskAsk(item);
        const queued = item.status === "review";
        const title = queued ? (
          <span>{item.title}</span>
        ) : (
          <Link to={itemHref(item)}>{item.title}</Link>
        );
        return (
          <li key={item.id} className="DeskRow" style={{ ["--i" as string]: i }}>
            <div className="DeskRow-copy">
              <div className="DeskRow-title">
                {ask ? <span className="DateChip" data-ann="ask">ASK</span> : <DateChip item={item} />}
                {title}
                {queued ? <StatusChip>QUEUED</StatusChip> : null}
              </div>
            </div>
            {item.impactSentence ? (
              <p className="DeskRow-impact">{item.impactSentence}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
