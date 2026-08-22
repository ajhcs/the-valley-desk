/** Live seed org ids come from fixtures/entities.json. Do not invent ids. */

/** Closed systems are stored later; they are not live neighbors for latestNews or spill. */
export const CLOSED_LIVE_SEED_IDS = new Set(["org-crozer"]);

export function liveSeedOrgIds(entities: readonly { id: string }[]): Set<string> {
  return new Set(entities.map((e) => e.id).filter((id) => !CLOSED_LIVE_SEED_IDS.has(id)));
}

export function hasLiveSeedOrg(
  orgs: readonly string[],
  seedIds: ReadonlySet<string>,
): boolean {
  return orgs.some((id) => seedIds.has(id));
}
