import { Link } from "@tanstack/react-router";
import type { NewsItem } from "../../content/schema";
import { itemHref } from "../../lib/kind";
import { DateChip } from "./DateChip";
import { StatusChip } from "./StatusChip";

export function Lead({ item }: { item: NewsItem }) {
  return (
    <article className="lead Lead">
      <p className="lead-kicker">Lead</p>
      <h2>
        <Link to={itemHref(item)}>{item.title}</Link>
      </h2>
      <p className="lead-dek">{item.impactSentence || item.dek}</p>
      <div className="lead-meta">
        <DateChip item={item} />
        {item.annotations?.map((ann) => (
          <StatusChip key={ann.type + ann.text} ann={ann.type}>
            {ann.type}
          </StatusChip>
        ))}
      </div>
    </article>
  );
}
