import { z } from "zod";
import {
  DISCOVERY_SCHEMA_VERSION,
  DISCOVERY_PROVIDERS,
  DISCOVERY_LIMITS,
  DiscoveryId,
  RevisionRef,
  ProviderIdentity,
  DiscoverySubject,
  DiscoveryDate,
  DiscoveryInstant,
  DiscoveryPublicUrl,
} from "../../content/discovery-schema";
const checkpoint = z.string().max(4096).nullable();
const params = z
  .record(z.string().min(1).max(64), z.string().max(512))
  .refine((x) => Object.keys(x).length <= 20);
const base = {
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  operationId: DiscoveryId,
  runId: DiscoveryId,
  sourceId: DiscoveryId,
  provider: z.enum(DISCOVERY_PROVIDERS),
  installation: DiscoveryId,
  scopeId: DiscoveryId,
  enrollment: RevisionRef,
  configuration: RevisionRef,
  permission: RevisionRef,
  parser: RevisionRef,
  endpointConstructor: DiscoveryId,
  parameters: params,
  checkpoint,
  budgetReservation: RevisionRef,
  leaseFence: RevisionRef,
};
export const DiscoverySourceRequest = z.discriminatedUnion("purpose", [
  z
    .object({
      ...base,
      purpose: z.literal("qualification-sample"),
      samplingAuthorization: RevisionRef,
    })
    .strict(),
  z
    .object({
      ...base,
      purpose: z.literal("collection"),
      qualification: RevisionRef,
    })
    .strict(),
]);
export type DiscoverySourceRequest = z.infer<typeof DiscoverySourceRequest>;
export const DiscoverySourceObservation = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    id: DiscoveryId,
    identity: ProviderIdentity,
    sourceVersion: z.string().min(1).max(200).optional(),
    subject: DiscoverySubject,
    representationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    provenanceOriginId: DiscoveryId,
    sourceUrl: DiscoveryPublicUrl,
    observedAt: DiscoveryInstant,
    sourceDate: DiscoveryDate,
    parser: RevisionRef,
    evidence: z
      .array(RevisionRef)
      .min(1)
      .max(DISCOVERY_LIMITS.maxEvidenceRefs)
      .refine(
        (a) =>
          new Set(a.map((e) => `${e.id}\0${e.revision}`)).size === a.length,
      ),
  })
  .strict()
  .refine(
    (x) => x.identity.kind === x.subject.kind,
    "identity and subject kinds differ",
  );
export type DiscoverySourceObservation = z.infer<
  typeof DiscoverySourceObservation
>;
const captureFields = {
  schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
  request: DiscoverySourceRequest,
  limitationReceipt: RevisionRef.optional(),
  observations: z
    .array(DiscoverySourceObservation)
    .max(DISCOVERY_LIMITS.maxPageObservations),
  outcome: z.enum(["healthy", "healthy-empty", "partial"]),
  completeness: z.enum(["complete", "partial", "provider-limited"]),
};

type SourceResult = {
  request: DiscoverySourceRequest;
  observations: DiscoverySourceObservation[];
  outcome: "healthy" | "healthy-empty" | "partial";
  completeness: "complete" | "partial" | "provider-limited";
  limitationReceipt?: RevisionRef;
};

function checkSourceResult(
  result: SourceResult,
  proposed: string | null,
  ctx: z.RefinementCtx,
): void {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (
    result.outcome === "healthy" &&
    (result.observations.length === 0 || result.completeness !== "complete")
  )
    bad("healthy requires observations and complete traversal");
  if (
    result.outcome === "healthy-empty" &&
    (result.observations.length !== 0 || result.completeness !== "complete")
  )
    bad("healthy-empty requires complete empty traversal");
  if (result.outcome === "partial" && result.completeness === "complete")
    bad("partial requires incomplete traversal");
  if (result.completeness === "provider-limited" && !result.limitationReceipt)
    bad("provider limitation requires receipt");
  if (result.completeness === "complete" && proposed !== null)
    bad("complete traversal has checkpoint");
  if (
    result.observations.some(
      (observation) =>
        observation.identity.provider !== result.request.provider ||
        observation.identity.installation !== result.request.installation ||
        observation.parser.id !== result.request.parser.id ||
        observation.parser.revision !== result.request.parser.revision,
    )
  )
    bad("observation request binding mismatch");
}

// Parsing a capture records a proposal only; it cannot persist or advance progress.
export const DiscoverySourceCapture = z
  .object({
    ...captureFields,
    proposedCheckpoint: checkpoint,
  })
  .strict()
  .superRefine((capture, ctx) =>
    checkSourceResult(capture, capture.proposedCheckpoint, ctx),
  );
export type DiscoverySourceCapture = z.infer<typeof DiscoverySourceCapture>;

// This shape is reserved for a trusted store's durable acknowledgment.
export const DiscoverySourcePage = z
  .object({
    ...captureFields,
    pageReceipt: RevisionRef,
    nextCheckpoint: checkpoint,
    committed: z.literal(true),
  })
  .strict()
  .superRefine((page, ctx) =>
    checkSourceResult(page, page.nextCheckpoint, ctx),
  );
export type DiscoverySourcePage = z.infer<typeof DiscoverySourcePage>;
export const DISCOVERY_SOURCE_FAILURES = [
  "disabled",
  "misconfigured",
  "auth-failed",
  "rate-limited",
  "upstream-failed",
  "parser-failed",
  "timed-out",
  "unavailable",
  "permission-denied",
  "budget-exhausted",
] as const;
export const DiscoverySourceFailure = z
  .object({
    schemaVersion: z.literal(DISCOVERY_SCHEMA_VERSION),
    operationId: DiscoveryId,
    sourceId: DiscoveryId,
    outcome: z.enum(DISCOVERY_SOURCE_FAILURES),
    retryAfter: DiscoveryInstant.nullable(),
    checkpointUnchanged: z.literal(true),
    code: z.string().min(1).max(200),
  })
  .strict();
export type DiscoverySourceFailure = z.infer<typeof DiscoverySourceFailure>;
export function assertDiscoveryEnvelopeBytes(value: unknown): void {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("envelope is not JSON serializable");
  if (
    new TextEncoder().encode(json).byteLength >
    DISCOVERY_LIMITS.maxEnvelopeBytes
  )
    throw new Error("discovery envelope exceeds byte limit");
}
