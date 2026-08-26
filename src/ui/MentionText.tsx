import { useRef, type ReactNode, type SyntheticEvent } from "react";
import { entities } from "../lib/entities";
import { displayFacts, factBearingEntities, findFirstMentions, itemOrgGraph, type MentionHit } from "../lib/entityFacts";
import { useDekInsert } from "./DekInsert";
import { useMentionScope } from "./MentionScope";
import { EntityDisclosure, useAllowedOrgIds, usePrintedFactIds } from "./ItemFacts";

const FACT_BEARING = factBearingEntities(entities);

function OrgTick({ hit, interactive }: { hit: MentionHit; interactive: boolean }) {
  const tickRef = useRef<HTMLSpanElement>(null);
  const dek = useDekInsert();
  const printed = usePrintedFactIds()[hit.orgId];
  const painted = displayFacts(hit.facts);
  if (!painted.length) return hit.text;

  if (printed || !interactive) {
    return (
      <span className="OrgMention">
        {hit.text}
        <span className="OrgTick" aria-hidden="true" />
      </span>
    );
  }

  const help = dek.canInsert;
  const open = () => {
    if (!dek.canInsert) return;
    dek.show({ id: hit.orgId, name: hit.text, facts: painted.slice(0, 1) }, tickRef.current);
  };
  const stop = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (!help) {
    return (
      <span className="OrgMention">
        {hit.text}
        <EntityDisclosure hit={hit} factId={`mention-fact-${hit.orgId}`} compact />
      </span>
    );
  }

  return (
    <span className="OrgMention">
      {hit.text}
      <span
        ref={tickRef}
        className="OrgTick is-help"
        role="button"
        tabIndex={0}
        aria-label={`${hit.text} signed fact`}
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
    </span>
  );
}

/** First mention of a fact-bearing org/person. Sky tick only; no chip. */
export function MentionText({
  text,
  item,
  interactive = false,
}: {
  text: string;
  item?: { orgs?: string[] };
  /** Opt in only when the mention is not inside a link or another interactive element. */
  interactive?: boolean;
}) {
  const scope = useMentionScope();
  const allowedCtx = useAllowedOrgIds();
  const allowed = item ? itemOrgGraph(item, entities) : allowedCtx;
  const pool = allowed ? FACT_BEARING.filter((entity) => allowed.has(entity.id)) : [];
  const hits = findFirstMentions(text, pool, scope?.claimed ?? new Set());
  const kept = hits.filter((hit) => (scope ? scope.claim(hit.orgId) : true));
  if (!kept.length) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  kept.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start));
    nodes.push(<OrgTick key={`${hit.orgId}-${i}`} hit={hit} interactive={interactive} />);
    const separator = text.slice(hit.end).match(/^\s*[–—:-]\s*/)?.[0];
    if (separator) nodes.push(" ");
    cursor = hit.end + (separator?.length ?? 0);
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
