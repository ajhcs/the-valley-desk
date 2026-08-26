import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../content/schema";
import { formatDate } from "../lib/format";
import { chipKind, itemHref, kindChip } from "../lib/kind";
import { MentionText } from "./MentionText";
import { GroupChip } from "./home/GroupChip";

export function ProductWatch({ items }: { items: ContentItem[] }) {
  return (
    <section className="ProductWatch">
      <div className="ProductWatch-head">
        <h2>PRODUCTS · WATCH</h2>
        <p>Changes to tools already tied to a regional health system.</p>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <div className="ProductWatch-meta">
              <GroupChip kind={chipKind(item)}>{kindChip(item)}</GroupChip>
              {item.publishedAt ? <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time> : null}
            </div>
            <h3><Link to={itemHref(item)}><MentionText text={item.title} item={item} /></Link></h3>
            {item.impactSentence ? <p><MentionText text={item.impactSentence} item={item} interactive /></p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
