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

export function Desk({
  items,
  editionLine,
  quiet = false,
}: {
  items: ContentItem[];
  editionLine?: string;
  quiet?: boolean;
}) {
  const when = formatLeadDate(new Date().toISOString());
  if (items.length === 0 && !editionLine) return null;
  return (
    <section className="Desk">
      <p className="lead-kicker Lead-kicker">{when ? `THE DESK · ${when}` : "THE DESK"}</p>
      {editionLine ? <p className="Desk-edition">{editionLine}</p> : null}
      {quiet || items.length === 0 ? (
        <p className="Desk-quiet">Quiet edition. Nothing new in this window.</p>
      ) : null}
      {items.length === 0 ? null : (
        <ul className="desk">
          {items.map((item, i) => {
            const ask = deskAsk(item);
            const queued = item.status === "review";
            const title = queued ? (
              <span>
                <MentionText text={item.title} item={item} />
              </span>
            ) : (
              <Link to={itemHref(item)}>
                <MentionText text={item.title} item={item} />
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
                    <MentionText text={item.impactSentence} item={item} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
