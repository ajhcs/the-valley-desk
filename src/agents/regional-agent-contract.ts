import { z } from "zod";
import { REGIONAL_CHANNELS } from "../ingest/regional-contracts";
import { SOURCE_RUN_STATES } from "../ingest/source-health";
export { RegionalDiscoveryQuery, RegionalDiscoveryRecordQuery, RegionalDiscoveryResult, RegionalDiscoveryRecordResult } from "../ingest/regional-discovery-view";
export { RegionalSourceReadQuery } from "../ingest/regional-read-view";
const Id = z.string().regex(/^[a-z][a-z0-9-]+$/).max(200);
const Instant = z.string().datetime({ offset: true });
const nullableInstant = Instant.nullable();
const no = z.literal(false), count = z.number().int().nonnegative();
const Cursor = z.object({ snapshotId: z.string().regex(/^[a-f0-9]{64}$/), afterSourceId: Id, filterKey: z.string().max(5000) }).strict();
export const RegionalAgentResult = z.object({
  schemaVersion: z.literal(1), snapshot: z.object({ schemaVersion: z.literal(1), snapshotId: z.string().regex(/^[a-f0-9]{64}$/), asOf: Instant, expiresAt: Instant }).strict(),
  scope: z.literal("registered-inventory-only"), urlProjection: z.literal("Public URL pointers omit all query parameters and fragments; registry configuration is not source verification."), untrustedText: z.literal(true),
  completeInstitutionCoverageClaimed: no, channelApplicabilityReviewed: no,
  existingRegistryProjection: z.tuple([z.literal("official-news"), z.literal("public-leadership")]),
  unintegratedExistingRegistryFamilies: z.tuple([z.literal("rss"), z.literal("event-adapters"), z.literal("technology-source-plans")]),
  collectionAuthorized: no, publicationAuthorized: no, modelCallAuthorized: no, collectorActivatedByThisWorkstream: no,
  counts: z.object({ institutionsInFilter: count, sourcesInFilter: count, configuredSourcesInFilter: count,
    freshSourcesAtSnapshotInFilter: count, unobservedSourcesAtSnapshotInFilter: count,
    registrationGapsInInstitutionChannelFilter: count, registeredPeopleWithCurrentAffiliation: z.null(),
    acceptedPublications: z.null(), healthReceiptsForUnregisteredSources: count }).strict(),
  registrationGapMeaning: z.string().max(300), freshnessBasis: z.string().max(300),
  results: z.array(z.object({ sourceId: Id, institutionId: Id, institutionName: z.string().min(2).max(200),
    institutionScopeDeclaration: z.enum(["core", "edge", "unverified", "configured-monitor-set", "inventory-only"]),
    channel: z.enum(REGIONAL_CHANNELS), url: z.string().url().max(2048),
    configuration: z.enum(["configured", "inventory-only", "planned", "disabled"]),
    freshnessAtSnapshot: z.enum(["unknown", "fresh", "stale", "not-active"]), sourceState: z.enum(SOURCE_RUN_STATES).nullable(),
    lastCheckedAt: nullableInstant, lastSuccessAt: nullableInstant,
    warning: z.enum([...SOURCE_RUN_STATES, "invalid-health-timestamps"]).nullable(), sourcePublishedAt: z.null(),
    evidenceBasis: z.enum(["registry-configuration", "inventory-citation-declarations"]), evidenceVerifiedByThisAdapter: no,
    citations: z.array(z.object({ evidenceId: Id, sourceUrl: z.string().url().max(2048), observedAt: Instant,
      sourcePublishedAt: nullableInstant, representationSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(100),
  }).strict()).max(50), nextCursor: Cursor.nullable(),
}).strict();
export const RegionalAgentError = z.object({ isError: z.literal(true), error: z.object({
  code: z.enum(["invalid-query", "snapshot-expired", "cancelled", "read-unavailable"]),
  message: z.string().max(200),
}).strict() }).strict();
export function safeRegionalAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = error instanceof z.ZodError || /unknown-read-view-institution|cursor/.test(message) ? "invalid-query" :
    /expired-or-future/.test(message) ? "snapshot-expired" : error instanceof Error && error.name === "AbortError" ? "cancelled" : "read-unavailable";
  const messages = { "invalid-query": "Use supported filters and a cursor from the same source snapshot.",
    "snapshot-expired": "The source snapshot expired. Start a new read without a cursor.",
    "cancelled": "The read was cancelled.", "read-unavailable": "The regional source read is temporarily unavailable." };
  return RegionalAgentError.parse({ isError: true, error: { code, message: messages[code] } });
}
