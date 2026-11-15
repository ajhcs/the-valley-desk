import { z } from 'zod';
import {
  DiscoveryId,
  DiscoveryInstant,
  DiscoveryDate,
  ProviderIdentity,
  RevisionRef,
} from '../../content/discovery-schema';
import type {
  DiscoverySourceRequest,
  DiscoverySourceFailure,
} from './source-contract';
import type {
  DiscoveryAcquisition,
  DiscoveryIssuedPlan,
  DiscoveryLease,
  DiscoveryRuntimeSource,
  DiscoveryTransportResult,
  DiscoveryCredentialResolver,
  DiscoveryEgress,
  DiscoveryRegistryCapabilityResolver,
} from './runtime-contract';
import type { DiscoveryCapabilityResolver } from '../../content/discovery-evidence';

export const DISCOVERY_COLLECTION_VERSION = 'discovery-collection-v1' as const;
export const DISCOVERY_COLLECTION_LIMITS = {
  maxRoundSources: 128,
  maxPagesPerChain: 1000,
  maxLeadsPerPage: 100,
  maxLeaseMs: 300000,
  maxContinuationMs: 86400000,
} as const;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const parameters = z
  .record(z.string().min(1).max(64), z.string().max(512))
  .refine((value) => Object.keys(value).length <= 20);
// Private provider-native candidates. These are not catalog subjects, evidence
// anchors, reviewed claims or DiscoverySourceObservation records.
export const DiscoveryCollectionLead = z
  .object({
    nativeId: ProviderIdentity.shape.nativeId,
    kind: z.enum(['person', 'organization', 'account', 'project', 'artifact']),
    displayName: z.string().min(1).max(512),
    sourceVersion: z.string().min(1).max(200).optional(),
    artifactKind: z
      .enum(['repository', 'publication', 'discussion'])
      .optional(),
    sourceStage: z.enum([
      'baseline',
      'release',
      'tag',
      'commit',
      'preprint',
      'publication',
      'discussion',
      'profile',
    ]),
    sourceDates: z
      .array(
        z
          .object({ field: z.string().min(1).max(128), date: DiscoveryDate })
          .strict(),
      )
      .max(8)
      .refine(
        (values) =>
          new Set(values.map((value) => value.field)).size === values.length,
      ),
    relatedAccounts: z.array(z.string().min(1).max(512)).max(100),
    unresolvedPeople: z.array(z.string().min(1).max(512)).max(100),
    institutionalAuthor: z.string().min(1).max(512).optional(),
    publicationAuthorized: z.literal(false),
  })
  .strict()
  .refine(
    (value) => value.artifactKind === undefined || value.kind === 'artifact',
    'artifact kind belongs to artifact leads',
  );
export type DiscoveryCollectionLead = z.infer<typeof DiscoveryCollectionLead>;
export const DiscoveryCollectionDraft = z
  .object({
    schemaVersion: z.literal(DISCOVERY_COLLECTION_VERSION),
    requestSha256: sha,
    representationSha256: sha,
    parser: RevisionRef,
    representationFormat: z.enum(['json', 'text']),
    leads: z.array(DiscoveryCollectionLead).max(100),
    terminal: z.boolean(),
    nextCheckpoint: z.string().min(1).max(512).nullable(),
    rejectedCount: count,
    truncated: z.boolean(),
    providerLimited: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.terminal && value.nextCheckpoint !== null)
      ctx.addIssue({
        code: 'custom',
        message: 'terminal page has continuation',
      });
    const keys = value.leads.map((lead) =>
      JSON.stringify([
        lead.kind,
        lead.nativeId,
        lead.sourceStage,
        lead.sourceVersion ?? null,
      ]),
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate native lead' });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144)
      ctx.addIssue({ code: 'custom', message: 'draft exceeds byte bound' });
  });
