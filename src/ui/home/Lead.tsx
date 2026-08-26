import { Link } from "@tanstack/react-router";
import type { ContentItem } from "../../content/schema";
import { splitFirstSentence } from "../../lib/entityFacts";
import { itemHref } from "../../lib/kind";
import { LeadDekInsert, LeadSignedLine } from "../DekInsert";
import { MentionText } from "../MentionText";

function LeadImpact({ text, item }: { text: string; item: ContentItem }) {
  const { first, rest } = splitFirstSentence(text);
  return (
    <p className="Lead-impact">
      <MentionText text={first} item={item} interactive />
      <LeadSignedLine />
      {rest ? <MentionText text={rest} item={item} interactive /> : null}
    </p>
  );
}

export function Lead({ item }: { item: ContentItem }) {
  const impact = item.impactSentence;
  return (
    <LeadDekInsert>
      <article className="lead Lead">
        <p className="lead-kicker Lead-kicker">
          LATEST NEWS
        </p>
        <h1 className="Lead-headline">
          <Link to={itemHref(item)}>
            <MentionText text={item.title} item={item} />
          </Link>
        </h1>
        {impact ? <LeadImpact text={impact} item={item} /> : null}
      </article>
    </LeadDekInsert>
  );
}
