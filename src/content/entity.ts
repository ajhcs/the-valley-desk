import { z } from "zod";

/** Reed lock. Tag ingest and search only. Never a publish trigger. */
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

export const Entity = z.object({
  id: z.string(),
  kind: EntityKind,
  name: z.string(),
  aliases: z.array(z.string()),
  parentId: z.string().optional(),
  geo: z.string().optional(),
  role: z.string().optional(),
  url: z.string().url().optional(),
});

export type Entity = z.infer<typeof Entity>;
export type EntityKind = z.infer<typeof EntityKind>;

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
