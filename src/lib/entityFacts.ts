import type { Entity, EntityFact } from "../content/entity";
import { hasDefensiveEditorialAside } from "./editorialCopy";

/** Local public/ assets only. Never hotlink. Missing keys fall back to text-only cards. */
export const VERIFIED_ENTITY_MEDIA: Record<string, string> = {
  "org-penn": "/entity-penn-medicine.webp",
  "org-jefferson": "/entity-jefferson-health.webp",
  "org-cooper": "/entity-cooper-health.webp",
  "org-christianacare": "/entity-christianacare.webp",
  "org-main-line": "/entity-main-line-health.webp",
  "org-temple": "/entity-temple-health.webp",
  "org-virtua": "/entity-virtua-health.webp",
  "org-tower": "/entity-tower-health.webp",
  "org-inspira": "/entity-inspira-health.webp",
  "org-hsx": "/entity-hsx.webp",
  "person-luke-olenoski": "/entity-luke-olenoski.webp",
  "person-thomas-f-gordon": "/entity-thomas-gordon.webp",
  "person-bimal-desai": "/entity-bimal-desai.webp",
  "person-robert-hartmann": "/entity-robert-hartmann.webp",
  "person-dave-johnson": "/entity-dave-johnson.webp",
  "person-tom-bartiromo": "/entity-tom-bartiromo.webp",
  "person-hojjat-salmasian": "/entity-hojjat-salmasian.webp",
  "person-jeffrey-pennington": "/entity-jeffrey-pennington.webp",
  "person-benjamin-slovis": "/entity-benjamin-slovis.webp",
};

export type CitableFact = EntityFact & { citation: { name: string; url: string } };

export type FactBearingEntity = {
  id: string;
  kind: Entity["kind"];
  name: string;
  names: string[];
  role?: string;
  orgName?: string;
  url?: string;
  image?: string;
  facts: CitableFact[];
};

