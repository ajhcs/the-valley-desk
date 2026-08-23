import type { Entity } from "../content/entity";

const WORD = /[^a-z0-9]+/gi;

function hay(value: string) {
  return ` ${value.toLowerCase().replace(WORD, " ")} `;
}

/** Map seed org ids from title/body. Systems and associations only. Empty stays empty. */
export function mapSeedOrgIds(text: string, entities: readonly Entity[]): string[] {
  const blob = hay(text);
  const hits: { id: string; n: number }[] = [];
  for (const entity of entities) {
    if (entity.kind !== "system" && entity.kind !== "association") continue;
    const keys = [entity.name, ...entity.aliases].filter(Boolean);
    const matched = keys.some((key) => blob.includes(hay(key)));
    if (matched) hits.push({ id: entity.id, n: entity.name.length });
  }
  hits.sort((a, b) => b.n - a.n);
  return [...new Set(hits.map((h) => h.id))];
}
