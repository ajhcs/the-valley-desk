import type { Entity, EntityFact } from "../content/entity";

export type CitableFact = EntityFact & { citation: { name: string; url: string } };

export type FactBearingEntity = {
  id: string;
  kind: Entity["kind"];
  names: string[];
  facts: CitableFact[];
};

export type MentionHit = {
  start: number;
  end: number;
  text: string;
  orgId: string;
  facts: CitableFact[];
};

function uniqueNames(entity: Entity) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of [entity.name, ...entity.aliases]) {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => b.length - a.length);
}

export function citableFacts(facts: EntityFact[] | undefined): CitableFact[] {
  return (facts ?? []).filter((fact): fact is CitableFact => Boolean(fact.citation?.url?.trim()));
}

/** Only entities with at least one fact that has citation.url. */
export function factBearingEntities(entities: Entity[]): FactBearingEntity[] {
  return entities
    .map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      names: uniqueNames(entity),
      facts: citableFacts(entity.facts),
    }))
    .filter((entity) => entity.facts.length > 0);
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First mention of each fact-bearing entity in `text`, skipping already-claimed ids. */
export function findFirstMentions(
  text: string,
  entities: FactBearingEntity[],
  claimed: ReadonlySet<string> = new Set(),
): MentionHit[] {
  const found: MentionHit[] = [];
  for (const entity of entities) {
    if (claimed.has(entity.id)) continue;
    for (const name of entity.names) {
      const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRe(name)})(?![A-Za-z0-9])`, "gi");
      const match = re.exec(text);
      if (!match) continue;
      const start = match.index + match[1].length;
      found.push({
        start,
        end: start + match[2].length,
        text: text.slice(start, start + match[2].length),
        orgId: entity.id,
        facts: entity.facts,
      });
      break;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: MentionHit[] = [];
  const used = new Set<string>();
  const spans: [number, number][] = [];
  for (const hit of found) {
    if (used.has(hit.orgId)) continue;
    if (spans.some(([start, end]) => hit.start < end && hit.end > start)) continue;
    used.add(hit.orgId);
    spans.push([hit.start, hit.end]);
    kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function uniqueCitations(facts: CitableFact[]) {
  const seen = new Set<string>();
  const cites: { name: string; url: string }[] = [];
  for (const fact of facts) {
    if (seen.has(fact.citation.url)) continue;
    seen.add(fact.citation.url);
    cites.push(fact.citation);
  }
  return cites;
}
