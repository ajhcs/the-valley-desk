import { Link } from "@tanstack/react-router";
import type { NewsItem } from "../../content/schema";
import { itemHref } from "../../lib/kind";
import { formatLeadDate } from "../../lib/format";

export function Lead({ item }: { item: NewsItem }) {
  const when = formatLeadDate(item.publishedAt);
  const impact = item.impactSentence;
  return (
    <article className="lead Lead">
      <p className="lead-kicker Lead-kicker">{when ? `THE DESK · ${when}` : "THE DESK"}</p>
      <h1 className="Lead-headline">
        <Link to={itemHref(item)}>{item.title}</Link>
      </h1>
      {impact ? <p className="Lead-impact">Impact: {impact}</p> : null}
    </article>
  );
}
