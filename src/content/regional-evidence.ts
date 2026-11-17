import { legacyOffsetDatetime } from "../lib/schema-compat";
import { z } from "zod";
import { isCalendarDay } from "./watch-schema";
import { RegionalInventory, permittedPublicUrl, regionalPublicUrlProjection } from "../ingest/regional-contracts";
import { buildRegionalCoverageReport, regionalCoverageInputs } from "../ingest/regional-coverage";
import { SOURCE_RUN_STATES } from "../ingest/source-health";
import type { PersistedSourceHealth } from "../ingest/source-health";
import { buildRuntimeLeadershipCoverage, leadershipFreshnessBudgetMs } from "../lib/operational-status";

/** The existing monitor denominator includes its two geographic edge institutions. */
export const CORE_REGIONAL_MONITOR_IDS = Object.freeze([
  "inst-penn", "inst-jefferson", "inst-main-line", "inst-chop", "inst-cooper",
  "inst-christianacare", "inst-temple", "inst-virtua", "inst-tower", "inst-inspira",
  "inst-lvhn", "inst-penn-princeton", "inst-penn-doylestown", "inst-nemours",
  "inst-rwjbarnabas", "inst-st-lukes",
] as const);

const Id = z.string().regex(/^[a-z][a-z0-9-]+$/).max(200);
const Instant = legacyOffsetDatetime().refine(value => isCalendarDay(value.slice(0, 10)));
const PublicUrl = z.string().max(2048).refine(value => permittedPublicUrl(value));
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const Relation = z.enum(["newsroom-serves-institution", "repository-includes-institutional-work", "institution-links-repository"]);
const EvidenceKind = z.enum(["source-scope", "article", "profile", "committee", "repository-work", "repository-link"]);

/** These records preserve delegated research, not fabricated captures or verified employment. */
const ScopeEvidence = z.object({
  id: Id, sourceId: Id, kind: EvidenceKind,
  basis: z.enum(["delegated-research-summary", "existing-inventory-declaration"]),
  url: PublicUrl, summary: z.string().min(3).max(2000),
  institutionIds: z.array(Id).min(1).max(20).refine(unique),
  inventoryEvidenceId: Id.nullable(),
  observedAt: z.null(), representationSha256: z.null(),
}).strict().superRefine((row, ctx) => {
  if ((row.basis === "existing-inventory-declaration") !== (row.inventoryEvidenceId !== null))
    ctx.addIssue({ code: "custom", message: "inventory evidence pointer required only for inventory declarations" });
});
export const RegionalEvidenceInventory = z.object({
  schemaVersion: z.literal(1), status: z.literal("review-only"),
  collectionAuthorized: z.literal(false), publicationAuthorized: z.literal(false),
  coreMonitorIds: z.array(Id).length(16).refine(unique),
  additionalInstitutionScopes: z.array(z.object({ id: Id, name: z.string().min(2).max(200) }).strict()).max(20),
  evidence: z.array(ScopeEvidence).max(200),
  relationships: z.array(z.object({ id: Id, sourceId: Id, institutionId: Id,
    relation: Relation, evidenceIds: z.array(Id).min(1).max(10).refine(unique), status: z.literal("review-only") }).strict()).max(200),
}).strict().superRefine((inventory, ctx) => {
  if (!CORE_REGIONAL_MONITOR_IDS.every(id => inventory.coreMonitorIds.includes(id)))
    ctx.addIssue({ code: "custom", message: "fixed core monitor IDs changed" });
  for (const rows of [inventory.additionalInstitutionScopes, inventory.evidence, inventory.relationships])
    if (!unique(rows.map(row => row.id))) ctx.addIssue({ code: "custom", message: "duplicate scope identity" });
  const evidence = new Map(inventory.evidence.map(row => [row.id, row]));
  const pairs = inventory.relationships.map(row => `${row.sourceId}:${row.institutionId}:${row.relation}`);
  if (!unique(pairs)) ctx.addIssue({ code: "custom", message: "duplicate source institution relationship" });
  for (const link of inventory.relationships) for (const id of link.evidenceIds) {
    const citation = evidence.get(id);
    const permittedKind = link.relation === "institution-links-repository" ? "repository-link" : "source-scope";
    if (!citation || citation.sourceId !== link.sourceId || !citation.institutionIds.includes(link.institutionId)
      || citation.kind !== permittedKind)
      ctx.addIssue({ code: "custom", message: "relationship lacks evidence for its exact source, institution and kind" });
  }
});
export type RegionalEvidenceInventory = z.infer<typeof RegionalEvidenceInventory>;

