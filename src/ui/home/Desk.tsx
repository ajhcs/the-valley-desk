import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { formatLeadDate } from "../../lib/format";
import { itemHref } from "../../lib/kind";
import { MentionText } from "../MentionText";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

function deskAsk(item: ContentItem) {
  return item.annotations?.find((ann) => ann.type === "ask");
}

export function Desk({ items }: { items: ContentItem[] }) {
  if (items.length === 0) return null;
  const when = formatLeadDate(new Date().toISOString());
  return (
    <section className="Desk">
      <p className="lead-kicker Lead-kicker">{when ? `THE DESK · ${when}` : "THE DESK"}</p>
      <ul className="desk">
        {items.map((item, i) => {
          const ask = deskAsk(item);
          const queued = item.status === "review";
          const title = queued ? (
            <span>
              <MentionText text={item.title} />
            </span>
          ) : (
            <Link to={itemHref(item)}>
              <MentionText text={item.title} />
            </Link>
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
                <p className="DeskRow-impact">
                  <MentionText text={item.impactSentence} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
