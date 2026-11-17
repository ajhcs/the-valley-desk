import { z } from 'zod';
import {
  DiscoveryId,
  DiscoveryInstant,
  RevisionRef,
  DISCOVERY_PROVIDERS,
} from '../../content/discovery-schema';
import {
  DiscoverySourceResponseMaterialScope,
  type DiscoveryIssuedSourceRequestResolver,
  type DiscoveryMutationContext,
  type DiscoveryRepresentationInput,
} from '../../content/discovery-evidence';
import type { D1StatementLike } from '../persistence';
import type {
  DiscoverySourceRequest,
  DiscoverySourceFailure,
} from './source-contract';

const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const DiscoveryEndpointParameter = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('integer'), min: safe, max: safe }).strict(),
    z
      .object({
        kind: z.literal('text'),
        maxLength: z.number().int().min(1).max(512),
      })
      .strict(),
    z
      .object({
        kind: z.literal('token'),
        maxLength: z.number().int().min(1).max(512),
      })
      .strict(),
    z
      .object({
        kind: z.literal('enum'),
        values: z.array(z.string().min(1).max(512)).min(1).max(100),
      })
      .strict(),
  ])
  .refine((v) => v.kind !== 'integer' || v.min <= v.max);
export const DiscoveryEndpointTemplate = z
  .object({
    id: DiscoveryId,
    origin: z.string().max(300),
    path: z.string().max(1000),
    fixed: z.record(z.string().min(1).max(64), z.string().max(512)),
    parameters: z.record(z.string().min(1).max(64), DiscoveryEndpointParameter),
    required: z.array(z.string().min(1).max(64)).max(20),
    pageParameter: z.string().min(1).max(64).optional(),
  })
  .strict();
export type DiscoveryEndpointTemplate = z.infer<
  typeof DiscoveryEndpointTemplate
>;
export const DiscoverySourceBudget = z
  .object({
    id: DiscoveryId,
    windowStart: DiscoveryInstant,
    windowEnd: DiscoveryInstant,
    maxRequests: safe,
    maxRetainedBytes: safe,
    maxPages: safe,
    maxItems: safe,
    maxResponseBytes: z.number().int().min(1).max(48000),
    maxWallTimeMs: z.number().int().min(1).max(300000),
  })
  .strict()
  .refine((v) => Date.parse(v.windowStart) < Date.parse(v.windowEnd));
export const DiscoveryRuntimeSource = z
  .object({
    id: DiscoveryId.refine(
      (value) => value !== 'source:unresolved',
      'reserved unresolved source identity',
    ),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    provider: z.enum(DISCOVERY_PROVIDERS),
    installation: DiscoveryId,
    scopeId: DiscoveryId,
    enrollment: RevisionRef,
    configuration: RevisionRef,
    permission: RevisionRef,
    rights: RevisionRef,
    parser: RevisionRef,
    normalizer: RevisionRef,
    materialScope: DiscoverySourceResponseMaterialScope,
    endpointTemplate: DiscoveryEndpointTemplate,
    requiresAuth: z.boolean(),
    credentialRef: DiscoveryId.optional(),
    engineeringOwnerId: DiscoveryId,
    editorialOwnerId: DiscoveryId,
    maintenanceOwnerId: DiscoveryId,
    credentialOwnerId: DiscoveryId,
    accessDecision: RevisionRef,
    displayRights: RevisionRef,
    costs: z
      .object({
        qualificationHours: safe,
        maintenanceHoursPerMonth: safe,
        accessChargeBasis: z.string().min(1).max(300),
      })
      .strict(),
    budget: DiscoverySourceBudget,
    expiresAt: DiscoveryInstant,
  })
  .strict()
  .superRefine((v, c) => {
    const s = v.materialScope;
    if (
      s.sourceId !== v.id ||
      s.installation !== v.installation ||
      s.scopeId !== v.scopeId ||
      s.endpointConstructor !== v.endpointTemplate.id ||
      s.enrollment.id !== v.enrollment.id ||
      s.enrollment.revision !== v.enrollment.revision ||
      s.configuration.id !== v.configuration.id ||
      s.configuration.revision !== v.configuration.revision
    )
      c.addIssue({ code: 'custom', message: 'source scope binding mismatch' });
    if (v.requiresAuth !== Boolean(v.credentialRef))
      c.addIssue({
        code: 'custom',
        message: 'credential reference binding mismatch',
      });
  });
