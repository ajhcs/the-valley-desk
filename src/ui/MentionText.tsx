import { useRef, type ReactNode, type SyntheticEvent } from "react";
import { entities } from "../lib/entities";
import { displayFacts, factBearingEntities, findFirstMentions, type CitableFact } from "../lib/entityFacts";
import { useDekInsert } from "./DekInsert";
import { useMentionScope } from "./MentionScope";
import { usePrintedFactIds } from "./ItemFacts";

const FACT_BEARING = factBearingEntities(entities);

function OrgTick({
  text,
  facts,
  orgId,
}: {
  text: string;
  facts: CitableFact[];
  orgId: string;
}) {
  const tickRef = useRef<HTMLSpanElement>(null);
  const dek = useDekInsert();
  const printed = usePrintedFactIds()[orgId];
  const painted = displayFacts(facts);
  if (!painted.length) return text;

  const help = dek.canInsert || Boolean(printed);
  const describedBy = printed || undefined;
  const open = () => {
    if (printed || !dek.canInsert) return;
    dek.show({ id: orgId, name: text, facts: painted.slice(0, 1) }, tickRef.current);
  };
  const stop = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span className="OrgMention">
      {text}
      {help ? (
        <span
          ref={tickRef}
          className="OrgTick is-help"
          role="button"
          tabIndex={0}
          aria-label={`${text} signed fact`}
          aria-describedby={describedBy}
          onMouseEnter={open}
          onMouseLeave={dek.hide}
          onFocus={open}
          onBlur={dek.hide}
          onClick={stop}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              stop(event);
              open();
            }
          }}
        />
      ) : (
        <span className="OrgTick" aria-hidden="true" />
      )}
    </span>
  );
}

/** First mention of a fact-bearing org/person. Sky tick only; no chip. */
export function MentionText({ text }: { text: string }) {
  const scope = useMentionScope();
  const hits = findFirstMentions(text, FACT_BEARING, scope?.claimed ?? new Set());
  const kept = hits.filter((hit) => (scope ? scope.claim(hit.orgId) : true));
  if (!kept.length) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  kept.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start));
    nodes.push(
      <OrgTick key={`${hit.orgId}-${i}`} text={hit.text} facts={hit.facts} orgId={hit.orgId} />,
    );
    cursor = hit.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