export type MentionHit = {
  start: number;
  end: number;
  text: string;
  orgId: string;
  entityName: string;
  kind: Entity["kind"];
  role?: string;
  orgName?: string;
  url?: string;
  image?: string;
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

/** Entity roles also carry ingest/graph notes; disclosure cards expose only the human-facing title. */
export function publicEntityRole(role: string | undefined) {
  if (!role) return undefined;
  return role.split(/\s+[—–]\s+/, 1)[0]?.replace(/\s+only$/i, "").trim() || undefined;
}

function affiliatedOrgName(entity: Entity, byId: Map<string, Entity>) {
  if (entity.kind !== "person") return undefined;
  const parent = entity.parentId ? byId.get(entity.parentId) : undefined;
  if (parent?.name) return parent.name;
  const orgId = entity.orgs?.[0];
  return orgId ? byId.get(orgId)?.name : undefined;
}

/** Public role plus org, without repeating an org already in the title. */
export function publicEntityContext(role: string | undefined, orgName: string | undefined) {
  const title = publicEntityRole(role);
  if (title && orgName) {
    const orgKey = orgName.split(/[–—,]/, 1)[0]?.trim() ?? orgName;
    if (title.toLocaleLowerCase("en-US").includes(orgKey.toLocaleLowerCase("en-US"))) return title;
    return `${title}, ${orgName}`;
  }
  return title || orgName;
}

export function citableFacts(facts: EntityFact[] | undefined): CitableFact[] {
  return (facts ?? []).filter((fact): fact is CitableFact => Boolean(fact.citation?.url?.trim()));
}

function localEntityImage(entity: Entity) {
  const mapped = VERIFIED_ENTITY_MEDIA[entity.id];
  if (mapped?.startsWith("/")) return mapped;
  const raw = entity.image;
  if (raw?.startsWith("/") && !raw.startsWith("//")) return raw;
  return undefined;
}

function isPublicFact(fact: CitableFact) {
  const text = `${fact.label} ${fact.detail ?? ""}`;
  if (/do not merge|not a merge|not enterprise|graph note|out-of-box/i.test(text)) return false;
  if (hasDefensiveEditorialAside(text)) return false;
  return Boolean(fact.citation.url);
}

/** Only entities with at least one fact that has citation.url. */
export function factBearingEntities(entities: Entity[]): FactBearingEntity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  return entities
    .map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      names: uniqueNames(entity),
      role: publicEntityContext(entity.role, affiliatedOrgName(entity, byId)),
      orgName: affiliatedOrgName(entity, byId),
      url: entity.url,
      image: localEntityImage(entity),
      facts: citableFacts(entity.facts).filter(isPublicFact),
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
        entityName: entity.name,
        kind: entity.kind,
        role: entity.role,
        orgName: entity.orgName,
        url: entity.url,
        image: entity.image,
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

/** Declared org ids plus parents, children, and people on that graph. Text mentions do not expand it. */
export function itemOrgGraph(
  item: { orgs?: string[] },
  entities: readonly Entity[],
): Set<string> {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const allowed = new Set(item.orgs ?? []);
  for (const id of [...allowed]) {
    let current = byId.get(id);
    while (current?.parentId && !allowed.has(current.parentId)) {
      allowed.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const entity of entities) {
      if (allowed.has(entity.id)) continue;
      if (entity.parentId && allowed.has(entity.parentId)) {
        allowed.add(entity.id);
        grew = true;
      }
    }
  }
  for (const entity of entities) {
    if (entity.kind !== "person" || allowed.has(entity.id)) continue;
    if (entity.parentId && allowed.has(entity.parentId)) allowed.add(entity.id);
    else if (entity.orgs?.some((org) => allowed.has(org))) allowed.add(entity.id);
  }
  return allowed;
}

function factEntitiesForItem(item: { orgs?: string[] }, entities: Entity[]) {
  const allowed = itemOrgGraph(item, entities);
  return factBearingEntities(entities).filter((entity) => allowed.has(entity.id));
}

/** First-mention signed facts in title + dek + body. Hover line and item-page print share this list. */
export function itemSignedFacts(
  item: { title?: string; impactSentence?: string; body?: string; orgs?: string[] },
  entities: Entity[],
) {
  const text = [item.title, item.impactSentence, item.body].filter(Boolean).join("\n");
  return findFirstMentions(text, factEntitiesForItem(item, entities));
}

/** CC paints NPSR, never the words "Net patient service revenue". Other labels stay Sloan signs. */
export function paintSignedLabel(label: string) {
  return label.replace(/^Net patient service revenue\b/i, "NPSR");
}

export function signedFactText(fact: Pick<CitableFact, "label" | "detail">) {
  const label = paintSignedLabel(fact.label);
  return fact.detail ? `${label} · ${fact.detail}` : label;
}

/** Hover-inserted dek line includes the painted name. */
export function signedHoverLine(name: string, fact: CitableFact) {
  return `${name} ${signedFactText(fact)} · ${fact.citation.name}`;
}

/** Item-page rest print does not repeat the painted name. */
export function signedPrintLine(fact: CitableFact) {
  return `${signedFactText(fact)} · ${fact.citation.name}`;
}

/** Paint-ready facts. Stored operating lines stay on the entity; they do not print or hover. */
export function displayFacts(facts: CitableFact[]): CitableFact[] {
  return facts.filter(
    (fact) =>
      isPublicFact(fact) && !/operating/i.test(`${fact.label} ${fact.detail ?? ""}`),
  );
}

const ABBREV = new Set([
  "apr",
  "aug",
  "ch",
  "dec",
  "del",
  "dr",
  "feb",
  "inc",
  "jan",
  "jul",
  "jun",
  "mar",
  "mr",
  "mrs",
  "ms",
  "no",
  "nov",
  "oct",
  "sep",
  "sept",
  "sr",
  "st",
  "vs",
]);

/** Insert the signed line after the first dek sentence. Protects Oct. 3 / U.S. */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const re = /[.!?](?:\s+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[0][0] === ".") {
      const word = text.slice(0, match.index).match(/([A-Za-z]+)$/)?.[1] ?? "";
      if (word.length <= 1 || ABBREV.has(word.toLowerCase())) continue;
    }
    const end = match.index + 1;
    return { first: text.slice(0, end), rest: text.slice(end) };
  }
  return { first: text, rest: "" };
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
