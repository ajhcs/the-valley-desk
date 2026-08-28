import type { Entity } from "../content/entity";

const WORD = /[^a-z0-9]+/gi;

/**
 * These aliases are also ordinary words, names, or acronyms. They may only
 * map when the source uses them as part of an institutional phrase. A
 * first-party source can still provide an exact fixed org id independently;
 * this guard only applies to inferred text matches.
 */
const GENERIC_ALIASES = new Set([
  "penn",
  "jefferson",
  "main line",
  "chop",
  "cooper",
  "temple",
  "virtua",
  "tower",
  "inspira",
  "hap",
  "dha",
  "dhss",
  "hsx",
  "st luke s",
  "st lukes",
]);

const INSTITUTIONAL_CUE = "(?:health(?:care)?|hospital|medical|medicine|network|system)";

function aliasPattern(value: string) {
  return value.split(" ").filter(Boolean).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
}

function isContextualGenericAlias(blob: string, alias: string) {
  const normalized = alias.trim();
  if (!GENERIC_ALIASES.has(normalized)) return true;
  const pattern = aliasPattern(normalized);
  // Require the generic word to participate in a recognizable health-system
  // phrase. This intentionally does not treat a person's name plus a distant
  // health-related word as an organization match (for example, "Alice
  // Cooper's health").
  const suffix = `(?:university\\s+)?${INSTITUTIONAL_CUE}(?:\\s+${INSTITUTIONAL_CUE}){0,2}`;
  const prefix = `(?:${INSTITUTIONAL_CUE}\\s+){1,3}`;
  return new RegExp(`\\b${pattern}\\b\\s+${suffix}\\b`, "i").test(blob)
    || new RegExp(`\\b${prefix}${pattern}\\b`, "i").test(blob);
}

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
    const matched = keys.some((key) => {
      const normalized = hay(key).trim();
      return blob.includes(` ${normalized} `) && isContextualGenericAlias(blob, normalized);
    });
    if (matched) hits.push({ id: entity.id, n: entity.name.length });
  }
  hits.sort((a, b) => b.n - a.n);
  return [...new Set(hits.map((h) => h.id))];
}
