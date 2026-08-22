import { z } from "zod";

/** Used to tag ingest and search. Never a publish trigger. */
export const EntityKind = z.enum([
  "system",
  "hospital",
  "clinic",
  "person",
  "association",
]);

export const Entity = z.object({
  id: z.string(),
  kind: EntityKind,
  name: z.string(),
  aliases: z.array(z.string()),
  parentId: z.string().optional(),
  geo: z.string().optional(),
  role: z.string().optional(),
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
    /** Map ContentItem.orgs[] (id or alias) to entity ids. Unmatched names stay as-is. */
    resolveOrgs(orgs: string[]) {
      return orgs.map((org) => byAlias.get(org.toLowerCase())?.id ?? org);
    },
  };
}
