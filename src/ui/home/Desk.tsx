import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

function deskAsk(item: ContentItem) {
  return item.annotations?.find((ann) => ann.type === "ask");
}

function deskNote(item: ContentItem) {
  const ask = deskAsk(item);
  return ask?.text || item.impactSentence || item.dek;
}

export function Desk({ items }: { items: ContentItem[] }) {
  if (items.length === 0) return null;
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
            <div className="DeskRow-main">
              {ask ? <StatusChip ann="ask">ASK</StatusChip> : <DateChip item={item} />}
              <div className="DeskRow-title">{title}</div>
              {queued ? <StatusChip queued>QUEUED</StatusChip> : null}
            </div>
            <p className="DeskRow-note">{deskNote(item)}</p>
          </li>
        );
      })}
    </ul>
  );
}
