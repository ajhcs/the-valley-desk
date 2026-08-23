import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { entities } from "../lib/entities";
import {
  factBearingEntities,
  findFirstMentions,
  uniqueCitations,
  type CitableFact,
} from "../lib/entityFacts";
import { useMentionScope } from "./MentionScope";

const FACT_BEARING = factBearingEntities(entities);

function OrgChip({
  facts,
  top,
  left,
  onEnter,
  onLeave,
}: {
  facts: CitableFact[];
  top: number;
  left: number;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const cites = uniqueCitations(facts);
  if (!facts.length || !cites.length) return null;
  return createPortal(
    <div
      className="OrgChip"
      role="tooltip"
      style={{ top, left }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {facts.map((fact) => (
        <p key={fact.label} className="OrgChip-label">
          {fact.label}
          {fact.detail ? <span className="OrgChip-detail"> · {fact.detail}</span> : null}
        </p>
      ))}
      {cites.map((cite) => (
        <a key={cite.url} href={cite.url} target="_blank" rel="noopener noreferrer">
          {cite.name}
        </a>
      ))}
    </div>,
    document.body,
  );
}

function OrgMention({ text, facts }: { text: string; facts: CitableFact[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number>(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const citable = facts.filter((fact) => fact.citation.url);
  if (!citable.length) return text;

  const show = () => {
    window.clearTimeout(hideTimer.current);
    const box = ref.current?.getBoundingClientRect();
    if (box) setPos({ top: box.bottom + 8, left: box.left });
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <span
      ref={ref}
      className="OrgMention"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {text}
      {open ? (
        <OrgChip facts={citable} top={pos.top} left={pos.left} onEnter={show} onLeave={hide} />
      ) : null}
    </span>
  );
}

/** First mention of a fact-bearing org/person on this view. Chip is portaled. */
export function MentionText({ text }: { text: string }) {
  const scope = useMentionScope();
  const hits = findFirstMentions(text, FACT_BEARING, scope?.claimed ?? new Set());
  const kept = hits.filter((hit) => (scope ? scope.claim(hit.orgId) : true));
  if (!kept.length) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  kept.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start));
    nodes.push(<OrgMention key={`${hit.orgId}-${i}`} text={hit.text} facts={hit.facts} />);
    cursor = hit.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
