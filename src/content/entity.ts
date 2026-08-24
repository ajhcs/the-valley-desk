import { z } from "zod";

/** Reed lock. Tag ingest and search only. Never a publish trigger.
 *  v1 does not mint org-id routes or generate entity pages from the 92-entity seed.
 *  Entity pages later only if they read published items. */
export const EntityKind = z.enum([
  "system",
  "hospital",
  "medical-group",
  "person",
  "association",
]);

/** Phila/Bucks/Montgomery/Chester/Delaware + NJ Camden/Burlington/Gloucester/Salem/Atlantic + DE New Castle.
 *  WellSpan / St. Luke's / Geisinger / Hershey are edge only. */
export const ENTITY_BOUNDARY = {
  pa: ["Philadelphia", "Bucks", "Montgomery", "Chester", "Delaware"],
  nj: ["Camden", "Burlington", "Gloucester", "Salem", "Atlantic"],
  de: ["New Castle"],
  edgeOnly: ["WellSpan", "St. Luke's", "Geisinger", "Hershey"],
} as const;

/** Signed first-mention metrics. Do not paint when citation.url is missing. */
export const EntityFactKind = z.enum(["revenue", "margin", "cfo", "ceo", "salary", "education", "other"]);

export const EntityFact = z.object({
  kind: EntityFactKind,
  label: z.string().min(1),
  detail: z.string().optional(),
  filerOrg: z.string().optional(),
  citation: z.object({
    name: z.string(),
    url: z.string().optional(),
  }),
});

export const Entity = z.object({
  id: z.string(),
  kind: EntityKind,
  name: z.string(),
  aliases: z.array(z.string()),
  parentId: z.string().optional(),
  geo: z.string().optional(),
  role: z.string().optional(),
  url: z.string().url().optional(),
  /** Attached org ids. For affiliates that are not a child of one parent and not a merge. */
  orgs: z.array(z.string()).optional(),
  /** Other hospital id that shares this campus. */
  sameSiteAs: z.string().optional(),
  /** True when the campus is outside ENTITY_BOUNDARY (still stored). */
  outOfBox: z.boolean().optional(),
  /** Signed metrics for first-mention ticks. Never mint /org routes. */
  facts: z.array(EntityFact).optional(),
});

export type Entity = z.infer<typeof Entity>;
export type EntityKind = z.infer<typeof EntityKind>;
export type EntityFact = z.infer<typeof EntityFact>;
export type EntityFactKind = z.infer<typeof EntityFactKind>;

export function entityIndex(entities: Entity[]) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const byAlias = new Map<string, Entity>();
  for (const e of entities) {
    for (const key of [e.id, e.name, ...e.aliases]) {
      byAlias.set(key.toLowerCase(), e);
    }
  }
  return {
    byId,
    match(value: string) {
      return byAlias.get(value.toLowerCase());
    },
    resolveOrgs(orgs: string[]) {
      return orgs.map((org) => byAlias.get(org.toLowerCase())?.id ?? org);
    },
  };
}
