import { REGIONAL_CHANNELS } from "./regional-contracts";
import type { RegionalChannel, RegionalInventory } from "./regional-contracts";
import { isSuccessfulSourceState } from "./source-health";
import type { PersistedSourceHealth } from "./source-health";

export type CoverageSource = { id: string; institutionId: string; channel: RegionalChannel;
  status: "configured" | "inventory-only" | "planned" | "disabled"; maxAgeHours: number; url: string };
export type CoverageInstitution = { id: string; name: string; scope: string };
export function regionalCoverageInputs(inventory: RegionalInventory,
  existingInstitutions: readonly { id: string; name: string; covered: boolean; edge: boolean }[],
  existingOfficialSources: readonly { id: string; institutionId?: string; category: string; status: string; url: string }[],
  existingLeadershipSources: readonly { id: string; institutionId: string; kind: string; status: string; monitor: boolean; cadence: string; url: string }[] = []) {
  const institutions: CoverageInstitution[] = existingInstitutions.map(row => ({ id: row.id, name: row.name,
    scope: row.edge ? "edge" : row.covered ? "configured-monitor-set" : "inventory-only" }));
  const sources: CoverageSource[] = existingOfficialSources.filter(row => row.institutionId && row.category === "news")
    .map(row => ({ id: row.id, institutionId: row.institutionId!, channel: "news", url: row.url,
      status: row.status === "enabled" ? "configured" : "disabled", maxAgeHours: 2 }));
  for (const row of existingLeadershipSources.filter(source => !source.kind.startsWith("linkedin"))) {
    sources.push({ id: row.id, institutionId: row.institutionId, channel: "people", url: row.url,
      status: row.status === "disabled" ? "disabled" : row.status === "enabled" && row.monitor ? "configured" : "inventory-only",
      maxAgeHours: row.cadence === "hourly" ? 2 : row.cadence === "daily" ? 48 : 24 * 8 });
  }
  for (const row of inventory.institutions) {
    if (!institutions.some(existing => existing.id === (row.existingInstitutionId ?? row.id)))
      institutions.push({ id: row.existingInstitutionId ?? row.id, name: row.name, scope: row.regionalScope });
  }
  for (const row of inventory.sources) sources.push({ ...row,
    institutionId: inventory.institutions.find(institution => institution.id === row.institutionId)?.existingInstitutionId ?? row.institutionId });
  return { institutions, sources };
}
export function buildRegionalCoverageReport(input: {
  institutions: readonly CoverageInstitution[]; sources: readonly CoverageSource[];
  health?: readonly PersistedSourceHealth[]; asOf: string;
}) {
  const now = Date.parse(input.asOf);
  if (!Number.isFinite(now)) throw new Error("invalid-coverage-as-of");
  if (new Set(input.sources.map(row => row.id)).size !== input.sources.length ||
      new Set(input.institutions.map(row => row.id)).size !== input.institutions.length) throw new Error("duplicate-coverage-identity");
  const institutions = new Set(input.institutions.map(row => row.id));
  if (input.sources.some(source => !institutions.has(source.institutionId) || !Number.isFinite(source.maxAgeHours) || source.maxAgeHours <= 0))
    throw new Error("invalid-coverage-source");
  const healthRows = input.health ?? [];
  if (new Set(healthRows.map(row => row.sourceId)).size !== healthRows.length) throw new Error("duplicate-source-health");
  const health = new Map(healthRows.map(row => [row.sourceId, row]));
  const rows = input.institutions.map(institution => ({ ...institution, channels: REGIONAL_CHANNELS.map(channel => {
    const channelSources = input.sources.filter(source => source.institutionId === institution.id && source.channel === channel);
    const details = channelSources.map(source => {
      const receipt = health.get(source.id);
      let freshness: "unknown" | "fresh" | "stale" | "not-active" = "unknown";
      let warning: string | null = null;
      if (source.status !== "configured") freshness = "not-active";
      else if (receipt) {
        const checked = Date.parse(receipt.lastCheckedAt), success = Date.parse(receipt.lastSuccessAt ?? "");
        if (!Number.isFinite(checked) || checked > now || (receipt.lastSuccessAt !== null && !Number.isFinite(success)) || (Number.isFinite(success) && success > checked)) warning = "invalid-health-timestamps";
        else {
          if (receipt.state === "disabled" || receipt.state === "misconfigured") freshness = "not-active";
          else if (Number.isFinite(success)) freshness = now - success <= source.maxAgeHours * 3_600_000 ? "fresh" : "stale";
          if (!isSuccessfulSourceState(receipt.state)) warning = receipt.state;
        }
      }
      return { sourceId: source.id, url: source.url, configuration: source.status, freshness,
        sourceState: receipt?.state ?? null, lastCheckedAt: receipt?.lastCheckedAt ?? null,
        lastSuccessAt: receipt?.lastSuccessAt ?? null, warning };
    });
    const configured = details.filter(source => source.configuration === "configured");
    const missing = !channelSources.length;
    return { channel, missing, configuredSources: configured.length,
      inventorySources: details.filter(source => source.configuration === "inventory-only").length,
      plannedSources: details.filter(source => source.configuration === "planned").length,
      freshSources: configured.filter(source => source.freshness === "fresh").length,
      staleSources: configured.filter(source => source.freshness === "stale").length,
      unobservedSources: configured.filter(source => source.freshness === "unknown").length,
      sources: details,
      gaps: missing ? ["no-registered-source"] : configured.length === 0 ? ["collection-not-qualified-or-active"] :
        configured.every(source => source.freshness !== "fresh") ? ["no-current-success-receipt"] : [],
    }; }) }));
  return { schemaVersion: 1, asOf: input.asOf, scope: "registered-inventory-only", collectionAuthorized: false,
    publicationAuthorized: false, institutionCount: rows.length,
    missingChannels: rows.flatMap(row => row.channels.filter(channel => channel.missing).map(channel => ({ institutionId: row.id, channel: channel.channel }))),
    unregisteredHealthSourceIds: healthRows.filter(row => !input.sources.some(source => source.id === row.sourceId)).map(row => row.sourceId),
    institutions: rows };
}