export type DiscoveryCollectionDraft = z.infer<typeof DiscoveryCollectionDraft>;
export type DiscoveryCollectionParseInput = {
  bytes: Uint8Array;
  request: DiscoverySourceRequest;
  requestSha256: string;
  representationSha256: string;
  parser: { id: string; revision: number };
  maxItems: number;
  responseLink?: string | null;
};
// Runs on detached acquired bytes BEFORE retention. Output is provisional until
// the store commits its exact body/request/fence/budget bindings atomically.
export type DiscoveryCollectionParser = (
  input: DiscoveryCollectionParseInput,
) => Promise<DiscoveryCollectionDraft>;
export const DiscoveryCollectionRoundInput = z
  .object({
    id: DiscoveryId,
    cohortId: DiscoveryId,
    sources: z
      .array(z.object({ sourceId: DiscoveryId, parameters }).strict())
      .max(128),
    maxPagesPerChain: z.number().int().min(1).max(1000),
    continuationTtlMs: z.number().int().min(1).max(86400000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.sources.map((source) => source.sourceId)).size ===
      value.sources.length,
  );
export type DiscoveryCollectionRoundInput = z.infer<
  typeof DiscoveryCollectionRoundInput
>;
export type DiscoveryCollectionAction =
  | 'create-round'
  | 'claim-slot'
  | 'issue-page'
  | 'finish-slot'
  | 'commit-page'
  | 'stop-round';
export type DiscoveryCollectionContext = {
  operationId: string;
  capabilityToken: string;
};
export type DiscoveryCollectionCapability = {
  receiptId: string;
  principalId: string;
  authenticationContextId: string;
  minimalAuditRetention: 'allow';
  action: DiscoveryCollectionAction;
  targetId: string;
  operationId: string;
  requestSha256: string;
  expiresAt: string;
};
export type DiscoveryCollectionCapabilityResolver = (
  token: string,
  request: Pick<
    DiscoveryCollectionCapability,
    'action' | 'targetId' | 'operationId' | 'requestSha256'
  >,
) => Promise<DiscoveryCollectionCapability>;
export type DiscoveryCollectionRound = {
  id: string;
  cohortId: string;
  status: 'active' | 'complete' | 'stopped';
  cursor: number;
  size: number;
  createdAt: string;
  policyVersion: 'collection-policy-v1';
  maxAttemptsPerSlot: 1;
  automaticRetries: 0;
};
export type DiscoveryCollectionChain = {
  id: string;
  sourceId: string;
  sourceRevision: number;
  scopeSha256: string;
  querySha256: string;
  configurationSha256: string;
  pageCount: number;
  checkpoint: string | null;
  lastReceiptId: string | null;
  status: 'active' | 'complete' | 'partial' | 'restart-required';
  expiresAt: string | null;
};
export type DiscoveryCollectionClaim = {
  id: string;
  roundId: string;
  slot: number;
  owner: string;
  fence: number;
  expiresAt: string;
  processingDeadlineAt: string;
  source: DiscoveryRuntimeSource;
  parameters: Record<string, string>;
  sourceLease: DiscoveryLease;
  chain: DiscoveryCollectionChain;
  maxPagesPerChain: number;
  continuationTtlMs: number;
  issuedPlanId: string | null;
};
export type DiscoveryCollectionClaimResult =
  | { kind: 'claimed'; claim: DiscoveryCollectionClaim }
  | { kind: 'complete' | 'stopped'; round: DiscoveryCollectionRound }
  | { kind: 'skipped'; ack: DiscoveryCollectionSlotAck }
  | { kind: 'busy'; roundId: string; slot: number; expiresAt: string };
export type DiscoveryCollectionPageReceipt = {
  schemaVersion: typeof DISCOVERY_COLLECTION_VERSION;
  id: string;
  operationId: string;
  committed: true;
  roundId: string;
  slot: number;
  claimId: string;
  chainId: string;
  pageOrdinal: number;
  planId: string;
  sourceId: string;
  sourceRevision: number;
  requestSha256: string;
  representation: { id: string; revision: number };
  representationSha256: string;
  leadCount: number;
  rejectedCount: number;
  truncated: boolean;
  providerLimited: boolean;
  terminal: boolean;
  nextCheckpoint: string | null;
  chainComplete: boolean;
  committedAt: string;
  proposedCheckpoint: string | null;
  limitationCode: string | null;
  responseLink?: string | null;
};
export const DiscoveryCollectionPageReceipt = z
  .object({
    schemaVersion: z.literal(DISCOVERY_COLLECTION_VERSION),
    id: DiscoveryId,
    operationId: DiscoveryId,
    committed: z.literal(true),
    roundId: DiscoveryId,
    slot: count,
    claimId: DiscoveryId,
    chainId: DiscoveryId,
    pageOrdinal: z.number().int().min(1).max(1000),
    planId: DiscoveryId,
    sourceId: DiscoveryId,
    sourceRevision: z.number().int().positive().safe(),
    requestSha256: sha,
    representation: RevisionRef,
    representationSha256: sha,
    leadCount: z.number().int().min(0).max(100),
    rejectedCount: count,
    truncated: z.boolean(),
    providerLimited: z.boolean(),
    terminal: z.boolean(),
    nextCheckpoint: z.string().min(1).max(512).nullable(),
    chainComplete: z.boolean(),
    committedAt: DiscoveryInstant,
    proposedCheckpoint: z.string().min(1).max(512).nullable(),
    limitationCode: z.string().min(1).max(200).nullable(),
    responseLink: z.string().max(4096).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.chainComplete &&
      (!value.terminal ||
        value.nextCheckpoint !== null ||
        value.proposedCheckpoint !== null ||
        value.truncated ||
        value.rejectedCount ||
        value.providerLimited ||
        value.limitationCode !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'invalid complete chain receipt',
      });
    if (
      value.nextCheckpoint !== null &&
      (value.terminal || value.nextCheckpoint !== value.proposedCheckpoint)
    )
      ctx.addIssue({ code: 'custom', message: 'invalid durable continuation' });
  });