// Runtime identities include the existing source "x"; retain strict inventory IDs above.
const HealthSourceId = z.string().regex(/^[a-z][a-z0-9-]*$/).max(200);
const Health = z.object({ sourceId: HealthSourceId, state: z.enum(SOURCE_RUN_STATES),
  lastCheckedAt: Instant, lastSuccessAt: Instant.nullable() }).strict();
const LeadershipRuntime = z.object({ sourceId: Id, institutionId: Id,
  state: z.enum(["pending", "healthy", "unchanged", "hostile", "blocked", "disabled", "inventory-only", "misconfigured", "upstream-failed", "timed-out"]),
  lastSuccessAt: Instant.nullable(), lastAttemptedAt: Instant.nullable(), nextAttemptAt: Instant.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
}).strict();
export type RegionalEvidenceLeadershipReceipt = z.infer<typeof LeadershipRuntime>;

/** Pure offline review projection. It installs no collector, registry, route or publication gate. */
export function buildRegionalEvidenceReview(input: {
  scopeInventory: unknown; inventory: unknown;
  existingInstitutions: Parameters<typeof regionalCoverageInputs>[1];
  existingOfficialSources: Parameters<typeof regionalCoverageInputs>[2];
  existingLeadershipSources?: Parameters<typeof regionalCoverageInputs>[3];
  health?: readonly PersistedSourceHealth[];
  leadershipRuntime?: readonly RegionalEvidenceLeadershipReceipt[];
  asOf: string;
}) {
  const asOf = Instant.parse(input.asOf), now = Date.parse(asOf);
  const scope = RegionalEvidenceInventory.parse(input.scopeInventory);
  const inventory = RegionalInventory.parse(input.inventory);
  if (Date.parse(inventory.preparedAt) > now) throw new Error("inventory-later-than-review");
  const covered = input.existingInstitutions.filter(row => row.covered).map(row => row.id);
  if (covered.length !== 16 || !unique(covered) || !CORE_REGIONAL_MONITOR_IDS.every(id => covered.includes(id)))
    throw new Error("fixed-core-monitor-mismatch");
  const inputs = regionalCoverageInputs(inventory, input.existingInstitutions,
    input.existingOfficialSources, input.existingLeadershipSources);
  const sourceIds = new Set(inputs.sources.map(row => row.id));
  const sourceById = new Map(inputs.sources.map(row => [row.id, row]));
  const institutionIds = new Set(inputs.institutions.map(row => row.id));
  for (const extra of scope.additionalInstitutionScopes) {
    if (institutionIds.has(extra.id)) throw new Error("duplicate-additional-institution");
    institutionIds.add(extra.id);
  }
  const citations = new Map(inventory.evidence.map(row => [row.id, row]));
  for (const citation of scope.evidence) {
    if (!sourceIds.has(citation.sourceId) || citation.institutionIds.some(id => !institutionIds.has(id)))
      throw new Error("unknown-scope-evidence-identity");
    if (new URL(citation.url).hostname !== new URL(sourceById.get(citation.sourceId)!.url).hostname)
      throw new Error("scope-evidence-source-host-mismatch");
    if (citation.inventoryEvidenceId) {
      const original = citations.get(citation.inventoryEvidenceId);
      const proposal = inventory.sources.find(row => row.id === citation.sourceId);
      if (!original || original.url !== citation.url || !proposal?.evidenceIds.includes(original.id)
        || citation.institutionIds.some(id => id !== (inventory.institutions.find(row => row.id === proposal.institutionId)?.existingInstitutionId ?? proposal.institutionId)))
        throw new Error("inventory-evidence-scope-mismatch");
    }
  }
  for (const link of scope.relationships) {
    if (!sourceIds.has(link.sourceId) || !institutionIds.has(link.institutionId)) throw new Error("unknown-relationship-identity");
    const channel = link.relation === "newsroom-serves-institution" ? "news"
      : link.relation === "repository-includes-institutional-work" ? "research" : "github";
    if (sourceById.get(link.sourceId)!.channel !== channel) throw new Error("relationship-source-channel-mismatch");
  }
  if ((input.health?.length ?? 0) > 1000 || (input.leadershipRuntime?.length ?? 0) > 1000)
    throw new Error("too-many-review-receipts");
  const health: PersistedSourceHealth[] = (input.health ?? []).map(row => ({
    ...Health.parse({ sourceId: row.sourceId, state: row.state, lastCheckedAt: row.lastCheckedAt, lastSuccessAt: row.lastSuccessAt }),
    itemCount: 0, complete: false, consecutiveFailures: 0, lastError: null,
    nextAttemptAt: asOf, lastHttpStatus: null, requiresAuth: false,
  }));
  const report = buildRegionalCoverageReport({ ...inputs, health, asOf });
  const healthBySource = new Map(report.institutions.flatMap(row => row.channels.flatMap(channel => channel.sources.map(source => [source.sourceId, source] as const))));
  // The production scheduler has a different receipt vocabulary and clock from generic source health.
  const runtime = (input.leadershipRuntime ?? []).map(row => LeadershipRuntime.parse(row));
  if (!unique(runtime.map(row => row.sourceId))) throw new Error("duplicate-leadership-receipt");
  const configuredLeadership = input.existingLeadershipSources ?? [];
  for (const row of runtime) {
    const registry = configuredLeadership.find(source => source.id === row.sourceId && !source.kind.startsWith("linkedin"));
    if (!registry || registry.institutionId !== row.institutionId) throw new Error("leadership-receipt-registry-mismatch");
    if ((row.lastSuccessAt && (!row.lastAttemptedAt || Date.parse(row.lastSuccessAt) > Date.parse(row.lastAttemptedAt)))
      || (row.lastAttemptedAt && Date.parse(row.lastAttemptedAt) > now)) throw new Error("invalid-leadership-receipt-times");
  }
  const sourceDetails = inputs.sources.map(source => {
    const url = regionalPublicUrlProjection(source.url);
    if (!url) throw new Error("invalid-review-source-url");
    const collection = healthBySource.get(source.id)!;
    const registry = configuredLeadership.find(row => row.id === source.id && !row.kind.startsWith("linkedin"));
    const receipt = runtime.find(row => row.sourceId === source.id);
    const operational = registry ? buildRuntimeLeadershipCoverage([
      { institutionId: registry.institutionId, shortName: registry.institutionId,
        configuredStatus: source.status === "configured" ? "active" : "degraded", sourceIds: [source.id] },
    ], receipt ? [{ ...receipt, cadence: registry.cadence }] : [], new Date(now))[0].sourceStates[0] : null;
    return { sourceId: source.id, channel: source.channel, registryInstitutionId: source.institutionId,
      url, configuration: source.status,
      sourceHealth: { freshness: collection.freshness, state: collection.sourceState,
        lastCheckedAt: collection.lastCheckedAt, lastSuccessAt: collection.lastSuccessAt, warning: collection.warning,
        budgetMs: source.maxAgeHours * 3_600_000, basis: "existing-regional-read-projection" },
      leadershipOperational: registry ? {
        cadence: registry.cadence, budgetMs: leadershipFreshnessBudgetMs(registry.cadence),
        basis: "operational-status.leadershipFreshnessBudgetMs",
        freshness: source.status !== "configured" ? "not-active" : !receipt || !receipt.lastSuccessAt ? "unknown"
          : operational!.coverageCurrent ? "fresh" : "stale",
        freshUntilAt: source.status === "configured" ? operational!.freshUntilAt : null,
        lastSuccessAt: receipt?.lastSuccessAt ?? null,
        clockDiffersFromReadProjection: source.maxAgeHours * 3_600_000 !== leadershipFreshnessBudgetMs(registry.cadence),
      } : null,
    };
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const evidenceDetails = scope.evidence.map(row => ({
    ...row, url: regionalPublicUrlProjection(row.url)!, status: "review-only" as const,
    evidenceVerifiedByThisSlice: false, currentEmployment: "unknown" as const,
    completeLeadershipRoster: "unknown" as const, repositoryOwnership: "unknown" as const,
  }));
  const relationships = scope.relationships.map(row => ({ ...row,
    evidenceBasis: "source-scope-declarations", institutionCoverageFreshness: "unknown" as const,
    contentAttributionQualified: false, currentEmployment: "unknown" as const,
    completeLeadershipRoster: "unknown" as const, repositoryOwnership: "unknown" as const,
  }));
  const news = inputs.sources.filter(row => row.channel === "news" && covered.includes(row.institutionId));
  const coreNews = CORE_REGIONAL_MONITOR_IDS.map(institutionId => {
    const declared = news.filter(row => row.institutionId === institutionId);
    const links = relationships.filter(row => row.institutionId === institutionId && row.relation === "newsroom-serves-institution");
    return { institutionId, name: input.existingInstitutions.find(row => row.id === institutionId)!.name,
      registrySourceIds: declared.map(row => row.id).sort(), relationshipSourceIds: [...new Set(links.map(row => row.sourceId))].sort(),
      attributionState: declared.length ? "registry-attribution" : links.length ? "attribution-gap" : "registration-gap",
      newsExistence: "unknown", institutionCoverageFreshness: "unknown", contentAttributionQualified: false,
      gapMeaning: declared.length ? null : "No qualified institution attribution in this input; news existence is unknown.",
    };
  });
  return {
    schemaVersion: 1, asOf, status: "review-only", collectionAuthorized: false, publicationAuthorized: false,
    collectorActivatedByThisSlice: false, completeInstitutionCoverageClaimed: false, untrustedText: true,
    coreMonitorIds: [...CORE_REGIONAL_MONITOR_IDS],
    counts: { coreInstitutions: 16, coreNewsRegistrySources: news.length,
      coreInstitutionsWithNewsRegistryAttribution: new Set(news.map(row => row.institutionId)).size,
      // Exhaustive complement of registry attribution across the fixed core set.
      coreNewsAttributionGaps: coreNews.filter(row => row.registrySourceIds.length === 0).length,
      coreNewsReviewScopeAttributionGaps: coreNews.filter(row => row.attributionState === "attribution-gap").length,
      coreNewsRegistrationGaps: coreNews.filter(row => row.attributionState === "registration-gap").length,
      coreNewsKnownSubsidiaryAttributionGaps: coreNews.filter(row => row.registrySourceIds.length === 0
        && (row.institutionId === "inst-penn-princeton" || row.institutionId === "inst-penn-doylestown")).length,
      distinctSources: sourceDetails.length, distinctConfiguredSources: sourceDetails.filter(row => row.configuration === "configured").length,
      freshDistinctSourceHealthReceipts: sourceDetails.filter(row => row.configuration === "configured" && row.sourceHealth.freshness === "fresh").length,
      sourceInstitutionRelationships: relationships.length,
      qualifiedInstitutionCoverage: null, peopleWithCurrentEmployment: null, completeLeadershipRosters: null,
    },
    freshnessPolicies: {
      sourceHealth: "Existing read projection retains its registry budgets; source collection freshness is not institution attribution.",
      leadershipOperational: "Trusted configured cadence plus bounded grace from the production diagnostic; separate scheduler receipts required.",
      affiliation: { maxObservationTtlMs: 7 * 24 * 3_600_000, expiresAtIsExclusive: true,
        basis: "regional-contracts.PublicAffiliation/resolveInstitutionalAuthor", qualifiedByThisSlice: false },
    },
    coreNews, sources: sourceDetails, relationships, evidence: evidenceDetails,
    healthReceiptsForUnregisteredSources: report.unregisteredHealthSourceIds,
  };
}
