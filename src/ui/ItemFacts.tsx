import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { entities } from "../lib/entities";
import { itemSignedFacts, signedFactText, uniqueCitations, type MentionHit } from "../lib/entityFacts";

export const PrintedFactIds = createContext<Record<string, string>>({});

export function usePrintedFactIds() {
  return useContext(PrintedFactIds);
}

export function itemFactHits(item: { title?: string; impactSentence?: string; body?: string }) {
  return itemSignedFacts(item, entities);
}

export function printedFactIds(hits: MentionHit[]) {
  return Object.fromEntries(hits.map((hit) => [hit.orgId, `item-fact-${hit.orgId}`]));
}

export function ItemFactScope({
  hits,
  children,
}: {
  hits: MentionHit[];
  children: ReactNode;
}) {
  const ids = useMemo(() => printedFactIds(hits), [hits]);
  return <PrintedFactIds.Provider value={ids}>{children}</PrintedFactIds.Provider>;
}

/** Liability print under the dek. Rest print does not repeat the painted name. */
export function ItemFacts({ hits }: { hits: MentionHit[] }) {
  if (!hits.length) return null;
  const ids = printedFactIds(hits);
  return (
    <section className="ItemFacts">
      {hits.flatMap((hit) => {
        const cites = uniqueCitations(hit.facts);
        return hit.facts.map((fact, i) => (
          <p key={`${hit.orgId}-${fact.label}`} id={i === 0 ? ids[hit.orgId] : undefined}>
            {signedFactText(fact)}
            {cites.map((cite) => (
              <span key={cite.url}>
                {" · "}
                <a href={cite.url} target="_blank" rel="noopener noreferrer">
                  {cite.name}
                </a>
              </span>
            ))}
          </p>
        ));
      })}
    </section>
  );
}
