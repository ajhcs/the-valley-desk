import { buildRegionalEvidenceReview, type RegionalEvidenceLeadershipReceipt } from "../content/regional-evidence";
import inventory from "../../fixtures/regional-source-inventory-v1.json";
import scopeInventory from "../../fixtures/regional-evidence/institution-scope-v1.json";
import { coveragePack } from "./coverage-pack";
import { officialSourceRegistry } from "./official-source-discovery";
import type { D1DatabaseLike } from "./persistence";
import type { PersistedSourceHealth, SourceRunState } from "./source-health";

type HealthRow = { source_id: string; state: SourceRunState; last_checked_at: string; last_success_at: string | null };
type LeadershipRow = { source_id: string; state: RegionalEvidenceLeadershipReceipt["state"]; last_success_at: string | null; last_attempted_at: string | null; next_attempt_at: string | null; consecutive_failures: number };

/** Metadata-only review. Never authorizes collection, publication or affiliation. */
export async function regionalEvidenceReviewPayload(db: D1DatabaseLike, asOf: string) {
  const registry = coveragePack.sources.filter(source => !source.kind.startsWith("linkedin"));
  const healthResult = await db.prepare(`
    SELECT source_id, state, last_checked_at, last_success_at
    FROM source_health ORDER BY source_id LIMIT 1001
  `).all<HealthRow>();
  const leadershipResult = await db.prepare(`
    SELECT source_id, state, last_success_at, last_attempted_at, next_attempt_at, consecutive_failures
    FROM scheduled_source_state WHERE source_id IN (${registry.map(() => "?").join(",")})
    ORDER BY source_id LIMIT 1001
  `).bind(...registry.map(source => source.id)).all<LeadershipRow>();
  if (!Array.isArray(healthResult.results) || !Array.isArray(leadershipResult.results))
    throw new Error("review-receipts-unavailable");
  const health: PersistedSourceHealth[] = healthResult.results.map(row => ({
    sourceId: row.source_id, state: row.state, lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at, itemCount: 0, complete: false, consecutiveFailures: 0,
    lastError: null, nextAttemptAt: asOf, lastHttpStatus: null, requiresAuth: false,
  }));
  const leadershipRuntime = leadershipResult.results.map(row => ({
    sourceId: row.source_id, institutionId: registry.find(source => source.id === row.source_id)!.institutionId,
    state: row.state, lastSuccessAt: row.last_success_at, lastAttemptedAt: row.last_attempted_at,
    nextAttemptAt: row.next_attempt_at, consecutiveFailures: row.consecutive_failures,
  }));
  return buildRegionalEvidenceReview({ scopeInventory, inventory, existingInstitutions: coveragePack.institutions,
    existingOfficialSources: officialSourceRegistry.sources, existingLeadershipSources: coveragePack.sources,
    health, leadershipRuntime, asOf });
}