export type DiscoveryCollectionSlotAck = {
  committed: true;
  operationId: string;
  roundId: string;
  slot: number;
  status: 'finished';
  sourceId: string;
  outcome:
    | DiscoverySourceFailure['outcome']
    | 'healthy'
    | 'healthy-empty'
    | 'partial'
    | 'already-complete';
};
export type DiscoveryCollectionTokenRequest = {
  action: string;
  targetId: string;
  operationId: string;
};
export type DiscoveryCollectionTransportOptions = {
  credentialResolver?: DiscoveryCredentialResolver;
  egress?: DiscoveryEgress;
  clock?: () => number;
};
declare const preparedPageBrand: unique symbol;
export type DiscoveryPreparedCollectionPage = {
  readonly [preparedPageBrand]: true;
};
export type DiscoveryCollectionStoreOptions = {
  resolveCapability: DiscoveryCollectionCapabilityResolver;
  resolveRegistryCapability: DiscoveryRegistryCapabilityResolver;
  resolveEvidenceCapability: DiscoveryCapabilityResolver;
  capabilityFor: (
    request: DiscoveryCollectionTokenRequest & {
      domain: 'registry' | 'evidence';
    },
  ) => Promise<string>;
  parser: DiscoveryCollectionParser;
  now?: () => string;
};
// Trusted collector dependency. Parser drafts are private store state behind an
// opaque prepared handle; no public setter can manufacture normalized leads.
export interface DiscoveryCollectionStore {
  createRound(
    context: DiscoveryCollectionContext,
    input: DiscoveryCollectionRoundInput,
  ): Promise<DiscoveryCollectionRound>;
  claimNext(
    context: DiscoveryCollectionContext,
    input: {
      roundId: string;
      owner: string;
      expiresAt: string;
      processingDeadlineAt: string;
    },
  ): Promise<DiscoveryCollectionClaimResult>;
  resolveClaim(claimId: string): Promise<DiscoveryCollectionClaim>;
  issueForClaim(
    context: DiscoveryCollectionContext,
    input: { claimId: string; planId: string; deadlineAt: string },
  ): Promise<DiscoveryIssuedPlan>;
  preparePage(
    claimId: string,
    acquisition: DiscoveryAcquisition,
  ): Promise<DiscoveryPreparedCollectionPage>;
  discardPreparedPage(prepared: DiscoveryPreparedCollectionPage): void;
  commitPage(
    context: DiscoveryCollectionContext,
    input: {
      prepared?: DiscoveryPreparedCollectionPage;
      requestBindingToken?: string;
    },
  ): Promise<DiscoveryCollectionPageReceipt>;
  finishSlot(
    context: DiscoveryCollectionContext,
    input: { claimId: string; failure: DiscoverySourceFailure },
  ): Promise<DiscoveryCollectionSlotAck>;
  stopRound(
    context: DiscoveryCollectionContext,
    input: { roundId: string; reasonCode: string },
  ): Promise<DiscoveryCollectionRound>;
  resolvePage(
    receiptId: string,
  ): Promise<DiscoveryCollectionPageReceipt | null>;
  // Historical lookup only; delegates the same integrity/removal checks as resolvePage.
  resolveChainPage(
    chainId: string,
    pageOrdinal: number,
  ): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveOperation(
    operationId: string,
  ): Promise<
    DiscoveryCollectionPageReceipt | DiscoveryCollectionSlotAck | null
  >;
  createTransport(options: DiscoveryCollectionTransportOptions): {
    acquire(planId: string): Promise<DiscoveryTransportResult>;
  };
}
export type DiscoveryCollectionStepResult =
  | { kind: 'page'; receipt: DiscoveryCollectionPageReceipt }
  | { kind: 'failure'; ack: DiscoveryCollectionSlotAck }
  | { kind: 'skipped'; ack: DiscoveryCollectionSlotAck }
  | { kind: 'complete' | 'stopped'; round: DiscoveryCollectionRound }
  | { kind: 'busy'; roundId: string; slot: number; expiresAt: string }
  | {
      kind: 'uncertain';
      roundId: string;
      operationId: string;
      claimId: string | null;
      code: string;
    };
// The collection layer never updates public refresh. It records raw attempt,
// successful durable page and complete contiguous inventory instants separately.
export type DiscoveryCollectionHealth = {
  sourceId: string;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastCompleteAt: string | null;
  lastPublicRefreshAt: null;
  lastGoodReceiptId: string | null;
};
export const DiscoveryCollectionClaimInput = z
  .object({
    roundId: DiscoveryId,
    owner: DiscoveryId,
    expiresAt: DiscoveryInstant,
    processingDeadlineAt: DiscoveryInstant,
  })
  .strict();
