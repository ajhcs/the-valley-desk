import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { entities } from "../lib/entities";
import {
  displayFacts,
  itemOrgGraph,
  itemSignedFacts,
  signedFactText,
  type MentionHit,
} from "../lib/entityFacts";

export const PrintedFactIds = createContext<Record<string, string>>({});
export const AllowedOrgIds = createContext<ReadonlySet<string> | null>(null);

export function usePrintedFactIds() {
  return useContext(PrintedFactIds);
}

export function useAllowedOrgIds() {
  return useContext(AllowedOrgIds);
}

export function itemFactHits(item: { title?: string; impactSentence?: string; body?: string; orgs?: string[] }) {
  return itemSignedFacts(item, entities);
}

export function itemAllowedOrgIds(item: { orgs?: string[] }) {
  return itemOrgGraph(item, entities);
}

export function printedFactIds(hits: MentionHit[]) {
  return Object.fromEntries(hits.map((hit) => [hit.orgId, `item-fact-${hit.orgId}`]));
}

export function ItemFactScope({
  hits,
  allowed,
  children,
}: {
  hits: MentionHit[];
  allowed?: ReadonlySet<string>;
  children: ReactNode;
}) {
  const ids = useMemo(() => printedFactIds(hits), [hits]);
  const allowedIds = useMemo(() => allowed ?? null, [allowed]);
  return (
    <AllowedOrgIds.Provider value={allowedIds}>
      <PrintedFactIds.Provider value={ids}>{children}</PrintedFactIds.Provider>
    </AllowedOrgIds.Provider>
  );
}

export function EntityDisclosure({
  hit,
  factId,
  compact = false,
}: {
  hit: MentionHit;
  factId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const cardId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);
  const facts = displayFacts(hit.facts).slice(0, 1);
  const primary = facts[0];
  const imageSrc = hit.image && hit.image.startsWith("/") && !hit.image.startsWith("//") ? hit.image : undefined;

  const show = () => {
    window.clearTimeout(closeTimer.current);
    const bounds = root.current?.getBoundingClientRect();
    setAlignRight(Boolean(bounds && bounds.left + 380 > window.innerWidth));
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };
  const toggle = () => {
    window.clearTimeout(closeTimer.current);
    if (open) hide();
    else show();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      hide();
      triggerRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!primary) return null;
  return (
    <span
      ref={root}
      className={`EntityDisclosure${alignRight ? " is-align-right" : ""}`}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) show();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideSoon();
      }}
    >
      {compact ? (
        <button
          type="button"
          className="OrgTick is-help"
          ref={triggerRef}
          aria-expanded={open}
          aria-controls={cardId}
          aria-haspopup="dialog"
          aria-label={`${hit.entityName} details`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          }}
        />
      ) : (
        <button
          type="button"
          className="EntityDisclosure-trigger"
          ref={triggerRef}
          aria-expanded={open}
          aria-controls={cardId}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          }}
        >
          {hit.entityName}
        </button>
      )}
      {open ? (
        <span id={cardId} className="EntityDisclosure-card" role="dialog" aria-label={`${hit.entityName} details`}>
          {imageSrc && !imageFailed ? (
            <img
              className={`EntityDisclosure-image is-${hit.kind === "person" ? "person" : "organization"}`}
              src={imageSrc}
              alt=""
              width={hit.kind === "person" ? 56 : 88}
              height="56"
              onError={() => setImageFailed(true)}
            />
          ) : null}
          <span className="EntityDisclosure-copy">
            <strong>{hit.entityName}</strong>
            {hit.role ? <span className="EntityDisclosure-role">{hit.role}</span> : null}
            <span id={factId} className="EntityDisclosure-fact">{signedFactText(primary)}</span>
            <span className="EntityDisclosure-links">
              <a href={primary.citation.url} target="_blank" rel="noopener noreferrer">
                View data · {primary.citation.name}
              </a>
              {hit.url && hit.url !== primary.citation.url ? (
                <a href={hit.url} target="_blank" rel="noopener noreferrer">Profile</a>
              ) : null}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Compact, sourced entity disclosures beside the article date/byline. */
export function ItemEntityLinks({ hits }: { hits: MentionHit[] }) {
  if (!hits.length) return null;
  const ids = printedFactIds(hits);
  return (
    <span className="ItemEntities" aria-label="Related institutions and people">
      {hits.map((hit) => (
        <EntityDisclosure key={hit.orgId} hit={hit} factId={ids[hit.orgId]} />
      ))}
    </span>
  );
}

/** Compatibility export for code/tests that still name the former inline fact block. */
export const ItemFacts = ItemEntityLinks;
