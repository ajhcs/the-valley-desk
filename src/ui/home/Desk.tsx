import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

export function Desk({ items }: { items: ContentItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="desk">
      {items.map((item, i) => (
        <li key={item.id} className="DeskRow" style={{ ["--i" as string]: i }}>
          <DateChip item={item} />
          <div>
            <div className="DeskRow-title">
              <Link to={itemHref(item)}>{item.title}</Link>
            </div>
            <div className="DeskRow-marks">
              {item.status === "review" ? <StatusChip queued>QUEUED</StatusChip> : null}
              {item.annotations?.map((ann) => (
                <StatusChip key={ann.type + ann.text} ann={ann.type}>
                  {ann.type}
                </StatusChip>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