export type DiscoveryRuntimeSource = z.infer<typeof DiscoveryRuntimeSource>;
export const DiscoverySourceQualification = z
  .object({
    id: DiscoveryId,
    sourceId: DiscoveryId,
    sourceRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    installation: DiscoveryId,
    configurationSha256: sha,
    parser: RevisionRef,
    permission: RevisionRef,
    rights: RevisionRef,
    accessDecision: RevisionRef,
    displayRights: RevisionRef,
    engineeringOwnerId: DiscoveryId,
    editorialOwnerId: DiscoveryId,
    reviewedAt: DiscoveryInstant,
    expiresAt: DiscoveryInstant,
    samples: z
      .array(
        z
          .object({
            endpoint: z.string().max(2048),
            representation: RevisionRef,
            representationSha256: sha,
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export type DiscoverySourceQualification = z.infer<
  typeof DiscoverySourceQualification
>;
export const DiscoverySamplingGrant = z
  .object({
    id: DiscoveryId,
    sourceId: DiscoveryId,
    sourceRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    maxRequests: z.number().int().min(1).max(100),
    expiresAt: DiscoveryInstant,
  })
  .strict();
export type DiscoverySamplingGrant = z.infer<typeof DiscoverySamplingGrant>;
export type DiscoveryRegistryAction =
  | 'enroll'
  | 'qualify'
  | 'activate'
  | 'deactivate'
  | 'sample'
  | 'lease'
  | 'issue';
export type DiscoveryRegistryContext = {
  operationId: string;
  capabilityToken: string;
};
export type DiscoveryRegistryCapability = {
  receiptId: string;
  principalId: string;
  authenticationContextId: string;
  minimalAuditRetention: 'allow';
  action: DiscoveryRegistryAction;
  targetId: string;
  operationId: string;
  requestSha256: string;
  expiresAt: string;
};
export type DiscoveryRegistryCapabilityResolver = (
  opaqueToken: string,
  request: Pick<
    DiscoveryRegistryCapability,
    'action' | 'targetId' | 'operationId' | 'requestSha256'
  >,
) => Promise<DiscoveryRegistryCapability>;
export type DiscoveryRegistryAck = {
  committed: true;
  operationId: string;
  id: string;
};
export type DiscoveryLease = {
  id: string;
  sourceId: string;
  owner: string;
  fence: number;
  expiresAt: string;
};
export type DiscoveryContinuation = {
  parentReceiptId: string;
  sourceId: string;
  installation: string;
  scopeId: string;
  sourceRevision: number;
  querySha256: string;
  tokenSha256: string;
  expiresAt: string;
};
// Trusted server integration resolves durable page receipts. WP06 fixtures use
// an explicitly synthetic receipt store; WP07 provides the production page store.
export type DiscoveryContinuationReceipt = DiscoveryContinuation & {
  parentCaptureOperationId: string;
  parentPlanId: string;
  representation: { id: string; revision: number };
  representationSha256: string;
  nextCheckpoint: string;
};
export type DiscoveryIssueInput = {
  id: string;
  sourceId: string;
  sourceRevision: number;
  runId: string;
  purpose: 'collection' | 'qualification-sample';
  qualificationId?: string;
  samplingGrantId?: string;
  parameters: Record<string, string>;
  checkpoint: string | null;
  continuation?: DiscoveryContinuation;
  lease: { id: string; owner: string; fence: number };
  deadlineAt: string;
};
export type DiscoveryIssuedPlan = {
  id: string;
  source: DiscoveryRuntimeSource;
  request: DiscoverySourceRequest;
  endpoint: string;
  requestSha256: string;
  configurationSha256: string;
  activationGeneration: number;
  deadlineAt: string;
  maxResponseBytes: number;
  maxItems: number;
  lease: DiscoveryLease;
  retainedThrough: string;
  continuation?: DiscoveryContinuation;
  continuationParentCaptureId?: string;
  originMemberId: string;
  // Returned once at issue; never persisted raw. Durable replay cannot recover it.
  requestBindingToken?: string;
};
export type DiscoveryDispatchPermit = {
  attemptId: string;
  plan: DiscoveryIssuedPlan;
  request: DiscoverySourceRequest;
  maxResponseBytes: number;
  deadlineAt: string;
};
export type DiscoveryAttemptFinish = {
  attemptId: string;
  outcome: 'received' | DiscoverySourceFailure['outcome'];
  receivedBytes: number;
  httpStatus?: number;
  retryAfter?: string | null;
  code?: string;
  representationSha256?: string;
  responseLink?: string | null;
};
export type DiscoveryRetentionComposition = {
  before: D1StatementLike[];
  after: D1StatementLike[];
};
export type DiscoveryCaptureGuardInput = {
  context: DiscoveryMutationContext;
  representation: DiscoveryRepresentationInput;
  byteLength: number;
  bytesSha256: string;
};
export type DiscoveryPlanIdentity = { sourceId: string; operationId: string };
export const DISCOVERY_UNRESOLVED_PLAN_IDENTITY = Object.freeze({
  sourceId: 'source:unresolved',
  operationId: 'operation:unresolved',
});
// Internal trusted transport dependency. The public registry factory closes over
// dispatch/completion methods and exposes createTransport instead.
export interface DiscoverySourceRegistry {
  enroll(
    context: DiscoveryRegistryContext,
    source: DiscoveryRuntimeSource,
  ): Promise<DiscoveryRegistryAck>;
  qualify(
    context: DiscoveryRegistryContext,
    qualification: DiscoverySourceQualification,
  ): Promise<DiscoveryRegistryAck>;
  activate(
    context: DiscoveryRegistryContext,
    input: {
      sourceId: string;
      sourceRevision: number;
      qualificationId: string;
    },
  ): Promise<DiscoveryRegistryAck>;
  deactivate(
    context: DiscoveryRegistryContext,
    input: { sourceId: string; expectedGeneration: number; reasonCode: string },
  ): Promise<DiscoveryRegistryAck>;
  authorizeSampling(
    context: DiscoveryRegistryContext,
    grant: DiscoverySamplingGrant,
  ): Promise<DiscoveryRegistryAck>;
  acquireLease(
    context: DiscoveryRegistryContext,
    input: {
      id: string;
      sourceId: string;
      owner: string;
      expectedFence: number;
      expiresAt: string;
    },
  ): Promise<DiscoveryLease>;
  issue(
    context: DiscoveryRegistryContext,
    input: DiscoveryIssueInput,
  ): Promise<DiscoveryIssuedPlan>;
  resolvePlan(planId: string): Promise<DiscoveryIssuedPlan>;
  // Read-only minimal audit identity; this never grants readiness or access.
  resolvePlanIdentity(planId: string): Promise<DiscoveryPlanIdentity | null>;
  // Atomic reservation irrevocably consumes one request and marks the attempt
  // dispatched/uncertain BEFORE returning. The same attempt can never send twice.
  reserveAttempt(input: {
    planId: string;
    attemptId: string;
    endpoint: string;
    ordinal: number;
    hop: number;
  }): Promise<DiscoveryDispatchPermit>;
  finishAttempt(input: DiscoveryAttemptFinish): Promise<void>;
  resolveIssuedSourceRequest: DiscoveryIssuedSourceRequestResolver;
  composeCaptureGuard(
    input: DiscoveryCaptureGuardInput,
  ): Promise<DiscoveryRetentionComposition>;
  readBudget(id: string): Promise<{
    requests: number;
    reservedBytes: number;
    retainedBytes: number;
    pages: number;
    items: number;
  }>;
}
export type DiscoveryCredentialBinding = {
  origin: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
};
export type DiscoveryCredentialResolver = (
  reference: string,
  context: {
    sourceId: string;
    installation: string;
    origin: string;
    endpointConstructor: string;
  },
) => Promise<DiscoveryCredentialBinding | null>;
// Server dependency must enforce public destination at connect time. No native
// fetch fallback is supplied. Synthetic implementations prove fixture behavior only.
export type DiscoveryEgress = {
  send(
    url: string,
    init: {
      headers: Readonly<Record<string, string>>;
      signal: AbortSignal;
      redirect: 'manual';
    },
  ): Promise<Response>;
};
export type DiscoveryAcquisition = {
  plan: DiscoveryIssuedPlan;
  attemptId: string;
  bytes: Uint8Array;
  endpoint: string;
  status: number;
  receivedBytes: number;
  retainedByteCeiling: number;
  responseLink?: string | null;
};
export type DiscoveryTransportResult =
  | { ok: true; acquisition: DiscoveryAcquisition }
  | { ok: false; failure: DiscoverySourceFailure };
export class DiscoveryRuntimeError extends Error {
  constructor(
    readonly outcome: DiscoverySourceFailure['outcome'],
    readonly code: string,
    readonly retryAfter: string | null = null,
  ) {
    super(code);
    this.name = 'DiscoveryRuntimeError';
  }
}
export function discoveryRuntimeFailure(
  error: unknown,
  operationId: string,
  sourceId: string,
): DiscoverySourceFailure {
  const e =
    error instanceof DiscoveryRuntimeError
      ? error
      : new DiscoveryRuntimeError(
          'unavailable',
          'discovery-runtime-unavailable',
        );
  return {
    schemaVersion: 'discovery-v1',
    operationId,
    sourceId,
    outcome: e.outcome,
    retryAfter: e.retryAfter,
    checkpointUnchanged: true,
    code: e.code,
  };
}
