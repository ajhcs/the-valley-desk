import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { entities } from "../lib/entities";
import {
  factBearingEntities,
  findFirstMentions,
  uniqueCitations,
  type CitableFact,
} from "../lib/entityFacts";
import { placeOrgChip, type Rect } from "../lib/placeOrgChip";
import { useMentionScope } from "./MentionScope";
import { usePrintedFactIds } from "./ItemFacts";

const FACT_BEARING = factBearingEntities(entities);
const GRACE_MS = 160;

function readRect(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function OrgChip({
  id,
  facts,
  top,
  left,
  width,
  height,
  chipRef,
  onEnter,
  onLeave,
}: {
  id: string;
  facts: CitableFact[];
  top: number;
  left: number;
  width: number;
  height: number;
  chipRef: React.RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const cites = uniqueCitations(facts);
  if (!facts.length || !cites.length) return null;
  if (typeof document === "undefined" || !document.body) return null;
  return createPortal(
    <div
      id={id}
      ref={chipRef}
      className="OrgChip"
      role="tooltip"
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxWidth: width,
        maxHeight: height,
        overflow: "auto",
        zIndex: 50,
      }}
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

function OrgMention({
  text,
  facts,
  orgId,
}: {
  text: string;
  facts: CitableFact[];
  orgId: string;
}) {
  const mentionRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320, height: 80 });
  const [inLink, setInLink] = useState(true);
  const reactId = useId();
  const chipId = `org-chip-${orgId}-${reactId.replace(/:/g, "")}`;
  const printed = usePrintedFactIds()[orgId];
  const citable = facts.filter((fact) => fact.citation.url);
  const solo = !inLink && citable.length > 0;

  const place = () => {
    const mention = readRect(mentionRef.current);
    if (!mention) return;
    const chipEl = chipRef.current;
    const chip = chipEl
      ? { width: chipEl.offsetWidth || 320, height: chipEl.offsetHeight || 80 }
      : { width: 320, height: 80 };
    const root = mentionRef.current;
    const mobile = window.innerWidth < 768;
    const leadEl =
      root?.closest(".Lead, .lead, .ItemPage-lead") ??
      document.querySelector(".Lead, .lead, .ItemPage-lead");
    const article =
      root?.closest("article.ItemPage, article.Lead, .Lead, .ItemPage") ??
      document.querySelector("article.ItemPage, article.Lead, .Lead, .ItemPage, .SiteMain");
    setPos(
      placeOrgChip({
        mention,
        chip,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        header: readRect(document.querySelector(".SiteHeader")),
        lead: readRect(leadEl),
        dek: readRect(
          leadEl?.querySelector(".Lead-impact, .Lead-dek, .ItemPage-dek") ??
            document.querySelector(".Lead-impact, .Lead-dek, .ItemPage-dek"),
        ),
        h1: readRect(
          leadEl?.querySelector("h1, .Lead-headline") ??
            document.querySelector(".Lead-headline, .ItemPage-lead h1, .Lead h1"),
        ),
        row: readRect(root?.closest(".RailRow") ?? null),
        news: readRect(document.querySelector('.Rail[data-rail="news"] .RailRow')),
        newsRows: [...document.querySelectorAll('.Rail[data-rail="news"] .RailRow')]
          .map((el) => readRect(el))
          .filter((r): r is Rect => Boolean(r)),
        column: mobile ? readRect(article) : readRect(root?.closest(".Rail") ?? null),
        mobile,
      }),
    );
  };

  const show = () => {
    window.clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const trigger = mentionRef.current?.closest("a");
      if (
        active &&
        (mentionRef.current?.contains(active) ||
          trigger?.contains(active) ||
          chipRef.current?.contains(active))
      ) {
        return;
      }
      setOpen(false);
    }, GRACE_MS);
  };
  const close = () => {
    window.clearTimeout(hideTimer.current);
    setOpen(false);
  };

  useEffect(() => {
    if (open) place();
  }, [open]);

  useLayoutEffect(() => {
    setInLink(Boolean(mentionRef.current?.closest("a")));
  }, []);

  useEffect(() => {
    const mention = mentionRef.current;
    const trigger = mention?.closest("a") ?? null;
    if (!trigger) return;
    const onFocus = () => show();
    const onBlur = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && (trigger.contains(next) || chipRef.current?.contains(next))) return;
      hide();
    };
    trigger.addEventListener("focusin", onFocus);
    trigger.addEventListener("focusout", onBlur);
    return () => {
      trigger.removeEventListener("focusin", onFocus);
      trigger.removeEventListener("focusout", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (mentionRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      if (mentionRef.current?.closest("a")?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  if (!citable.length) return text;

  const describedBy = printed || (open ? chipId : undefined);

  return (
    <>
      <span
        ref={mentionRef}
        className="OrgMention"
        tabIndex={solo ? 0 : undefined}
        role={solo ? "button" : undefined}
        aria-describedby={describedBy}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={solo ? show : undefined}
        onBlur={solo ? hide : undefined}
      >
        {text}
      </span>
      {open ? (
        <OrgChip
          id={chipId}
          facts={citable}
          top={pos.top}
          left={pos.left}
          width={pos.width}
          height={pos.height}
          chipRef={chipRef}
          onEnter={show}
          onLeave={hide}
        />
      ) : null}
    </>
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
    nodes.push(
      <OrgMention key={`${hit.orgId}-${i}`} text={hit.text} facts={hit.facts} orgId={hit.orgId} />,
    );
    cursor = hit.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
