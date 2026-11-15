import { z } from 'zod';
import { DiscoveryId, DiscoveryInstant } from '../../content/discovery-schema';
import {
  createDiscoveryEvidenceStore,
  canonicalDiscoveryEvidenceJson as canonical,
} from '../discovery-evidence-store';
import type { D1DatabaseLike, D1StatementLike } from '../persistence';
import { discoveryProviderIdentityId } from '../discovery-store';
import {
  createDiscoverySourceRegistry,
  discoveryRuntimeDigest as digest,
  discoveryTokenDigest,
  requestScopeDigest,
  sourceConfigurationDigest,
} from './source-registry';
import {
  DiscoveryRuntimeError,
  DiscoveryRuntimeSource,
  DiscoverySourceQualification,
  type DiscoveryAcquisition,
  type DiscoveryContinuationReceipt,
} from './runtime-contract';
import {
  DiscoverySourceRequest,
  DiscoverySourceFailure,
} from './source-contract';
import {
  DISCOVERY_COLLECTION_VERSION,
  DISCOVERY_COLLECTION_LIMITS,
  DiscoveryCollectionDraft,
  DiscoveryCollectionRoundInput,
  DiscoveryCollectionClaimInput,
  DiscoveryCollectionLead,
  DiscoveryCollectionPageReceipt,
  type DiscoveryCollectionStoreOptions,
  type DiscoveryCollectionContext,
  type DiscoveryCollectionAction,
  type DiscoveryCollectionRound,
  type DiscoveryCollectionChain,
  type DiscoveryCollectionClaim,
  type DiscoveryCollectionSlotAck,
  type DiscoveryPreparedCollectionPage,
  type DiscoveryCollectionTransportOptions,
  type DiscoveryCollectionHealth,
} from './collection-contract';

const snapshot = <T>(value: T): T => JSON.parse(canonical(value)) as T;
const contextSchema = z
  .object({
    operationId: DiscoveryId.refine(
      (value) => value !== 'operation:unresolved',
    ),
    capabilityToken: z.string().min(1).max(2048),
  })
  .strict();
const capabilitySchema = z
  .object({
    receiptId: DiscoveryId,
    principalId: DiscoveryId,
    authenticationContextId: DiscoveryId,
    minimalAuditRetention: z.literal('allow'),
    action: z.enum([
      'create-round',
      'claim-slot',
      'issue-page',
      'finish-slot',
      'commit-page',
      'stop-round',
    ]),
    targetId: DiscoveryId,
    operationId: DiscoveryId,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: DiscoveryInstant,
  })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const leaseSchema = z
  .object({
    id: DiscoveryId,
    sourceId: DiscoveryId,
    owner: DiscoveryId,
    fence: z.number().int().positive().safe(),
    expiresAt: DiscoveryInstant,
  })
  .strict();
const continuationSchema = z
  .object({
    parentReceiptId: DiscoveryId,
    sourceId: DiscoveryId,
    installation: DiscoveryId,
    scopeId: DiscoveryId,
    sourceRevision: z.number().int().positive().safe(),
    querySha256: sha,
    tokenSha256: sha,
    expiresAt: DiscoveryInstant,
  })
  .strict();
const planSchema = z
  .object({
    id: DiscoveryId,
    source: DiscoveryRuntimeSource,
    request: DiscoverySourceRequest,
    endpoint: z.string().max(2048),
    requestSha256: sha,
    configurationSha256: sha,
    activationGeneration: z.number().int().nonnegative().safe(),
    deadlineAt: DiscoveryInstant,
    maxResponseBytes: z.number().int().min(1).max(48000),
    maxItems: z.number().int().min(0).max(100),
    lease: leaseSchema,
    retainedThrough: DiscoveryInstant,
    continuation: continuationSchema.optional(),
    continuationParentCaptureId: DiscoveryId.optional(),
    originMemberId: DiscoveryId,
    requestBindingToken: z.string().max(2048).optional(),
  })
  .strict();
const acquisitionMetadataSchema = z
  .object({
    plan: planSchema,
    attemptId: DiscoveryId,
    endpoint: z.string().max(2048),
    status: z.number().int().min(200).max(299),
    receivedBytes: z.number().int().min(1).max(48000),
    retainedByteCeiling: z.number().int().min(1).max(48000),
    responseLink: z.string().max(4096).nullable().optional(),
  })
  .strict();
type RoundRow = {
  id: string;
  cohort_id: string;
  status: 'active' | 'complete' | 'stopped';
  cursor: number;
  size: number;
  created_at: string;
};
type SlotRow = {
  round_id: string;
  slot_index: number;
  source_id: string;
  source_revision: number;
  scope_sha256: string;
  chain_id: string;
  state: string;
  claim_id: string | null;
  fence: number;
  outcome: string | null;
  code: string | null;
};
type BindingRow = {
  cohort_id: string;
  source_id: string;
  source_revision: number;
  scope_sha256: string;
  configuration_sha256: string;
  query_sha256: string;
  source_json: string | null;
  parameters_json: string | null;
  chain_id: string;
};
type ChainRow = {
  id: string;
  source_id: string;
  source_revision: number;
  scope_sha256: string;
  configuration_sha256: string;
  query_sha256: string;
  revision: number;
  page_count: number;
  status: DiscoveryCollectionChain['status'];
  checkpoint: string | null;
  last_receipt_id: string | null;
  expires_at: string | null;
};
type ClaimRow = {
  id: string;
  round_id: string;
  slot_index: number;
  scope_sha256: string;
  owner: string;
  fence: number;
  expires_at: string;
  processing_deadline_at: string;
  source_lease_id: string;
  source_lease_fence: number;
  chain_revision: number;
  chain_page_count: number;
  checkpoint: string | null;
  last_receipt_id: string | null;
  issued_plan_id: string | null;
};
type OperationRow = {
  operation_id: string;
  action: string;
  target_id: string;
  request_sha256: string;
  result_kind: string;
  result_id: string;
};
type Prepared = {
  claim: DiscoveryCollectionClaim;
  acquisition: DiscoveryAcquisition;
  draft: DiscoveryCollectionDraft;
  bodySha256: string;
  maxItems: number;
  fingerprint: string;
  expiresAt: string;
  monotonicExpiresAt: number;
};

export function createDiscoveryCollectionStore(
  db: D1DatabaseLike,
  options: DiscoveryCollectionStoreOptions,
) {
  const {
    resolveCapability,
    resolveRegistryCapability,
    resolveEvidenceCapability,
    capabilityFor,
    parser,
    now: readNow,
  } = options;
  const sql = (query: string, values: unknown[] = []): D1StatementLike =>
    db.prepare(query).bind(...values);
  const now = () =>
    DiscoveryInstant.parse(readNow?.() ?? new Date().toISOString());
  const fail = (
    outcome: ConstructorParameters<typeof DiscoveryRuntimeError>[0],
    code: string,
  ): never => {
    throw new DiscoveryRuntimeError(outcome, code);
  };
  const check = (id: string, query: string, values: unknown[] = []) =>
    sql(
      `INSERT INTO discovery_collection_assertions SELECT ?,CASE WHEN (${query}) THEN 1 ELSE 0 END`,
      [id, ...values],
    );
  const policy = (maxPagesPerChain: number, continuationTtlMs: number) => ({
    policyVersion: 'collection-policy-v1' as const,
    maxAttemptsPerSlot: 1 as const,
    automaticRetries: 0 as const,
    maxPagesPerChain,
    continuationTtlMs,
  });
  const prepared = new Map<DiscoveryPreparedCollectionPage, Prepared>();
  function prunePrepared() {
    for (const [handle, value] of prepared)
      if (
        Date.parse(value.expiresAt) <= Date.parse(now()) ||
        value.monotonicExpiresAt <= performance.now()
      )
        prepared.delete(handle);
  }
  const mapError = (error: unknown): never => {
    if (error instanceof DiscoveryRuntimeError) throw error;
    const text = error instanceof Error ? error.message : '';
    if (/stale|claim|lease|chain/.test(text))
      return fail('timed-out', 'collection-current-claim-denied');
    return fail('unavailable', 'collection-transaction-rejected');
  };
  async function roundRow(id: string) {
    const row = await sql(
      'SELECT * FROM discovery_collection_rounds WHERE id=?',
      [DiscoveryId.parse(id)],
    ).first<RoundRow>();
    if (!row) return fail('unavailable', 'collection-round-missing');
    return row;
  }
  function roundView(row: RoundRow): DiscoveryCollectionRound {
    return {
      id: row.id,
      cohortId: row.cohort_id,
      status: row.status,
      cursor: row.cursor,
      size: row.size,
      createdAt: row.created_at,
      policyVersion: 'collection-policy-v1',
      maxAttemptsPerSlot: 1,
      automaticRetries: 0,
    };
  }
  async function readRound(id: string) {
    return roundView(await roundRow(id));
  }
  function chainView(row: ChainRow): DiscoveryCollectionChain {
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceRevision: row.source_revision,
      scopeSha256: row.scope_sha256,
      configurationSha256: row.configuration_sha256,
      querySha256: row.query_sha256,
      pageCount: row.page_count,
      checkpoint: row.checkpoint,
      lastReceiptId: row.last_receipt_id,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }
  async function resolveClaim(id: string): Promise<DiscoveryCollectionClaim> {
    const claim = await sql(
      'SELECT * FROM discovery_collection_claims WHERE id=?',
      [DiscoveryId.parse(id)],
    ).first<ClaimRow>();
    if (!claim) return fail('unavailable', 'collection-claim-missing');
    const round = await roundRow(claim.round_id);
    const binding = await sql(
      'SELECT * FROM discovery_collection_bindings WHERE cohort_id=? AND source_id=(SELECT source_id FROM discovery_collection_slots WHERE round_id=? AND slot_index=?)',
      [round.cohort_id, round.id, claim.slot_index],
    ).first<BindingRow>();
    if (!binding?.source_json || !binding.parameters_json)
      return fail('permission-denied', 'collection-source-removed');
    const chain = await sql(
      'SELECT * FROM discovery_collection_chains WHERE id=?',
      [binding.chain_id],
    ).first<ChainRow>();
    if (!chain) return fail('permission-denied', 'collection-chain-removed');
    const p = await sql(
      'SELECT policy_json FROM discovery_collection_cohorts WHERE id=?',
      [round.cohort_id],
    ).first<{ policy_json: string }>();
    const frozen = JSON.parse(p!.policy_json) as ReturnType<typeof policy>;
    return {
      id: claim.id,
      roundId: round.id,
      slot: claim.slot_index,
      owner: claim.owner,
      fence: claim.fence,
      expiresAt: claim.expires_at,
      processingDeadlineAt: claim.processing_deadline_at,
      source: DiscoveryRuntimeSource.parse(JSON.parse(binding.source_json)),
      parameters: JSON.parse(binding.parameters_json),
      sourceLease: {
        id: claim.source_lease_id,
        sourceId: binding.source_id,
        owner: claim.owner,
        fence: claim.source_lease_fence,
        expiresAt: claim.expires_at,
      },
      chain: {
        ...chainView(chain),
        pageCount: claim.chain_page_count,
        checkpoint: claim.checkpoint,
        lastReceiptId: claim.last_receipt_id,
      },
      maxPagesPerChain: frozen.maxPagesPerChain,
      continuationTtlMs: frozen.continuationTtlMs,
      issuedPlanId: claim.issued_plan_id,
    };
  }
  const guard = (
    operationId: string,
    claimId: string,
    stage: 'issue' | 'capture' | 'finish',
    planId: string | null = null,
  ) =>
    sql('INSERT INTO discovery_collection_guards VALUES(?,?,?,?,?)', [
      operationId,
      claimId,
      stage,
      planId,
      now(),
    ]);
  const clear = (operationId: string) =>
    sql('DELETE FROM discovery_collection_guards WHERE operation_id=?', [
      operationId,
    ]);
  async function assertLive(
    claimId: string,
    stage: 'issue' | 'capture' | 'finish',
    planId: string | null = null,
  ) {
    const key = `check:${crypto.randomUUID()}`;
    try {
      await db.batch([guard(key, claimId, stage, planId), clear(key)]);
    } catch (error) {
      return mapError(error);
    }
  }
  async function assertLiveRead(claimId: string, planId: string) {
    const row = await sql(
      `SELECT c.id FROM discovery_collection_claims c
      JOIN discovery_collection_slots s ON s.claim_id=c.id JOIN discovery_collection_rounds r ON r.id=c.round_id
      JOIN discovery_source_leases l ON l.id=c.source_lease_id JOIN discovery_collection_chains ch ON ch.id=s.chain_id
      JOIN discovery_source_plans p ON p.id=c.issued_plan_id JOIN discovery_source_heads h ON h.source_id=s.source_id
      WHERE c.id=? AND p.id=? AND s.state='claimed' AND s.fence=c.fence AND r.status='active' AND r.cursor=s.slot_index
        AND l.owner=c.owner AND l.fence=c.source_lease_fence AND l.expires_at=c.expires_at
        AND ch.revision=c.chain_revision AND ch.page_count=c.chain_page_count AND ch.status='active'
        AND h.active=1 AND h.revision=s.source_revision
        AND julianday(c.processing_deadline_at)>max(julianday('now'),julianday(?))
        AND julianday(p.deadline_at)>max(julianday('now'),julianday(?))
        AND (ch.expires_at IS NULL OR julianday(ch.expires_at)>max(julianday('now'),julianday(?)))`,
      [claimId, planId, now(), now(), now()],
    ).first();
    if (!row) {
      const source = await sql(
        'SELECT h.active,h.revision,s.source_revision FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.round_id=c.round_id AND s.slot_index=c.slot_index LEFT JOIN discovery_source_heads h ON h.source_id=s.source_id WHERE c.id=?',
        [claimId],
      ).first<{
        active: number | null;
        revision: number | null;
        source_revision: number;
      }>();
      if (source && source.active !== 1)
        return fail('disabled', 'collection-source-disabled');
      if (source && source.revision !== source.source_revision)
        return fail('permission-denied', 'collection-source-revision-changed');
      return fail('timed-out', 'collection-current-claim-denied');
    }
  }
  async function authorize(
    ctxRaw: DiscoveryCollectionContext,
    action: DiscoveryCollectionAction,
    targetId: string,
    requestSha256: string,
  ) {
    const ctx = contextSchema.parse(snapshot(ctxRaw));
    const request = {
      action,
      targetId,
      operationId: ctx.operationId,
      requestSha256,
    };
    const cap = capabilitySchema.parse(
      snapshot(await resolveCapability(ctx.capabilityToken, { ...request })),
    );
    if (
      cap.action !== action ||
      cap.targetId !== targetId ||
      cap.operationId !== ctx.operationId ||
      cap.requestSha256 !== requestSha256 ||
      Date.parse(cap.expiresAt) <= Date.parse(now())
    )
      return fail('permission-denied', 'collection-capability-denied');
    return { ctx, cap };
  }
  function audit(op: OperationRow, cap: z.infer<typeof capabilitySchema>) {
    return sql(
      'INSERT INTO discovery_collection_operations VALUES(?,?,?,?,?,?,?)',
      [
        op.operation_id,
        op.action,
        op.target_id,
        op.request_sha256,
        op.result_kind,
        op.result_id,
        canonical(cap),
      ],
    );
  }
  async function operation(id: string) {
    return sql(
      'SELECT * FROM discovery_collection_operations WHERE operation_id=?',
      [DiscoveryId.parse(id)],
    ).first<OperationRow>();
  }
  async function resolvePage(
    id: string,
  ): Promise<DiscoveryCollectionPageReceipt | null> {
    const row = await sql(
      'SELECT * FROM discovery_collection_pages WHERE id=?',
      [DiscoveryId.parse(id)],
    ).first<{
      id: string;
      operation_id: string;
      claim_id: string;
      round_id: string;
      slot_index: number;
      chain_id: string;
      page_ordinal: number;
      scope_sha256: string;
      plan_id: string;
      representation_id: string;
      representation_revision: number;
      representation_sha256: string;
      lead_count: number;
      payload_json: string;
      payload_sha256: string;
    }>();
    if (!row) return null;
    try {
      const parsed = DiscoveryCollectionPageReceipt.safeParse(
        JSON.parse(row.payload_json),
      );
      if (!parsed.success) return null;
      const page = parsed.data;
      if (
        canonical(page) !== row.payload_json ||
        (await digest(page)) !== row.payload_sha256 ||
        page.id !== row.id ||
        page.operationId !== row.operation_id ||
        page.claimId !== row.claim_id ||
        page.roundId !== row.round_id ||
        page.slot !== row.slot_index ||
        page.chainId !== row.chain_id ||
        page.pageOrdinal !== row.page_ordinal ||
        page.planId !== row.plan_id ||
        page.representation.id !== row.representation_id ||
        page.representation.revision !== row.representation_revision ||
        page.representationSha256 !== row.representation_sha256 ||
        page.leadCount !== row.lead_count
      )
        return null;
      const planRow = await sql(
        'SELECT payload_json FROM discovery_source_plans WHERE id=?',
        [page.planId],
      ).first<{ payload_json: string }>();
      if (!planRow) return null;
      const issued = planSchema.parse(JSON.parse(planRow.payload_json));
      if (
        issued.source.id !== page.sourceId ||
        issued.source.revision !== page.sourceRevision ||
        issued.requestSha256 !== page.requestSha256 ||
        (await digest(issued.source.materialScope)) !== row.scope_sha256
      )
        return null;
      const reader = createDiscoveryEvidenceStore(db, {
        resolveCapability: resolveEvidenceCapability,
        now,
      });
      const body = await reader.readRevision(
        'representation',
        page.representation.id,
        page.representation.revision,
      );
      if (!body?.usable || !body.content) return null;
      const content = body.content as {
        originalBytesSha256: string;
        issuedRequest: { id: string; revision: number };
        requestSha256: string;
      };
      if (
        content.originalBytesSha256 !== page.representationSha256 ||
        content.issuedRequest.id !== page.planId ||
        content.requestSha256 !== page.requestSha256
      )
        return null;
      const leads = await sql(
        'SELECT * FROM discovery_collection_leads WHERE page_id=? ORDER BY ordinal',
        [page.id],
      ).all<{
        ordinal: number;
        payload_json: string;
        payload_sha256: string;
        scope_sha256: string;
      }>();
      if (
        !Array.isArray(leads.results) ||
        leads.results.length !== page.leadCount
      )
        return null;
      for (const [ordinal, stored] of leads.results.entries()) {
        const value = JSON.parse(stored.payload_json) as Record<
          string,
          unknown
        >;
        if (
          stored.ordinal !== ordinal ||
          stored.scope_sha256 !== row.scope_sha256 ||
          canonical(value) !== stored.payload_json ||
          (await digest(value)) !== stored.payload_sha256 ||
          value.requestSha256 !== page.requestSha256 ||
          value.representationSha256 !== page.representationSha256 ||
          canonical(value.representation) !== canonical(page.representation) ||
          canonical(value.parser) !== canonical(issued.source.parser) ||
          canonical(value.request) !== canonical(issued.request)
        )
          return null;
        const {
          provider,
          installation,
          request,
          requestSha256,
          representation,
          representationSha256,
          parser: leadParser,
          candidateKey,
          ...lead
        } = value;
        void request;
        void requestSha256;
        void representation;
        void representationSha256;
        void leadParser;
        const native = DiscoveryCollectionLead.parse(lead);
        if (
          provider !== issued.source.provider ||
          installation !== issued.source.installation ||
          candidateKey !==
            (await discoveryProviderIdentityId({
              provider,
              installation,
              kind: native.kind,
              nativeId: native.nativeId,
            }))
        )
          return null;
      }
      return page;
    } catch {
      return null;
    }
  }
  async function resolveChainPage(
    chainId: string,
    pageOrdinal: number,
  ): Promise<DiscoveryCollectionPageReceipt | null> {
    DiscoveryId.parse(chainId);
    z.number().int().positive().safe().parse(pageOrdinal);
    const row = await sql(
      'SELECT id FROM discovery_collection_pages WHERE chain_id=? AND page_ordinal=?',
      [chainId, pageOrdinal],
    ).first<{ id: string }>();
    if (!row) return null;
    const page = await resolvePage(row.id);
    return page?.chainId === chainId && page.pageOrdinal === pageOrdinal
      ? page
      : null;
  }
  async function slotAck(
    id: string,
  ): Promise<DiscoveryCollectionSlotAck | null> {
    const row = await sql(
      'SELECT * FROM discovery_collection_slot_outcomes WHERE id=?',
      [id],
    ).first<{
      operation_id: string;
      round_id: string;
      slot_index: number;
      source_id: string;
      outcome: DiscoveryCollectionSlotAck['outcome'];
    }>();
    return row
      ? {
          committed: true,
          operationId: row.operation_id,
          roundId: row.round_id,
          slot: row.slot_index,
          status: 'finished',
          sourceId: row.source_id,
          outcome: row.outcome,
        }
      : null;
  }
  async function resolveOperation(id: string) {
    const row = await operation(id);
    if (!row) return null;
    return row.result_kind === 'page'
      ? resolvePage(row.result_id)
      : row.result_kind === 'slot'
        ? slotAck(row.result_id)
        : null;
  }
  async function runMutation<T>(
    ctx: DiscoveryCollectionContext,
    action: DiscoveryCollectionAction,
    targetId: string,
    input: unknown,
    build: (op: string) => Promise<{
      statements: D1StatementLike[];
      kind: string;
      id: string;
      result: T;
    }>,
    restore: (row: OperationRow) => Promise<T>,
  ): Promise<T> {
    ctx = contextSchema.parse(snapshot(ctx));
    const requestSha256 = await digest({ action, targetId, input });
    const { cap } = await authorize(ctx, action, targetId, requestSha256);
    const previous = await operation(ctx.operationId);
    if (previous) {
      if (previous.request_sha256 !== requestSha256)
        return fail('unavailable', 'collection-operation-conflict');
      return restore(previous);
    }
    try {
      const built = await build(ctx.operationId);
      await db.batch([
        check(
          `${ctx.operationId}:cap`,
          "julianday(?)>max(julianday('now'),julianday(?))",
          [cap.expiresAt, now()],
        ),
        ...built.statements,
        audit(
          {
            operation_id: ctx.operationId,
            action,
            target_id: targetId,
            request_sha256: requestSha256,
            result_kind: built.kind,
            result_id: built.id,
          },
          cap,
        ),
      ]);
      return built.result;
    } catch (error) {
      const raced = await operation(ctx.operationId);
      if (raced?.request_sha256 === requestSha256) return restore(raced);
      return mapError(error);
    }
  }
  const registry = createDiscoverySourceRegistry(db, {
    resolveCapability: resolveRegistryCapability,
    now,
    resolveContinuation: async (
      id,
    ): Promise<DiscoveryContinuationReceipt | null> => {
      const page = await resolvePage(id);
      if (
        !page?.nextCheckpoint ||
        page.chainComplete ||
        page.truncated ||
        page.rejectedCount ||
        page.providerLimited
      )
        return null;
      const row = await sql(
        'SELECT ch.*,p.payload_json AS plan_json FROM discovery_collection_chains ch JOIN discovery_source_plans p ON p.id=? WHERE ch.id=?',
        [page.planId, page.chainId],
      ).first<ChainRow & { plan_json: string }>();
      if (
        !row ||
        row.status !== 'active' ||
        row.last_receipt_id !== page.id ||
        !row.expires_at
      )
        return null;
      const plan = planSchema.parse(JSON.parse(row.plan_json));
      return {
        parentReceiptId: page.id,
        sourceId: page.sourceId,
        installation: plan.source.installation,
        scopeId: plan.source.scopeId,
        sourceRevision: page.sourceRevision,
        querySha256: row.query_sha256,
        tokenSha256: await discoveryTokenDigest(page.nextCheckpoint),
        expiresAt: row.expires_at,
        parentCaptureOperationId: page.operationId,
        parentPlanId: page.planId,
        representation: page.representation,
        representationSha256: page.representationSha256,
        nextCheckpoint: page.nextCheckpoint,
      };
    },
  });
  async function createRound(
    ctx: DiscoveryCollectionContext,
    raw: DiscoveryCollectionRoundInput,
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const input = DiscoveryCollectionRoundInput.parse(snapshot(raw));
    input.sources.sort((a, b) =>
      a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
    );
    return runMutation(
      ctx,
      'create-round',
      input.id,
      input,
      async (op) => {
        const statements: D1StatementLike[] = [
          sql(
            'INSERT INTO discovery_collection_cohorts VALUES(?,?) ON CONFLICT DO NOTHING',
            [
              input.cohortId,
              canonical(
                policy(input.maxPagesPerChain, input.continuationTtlMs),
              ),
            ],
          ),
          check(
            `${op}:policy`,
            '(SELECT policy_json FROM discovery_collection_cohorts WHERE id=?)=?',
            [
              input.cohortId,
              canonical(
                policy(input.maxPagesPerChain, input.continuationTtlMs),
              ),
            ],
          ),
        ];
        const created = now();
        for (const [ordinal, selection] of input.sources.entries()) {
          const row = await sql(
            'SELECT r.*,h.active FROM discovery_source_revisions r JOIN discovery_source_heads h ON h.source_id=r.source_id AND h.revision=r.revision WHERE r.source_id=?',
            [selection.sourceId],
          ).first<{
            payload_json: string;
            configuration_sha256: string;
            scope_sha256: string;
            active: number;
          }>();
          if (!row || row.active !== 1)
            return fail('disabled', 'collection-selected-source-inactive');
          const source = DiscoveryRuntimeSource.parse(
            JSON.parse(row.payload_json),
          );
          if (Date.parse(source.expiresAt) <= Date.parse(created))
            return fail(
              'permission-denied',
              'collection-selected-source-expired',
            );
          const nonpage = { ...selection.parameters };
          if (source.endpointTemplate.pageParameter)
            delete nonpage[source.endpointTemplate.pageParameter];
          if (
            (await requestScopeDigest({
              scopeId: source.scopeId,
              parameters: nonpage,
              windowStart: source.budget.windowStart,
              windowEnd: source.budget.windowEnd,
            })) !== source.materialScope.requestScopeSha256 ||
            (await sourceConfigurationDigest(source)) !==
              row.configuration_sha256
          )
            return fail('permission-denied', 'collection-selection-binding');
          const chainId = `collection-chain:${await digest([input.cohortId, source.id, source.revision, row.configuration_sha256, source.materialScope.requestScopeSha256])}`;
          statements.push(
            check(
              `${op}:source:${ordinal}`,
              'EXISTS(SELECT 1 FROM discovery_source_heads WHERE source_id=? AND revision=? AND active=1)',
              [source.id, source.revision],
            ),
            sql(
              'INSERT INTO discovery_collection_bindings VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
              [
                input.cohortId,
                source.id,
                source.revision,
                row.scope_sha256,
                row.configuration_sha256,
                source.materialScope.requestScopeSha256,
                canonical(source),
                canonical(selection.parameters),
                chainId,
              ],
            ),
            check(
              `${op}:binding:${ordinal}`,
              'EXISTS(SELECT 1 FROM discovery_collection_bindings WHERE cohort_id=? AND source_id=? AND source_json=? AND parameters_json=? AND chain_id=?)',
              [
                input.cohortId,
                source.id,
                canonical(source),
                canonical(selection.parameters),
                chainId,
              ],
            ),
            sql(
              "INSERT INTO discovery_collection_chains(id,cohort_id,source_id,source_revision,scope_sha256,configuration_sha256,query_sha256,status) VALUES(?,?,?,?,?,?,?,'active') ON CONFLICT DO NOTHING",
              [
                chainId,
                input.cohortId,
                source.id,
                source.revision,
                row.scope_sha256,
                row.configuration_sha256,
                source.materialScope.requestScopeSha256,
              ],
            ),
            sql(
              "INSERT INTO discovery_collection_slots(round_id,slot_index,source_id,source_revision,scope_sha256,chain_id,state) VALUES(?,?,?,?,?,?,'pending')",
              [
                input.id,
                ordinal,
                source.id,
                source.revision,
                row.scope_sha256,
                chainId,
              ],
            ),
          );
        }
        statements.push(
          sql('INSERT INTO discovery_collection_rounds VALUES(?,?,?,?,?,?)', [
            input.id,
            input.cohortId,
            input.sources.length ? 'active' : 'complete',
            0,
            input.sources.length,
            created,
          ]),
        );
        const result: DiscoveryCollectionRound = {
          id: input.id,
          cohortId: input.cohortId,
          status: input.sources.length ? 'active' : 'complete',
          cursor: 0,
          size: input.sources.length,
          createdAt: created,
          policyVersion: 'collection-policy-v1',
          maxAttemptsPerSlot: 1,
          automaticRetries: 0,
        };
        return { statements, kind: 'round', id: input.id, result };
      },
      (row) => readRound(row.result_id),
    );
  }
  function advance(roundId: string, slot: number) {
    return [
      sql(
        "UPDATE discovery_collection_rounds SET cursor=cursor+1 WHERE id=? AND cursor=? AND status='active'",
        [roundId, slot],
      ),
      sql(
        "UPDATE discovery_collection_rounds SET status='complete' WHERE id=? AND cursor=size AND status='active'",
        [roundId],
      ),
    ];
  }
  async function skipStatements(
    op: string,
    slot: SlotRow,
    outcome: DiscoveryCollectionSlotAck['outcome'],
    code: string,
  ) {
    const id = `collection-slot:${await digest(op)}`;
    const checked = now();
    return {
      id,
      ack: {
        committed: true as const,
        operationId: op,
        roundId: slot.round_id,
        slot: slot.slot_index,
        status: 'finished' as const,
        sourceId: slot.source_id,
        outcome,
      },
      statements: [
        check(
          `${op}:slot-cas`,
          'EXISTS(SELECT 1 FROM discovery_collection_slots WHERE round_id=? AND slot_index=? AND state=? AND fence=? AND claim_id IS ?)',
          [
            slot.round_id,
            slot.slot_index,
            slot.state,
            slot.fence,
            slot.claim_id,
          ],
        ),
        sql(
          'INSERT INTO discovery_collection_slot_outcomes VALUES(?,?,?,?,?,?,?,?)',
          [
            id,
            op,
            slot.round_id,
            slot.slot_index,
            slot.source_id,
            outcome,
            code,
            checked,
          ],
        ),
        sql(
          "UPDATE discovery_collection_slots SET state='finished',outcome=?,code=?,finished_at=? WHERE round_id=? AND slot_index=?",
          [outcome, code, checked, slot.round_id, slot.slot_index],
        ),
        ...advance(slot.round_id, slot.slot_index),
      ],
    };
  }
  async function completeCoverageGap(
    slot: SlotRow,
    chain: ChainRow,
  ): Promise<{
    outcome: 'disabled' | 'permission-denied' | 'unavailable';
    code: string;
  } | null> {
    const head = await sql(
      'SELECT h.active,h.revision,h.qualification_id,r.payload_json FROM discovery_source_heads h LEFT JOIN discovery_source_revisions r ON r.source_id=h.source_id AND r.revision=h.revision WHERE h.source_id=?',
      [slot.source_id],
    ).first<{
      active: number;
      revision: number;
      qualification_id: string | null;
      payload_json: string | null;
    }>();
    if (!head || head.active !== 1)
      return {
        outcome: 'disabled',
        code: 'collection-complete-source-disabled',
      };
    if (head.revision !== slot.source_revision || !head.payload_json)
      return {
        outcome: 'permission-denied',
        code: 'collection-complete-source-changed',
      };
    try {
      const source = DiscoveryRuntimeSource.parse(
        JSON.parse(head.payload_json),
      );
      if (Date.parse(source.expiresAt) <= Date.parse(now()))
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-source-expired',
        };
      const reader = createDiscoveryEvidenceStore(db, {
        resolveCapability: resolveEvidenceCapability,
        now,
      });
      const refs = (
        [
          'enrollment',
          'configuration',
          'permission',
          'rights',
          'parser',
          'normalizer',
        ] as const
      ).map((kind) => ({ kind, ...source[kind] }));
      const states = await Promise.all([
        ...refs.map((ref) =>
          reader.readRevision(ref.kind, ref.id, ref.revision),
        ),
        reader.readRevision(
          'policy',
          source.accessDecision.id,
          source.accessDecision.revision,
        ),
        reader.readRevision(
          'policy',
          source.displayRights.id,
          source.displayRights.revision,
        ),
      ]);
      if (states.some((state) => !state?.usable))
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-controls-unusable',
        };
      const row = await sql(
        'SELECT payload_json FROM discovery_source_qualifications WHERE id=?',
        [head.qualification_id],
      ).first<{ payload_json: string }>();
      if (!row)
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-qualification-missing',
        };
      const qualification = DiscoverySourceQualification.parse(
        JSON.parse(row.payload_json),
      );
      if (
        qualification.sourceId !== source.id ||
        qualification.sourceRevision !== source.revision ||
        qualification.configurationSha256 !== chain.configuration_sha256 ||
        Date.parse(qualification.expiresAt) <= Date.parse(now())
      )
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-qualification-expired',
        };
      const samples = await Promise.all(
        qualification.samples.map((sample) =>
          reader.readRevision(
            'representation',
            sample.representation.id,
            sample.representation.revision,
          ),
        ),
      );
      if (samples.some((sample) => !sample?.usable))
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-samples-unusable',
        };
      const receipt = chain.last_receipt_id
        ? await resolvePage(chain.last_receipt_id)
        : null;
      if (
        !receipt?.chainComplete ||
        receipt.chainId !== chain.id ||
        receipt.pageOrdinal !== chain.page_count
      )
        return {
          outcome: 'permission-denied',
          code: 'collection-complete-receipt-unusable',
        };
      return null;
    } catch {
      return {
        outcome: 'unavailable',
        code: 'collection-complete-integrity-unavailable',
      };
    }
  }
  async function completionGuards(op: string, slot: SlotRow, chain: ChainRow) {
    const head = await sql(
      'SELECT generation,qualification_id FROM discovery_source_heads WHERE source_id=? AND revision=? AND active=1',
      [slot.source_id, slot.source_revision],
    ).first<{ generation: number; qualification_id: string }>();
    const page = chain.last_receipt_id
      ? await resolvePage(chain.last_receipt_id)
      : null;
    if (!head?.qualification_id || !page?.chainComplete)
      return fail('permission-denied', 'collection-complete-binding-changed');
    return {
      before: [
        sql('INSERT INTO discovery_source_guards VALUES(?,?,?,?,?,?,NULL,?)', [
          `${op}:coverage`,
          slot.source_id,
          slot.source_revision,
          'collection',
          head.qualification_id,
          null,
          now(),
        ]),
        check(
          `${op}:generation`,
          'EXISTS(SELECT 1 FROM discovery_source_heads WHERE source_id=? AND revision=? AND generation=? AND active=1)',
          [slot.source_id, slot.source_revision, head.generation],
        ),
        check(
          `${op}:receipt`,
          'EXISTS(SELECT 1 FROM discovery_collection_pages WHERE id=? AND payload_json=? AND payload_sha256=? AND chain_id=? AND page_ordinal=?)',
          [
            page.id,
            canonical(page),
            await digest(page),
            chain.id,
            chain.page_count,
          ],
        ),
        check(
          `${op}:retained`,
          `NOT EXISTS(
        WITH RECURSIVE ancestors(kind,id,revision) AS (
          SELECT 'representation',?,? UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN ancestors a ON e.dependent_kind=a.kind AND e.dependent_id=a.id AND e.dependent_revision=a.revision
        ) SELECT 1 FROM ancestors a WHERE
          NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=a.kind AND c.id=a.id AND c.revision=a.revision) OR
          EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) OR
          EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) OR
          EXISTS(SELECT 1 FROM discovery_evidence_revisions r WHERE r.kind=a.kind AND r.id=a.id AND r.revision=a.revision AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(?))) OR
          (a.kind IN('enrollment','configuration','permission','rights','parser','normalizer','policy') AND (SELECT h.revision FROM discovery_evidence_heads h WHERE h.kind=a.kind AND h.id=a.id) IS NOT a.revision)
      )`,
          [page.representation.id, page.representation.revision, now()],
        ),
      ],
      after: [
        sql('DELETE FROM discovery_source_guards WHERE id=?', [
          `${op}:coverage`,
        ]),
      ],
    };
  }
  async function claimNext(
    ctx: DiscoveryCollectionContext,
    raw: z.infer<typeof DiscoveryCollectionClaimInput>,
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const input = DiscoveryCollectionClaimInput.parse(snapshot(raw));
    return runMutation(
      ctx,
      'claim-slot',
      input.roundId,
      input,
      async (op) => {
        const round = await roundRow(input.roundId);
        if (round.status !== 'active')
          return {
            statements: [],
            kind: 'round',
            id: round.id,
            result: {
              kind: round.status as 'complete' | 'stopped',
              round: roundView(round),
            },
          };
        const slot = await sql(
          'SELECT * FROM discovery_collection_slots WHERE round_id=? AND slot_index=?',
          [round.id, round.cursor],
        ).first<SlotRow>();
        if (!slot) return fail('unavailable', 'collection-slot-missing');
        const cursorGuard = check(
          `${op}:cursor`,
          "EXISTS(SELECT 1 FROM discovery_collection_rounds WHERE id=? AND cursor=? AND status='active')",
          [round.id, round.cursor],
        );
        if (slot.state === 'claimed' && slot.claim_id) {
          const abandoned = await sql(
            'SELECT * FROM discovery_collection_claims WHERE id=?',
            [slot.claim_id],
          ).first<ClaimRow>();
          if (
            abandoned &&
            Date.parse(abandoned.expires_at) <= Date.parse(now())
          ) {
            const skipped = await skipStatements(
              op,
              slot,
              'timed-out',
              'collection-expired-uncertain-slot',
            );
            return {
              statements: [
                cursorGuard,
                check(
                  `${op}:abandoned`,
                  "EXISTS(SELECT 1 FROM discovery_collection_slots s JOIN discovery_collection_claims c ON c.id=s.claim_id WHERE s.round_id=? AND s.slot_index=? AND s.state='claimed' AND s.fence=? AND c.id=? AND julianday(c.expires_at)<=max(julianday('now'),julianday(?)))",
                  [round.id, slot.slot_index, slot.fence, abandoned.id, now()],
                ),
                sql(
                  'UPDATE discovery_source_leases SET fence=fence+1,expires_at=? WHERE id=? AND owner=? AND fence=?',
                  [
                    now(),
                    abandoned.source_lease_id,
                    abandoned.owner,
                    abandoned.source_lease_fence,
                  ],
                ),
                ...skipped.statements,
              ],
              kind: 'slot',
              id: skipped.id,
              result: { kind: 'skipped' as const, ack: skipped.ack },
            };
          }
        }
        const chain = await sql(
          'SELECT * FROM discovery_collection_chains WHERE id=?',
          [slot.chain_id],
        ).first<ChainRow>();
        if (slot.state === 'revoked' || !chain) {
          const skip = await skipStatements(
            op,
            slot,
            'permission-denied',
            'collection-source-revoked',
          );
          return {
            statements: [cursorGuard, ...skip.statements],
            kind: 'slot',
            id: skip.id,
            result: { kind: 'skipped' as const, ack: skip.ack },
          };
        }
        if (
          chain.status === 'complete' ||
          chain.status !== 'active' ||
          (chain.expires_at &&
            Date.parse(chain.expires_at) <= Date.parse(now()))
        ) {
          const coverageGap =
            chain.status === 'complete'
              ? await completeCoverageGap(slot, chain)
              : null;
          const done = chain.status === 'complete' && coverageGap === null;
          const expired = Boolean(
            chain.expires_at &&
            Date.parse(chain.expires_at) <= Date.parse(now()),
          );
          const previousPage = chain.last_receipt_id
            ? await resolvePage(chain.last_receipt_id)
            : null;
          const skip = await skipStatements(
            op,
            slot,
            done
              ? 'already-complete'
              : (coverageGap?.outcome ??
                  (expired
                    ? 'timed-out'
                    : chain.status === 'partial'
                      ? 'partial'
                      : 'unavailable')),
            done
              ? 'collection-chain-already-complete'
              : (coverageGap?.code ??
                  (expired
                    ? 'collection-continuation-expired'
                    : (previousPage?.limitationCode ??
                      'collection-new-cohort-required'))),
          );
          const proof = done
            ? await completionGuards(op, slot, chain)
            : { before: [], after: [] };
          return {
            statements: [
              cursorGuard,
              ...proof.before,
              ...(!done
                ? [
                    sql(
                      "UPDATE discovery_collection_chains SET status='restart-required' WHERE id=?",
                      [chain.id],
                    ),
                  ]
                : []),
              ...skip.statements,
              ...proof.after,
            ],
            kind: 'slot',
            id: skip.id,
            result: { kind: 'skipped' as const, ack: skip.ack },
          };
        }
        const active = await sql(
          "SELECT c.* FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.claim_id=c.id WHERE s.source_id=? AND s.state='claimed' AND julianday(c.expires_at)>max(julianday('now'),julianday(?))",
          [slot.source_id, now()],
        ).first<ClaimRow>();
        if (active) {
          if (
            active.round_id === round.id &&
            active.slot_index === round.cursor
          )
            return {
              statements: [],
              kind: 'busy',
              id: active.id,
              result: {
                kind: 'busy' as const,
                roundId: round.id,
                slot: round.cursor,
                expiresAt: active.expires_at,
              },
            };
          const skip = await skipStatements(
            op,
            slot,
            'unavailable',
            'collection-source-busy',
          );
          return {
            statements: [cursorGuard, ...skip.statements],
            kind: 'slot',
            id: skip.id,
            result: { kind: 'skipped' as const, ack: skip.ack },
          };
        }
        const checked = now();
        if (
          Date.parse(input.processingDeadlineAt) <= Date.parse(checked) ||
          Date.parse(input.processingDeadlineAt) >
            Date.parse(input.expiresAt) ||
          Date.parse(input.expiresAt) - Date.parse(checked) >
            DISCOVERY_COLLECTION_LIMITS.maxLeaseMs
        )
          return fail('timed-out', 'collection-claim-deadline');
        const oldLease = await sql(
          'SELECT id,owner,fence,expires_at FROM discovery_source_leases WHERE source_id=?',
          [slot.source_id],
        ).first<{
          id: string;
          owner: string;
          fence: number;
          expires_at: string;
        }>();
        if (oldLease && Date.parse(oldLease.expires_at) > Date.parse(checked)) {
          const skip = await skipStatements(
            op,
            slot,
            'unavailable',
            'collection-source-busy',
          );
          return {
            statements: [cursorGuard, ...skip.statements],
            kind: 'slot',
            id: skip.id,
            result: { kind: 'skipped' as const, ack: skip.ack },
          };
        }
        const leaseId =
            oldLease?.id ?? `collection-lease:${await digest(slot.source_id)}`,
          sourceFence = (oldLease?.fence ?? 0) + 1,
          fence = slot.fence + 1,
          claimId = `collection-claim:${await digest([round.id, slot.slot_index, fence])}`;
        const statements = [
          cursorGuard,
          check(
            `${op}:slot`,
            "EXISTS(SELECT 1 FROM discovery_collection_slots WHERE round_id=? AND slot_index=? AND fence=? AND state='pending')",
            [round.id, slot.slot_index, slot.fence],
          ),
          check(
            `${op}:lease`,
            "NOT EXISTS(SELECT 1 FROM discovery_source_leases WHERE source_id=? AND julianday(expires_at)>max(julianday('now'),julianday(?)))",
            [slot.source_id, checked],
          ),
          sql(
            'INSERT INTO discovery_source_leases VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at WHERE fence=?',
            [
              leaseId,
              slot.source_id,
              input.owner,
              sourceFence,
              input.expiresAt,
              oldLease?.fence ?? 0,
            ],
          ),
          check(
            `${op}:fence`,
            'EXISTS(SELECT 1 FROM discovery_source_leases WHERE id=? AND source_id=? AND owner=? AND fence=? AND expires_at=?)',
            [
              leaseId,
              slot.source_id,
              input.owner,
              sourceFence,
              input.expiresAt,
            ],
          ),
          sql(
            'INSERT INTO discovery_collection_claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
              claimId,
              round.id,
              slot.slot_index,
              slot.scope_sha256,
              input.owner,
              fence,
              input.expiresAt,
              input.processingDeadlineAt,
              leaseId,
              sourceFence,
              chain.revision,
              chain.page_count,
              chain.checkpoint,
              chain.last_receipt_id,
              null,
            ],
          ),
          sql(
            "UPDATE discovery_collection_slots SET state='claimed',claim_id=?,fence=? WHERE round_id=? AND slot_index=?",
            [claimId, fence, round.id, slot.slot_index],
          ),
        ];
        // Read view is prepared from the exact immutable binding; SQL guards pin it.
        const binding = await sql(
          'SELECT * FROM discovery_collection_bindings WHERE cohort_id=? AND source_id=?',
          [round.cohort_id, slot.source_id],
        ).first<BindingRow>();
        const p = await sql(
          'SELECT policy_json FROM discovery_collection_cohorts WHERE id=?',
          [round.cohort_id],
        ).first<{ policy_json: string }>();
        if (!binding?.source_json || !binding.parameters_json)
          return fail('permission-denied', 'collection-source-removed');
        const pol = JSON.parse(p!.policy_json) as ReturnType<typeof policy>;
        const claim: DiscoveryCollectionClaim = {
          id: claimId,
          roundId: round.id,
          slot: slot.slot_index,
          owner: input.owner,
          fence,
          expiresAt: input.expiresAt,
          processingDeadlineAt: input.processingDeadlineAt,
          source: DiscoveryRuntimeSource.parse(JSON.parse(binding.source_json)),
          parameters: JSON.parse(binding.parameters_json),
          sourceLease: {
            id: leaseId,
            sourceId: slot.source_id,
            owner: input.owner,
            fence: sourceFence,
            expiresAt: input.expiresAt,
          },
          chain: chainView(chain),
          maxPagesPerChain: pol.maxPagesPerChain,
          continuationTtlMs: pol.continuationTtlMs,
          issuedPlanId: null,
        };
        return {
          statements,
          kind: 'claim',
          id: claimId,
          result: { kind: 'claimed' as const, claim },
        };
      },
      async (row) => {
        if (row.result_kind === 'claim')
          return {
            kind: 'claimed' as const,
            claim: await resolveClaim(row.result_id),
          };
        if (row.result_kind === 'slot') {
          const ack = await slotAck(row.result_id);
          if (!ack)
            return fail('unavailable', 'collection-slot-outcome-missing');
          return { kind: 'skipped' as const, ack };
        }
        if (row.result_kind === 'busy') {
          const c = await resolveClaim(row.result_id);
          return {
            kind: 'busy' as const,
            roundId: c.roundId,
            slot: c.slot,
            expiresAt: c.expiresAt,
          };
        }
        const round = await readRound(row.result_id);
        return {
          kind:
            round.status === 'stopped'
              ? ('stopped' as const)
              : ('complete' as const),
          round,
        };
      },
    );
  }
  async function issueForClaim(
    ctx: DiscoveryCollectionContext,
    raw: { claimId: string; planId: string; deadlineAt: string },
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const input = z
      .object({
        claimId: DiscoveryId,
        planId: DiscoveryId,
        deadlineAt: DiscoveryInstant,
      })
      .strict()
      .parse(snapshot(raw));
    const claim = await resolveClaim(input.claimId);
    return runMutation(
      ctx,
      'issue-page',
      claim.roundId,
      input,
      async (op) => {
        await assertLive(claim.id, 'issue');
        if (claim.issuedPlanId)
          return fail('unavailable', 'collection-slot-already-issued');
        const deadlineAt = new Date(
          Math.min(
            Date.parse(input.deadlineAt),
            Date.parse(claim.processingDeadlineAt),
            Date.parse(claim.sourceLease.expiresAt),
            Date.parse(now()) + claim.source.budget.maxWallTimeMs,
            claim.chain.expiresAt
              ? Date.parse(claim.chain.expiresAt)
              : Infinity,
          ),
        ).toISOString();
        const parameters = { ...claim.parameters };
        let continuation: DiscoveryContinuationReceipt | undefined;
        if (claim.chain.lastReceiptId) {
          const page = await resolvePage(claim.chain.lastReceiptId);
          if (!page?.nextCheckpoint || !claim.chain.expiresAt)
            return fail('permission-denied', 'collection-chain-parent-missing');
          if (!claim.source.endpointTemplate.pageParameter)
            return fail('misconfigured', 'collection-pagination-unconfigured');
          parameters[claim.source.endpointTemplate.pageParameter] =
            page.nextCheckpoint;
          continuation = {
            parentReceiptId: page.id,
            sourceId: claim.source.id,
            installation: claim.source.installation,
            scopeId: claim.source.scopeId,
            sourceRevision: claim.source.revision,
            querySha256: claim.chain.querySha256,
            tokenSha256: await discoveryTokenDigest(page.nextCheckpoint),
            expiresAt: claim.chain.expiresAt,
            parentCaptureOperationId: page.operationId,
            parentPlanId: page.planId,
            representation: page.representation,
            representationSha256: page.representationSha256,
            nextCheckpoint: page.nextCheckpoint,
          };
        }
        const token = await capabilityFor({
          domain: 'registry',
          action: 'issue',
          targetId: claim.source.id,
          operationId: op,
        });
        const descriptor = continuation
          ? {
              parentReceiptId: continuation.parentReceiptId,
              sourceId: continuation.sourceId,
              installation: continuation.installation,
              scopeId: continuation.scopeId,
              sourceRevision: continuation.sourceRevision,
              querySha256: continuation.querySha256,
              tokenSha256: continuation.tokenSha256,
              expiresAt: continuation.expiresAt,
            }
          : undefined;
        const issued = await registry.issue(
          { operationId: op, capabilityToken: token },
          {
            id: input.planId,
            sourceId: claim.source.id,
            sourceRevision: claim.source.revision,
            runId: claim.roundId,
            purpose: 'collection',
            qualificationId: (
              await sql(
                'SELECT qualification_id FROM discovery_source_heads WHERE source_id=?',
                [claim.source.id],
              ).first<{ qualification_id: string }>()
            )?.qualification_id,
            parameters,
            checkpoint: claim.chain.checkpoint,
            ...(descriptor ? { continuation: descriptor } : {}),
            lease: {
              id: claim.sourceLease.id,
              owner: claim.owner,
              fence: claim.sourceLease.fence,
            },
            deadlineAt,
          },
        );
        return {
          statements: [
            guard(op, claim.id, 'issue'),
            check(
              `${op}:once`,
              '(SELECT issued_plan_id FROM discovery_collection_claims WHERE id=?) IS NULL',
              [claim.id],
            ),
            sql(
              'UPDATE discovery_collection_claims SET issued_plan_id=? WHERE id=?',
              [issued.id, claim.id],
            ),
            sql(
              'INSERT INTO discovery_collection_health(source_id,last_attempted_at) VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at',
              [claim.source.id, now()],
            ),
            clear(op),
          ],
          kind: 'plan',
          id: issued.id,
          result: issued,
        };
      },
      (row) => registry.resolvePlan(row.result_id),
    );
  }
  async function copyAcquisition(
    raw: DiscoveryAcquisition,
  ): Promise<DiscoveryAcquisition> {
    if (
      !raw ||
      Object.getPrototypeOf(raw) !== Object.prototype ||
      Object.values(Object.getOwnPropertyDescriptors(raw)).some(
        (value) => !('value' in value),
      ) ||
      !(raw.bytes instanceof Uint8Array)
    )
      return fail('parser-failed', 'collection-acquisition-invalid');
    const bytes = new Uint8Array(raw.bytes);
    const { bytes: unused, ...metadata } = raw;
    void unused;
    const value = acquisitionMetadataSchema.parse(snapshot(metadata));
    delete value.plan.requestBindingToken;
    if (
      bytes.length !== value.receivedBytes ||
      bytes.length > value.retainedByteCeiling
    )
      return fail('parser-failed', 'collection-acquisition-byte-binding');
    return { ...value, bytes };
  }
  async function bytesDigest(bytes: Uint8Array) {
    return [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
      ),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }
  async function preparePage(
    claimId: string,
    raw: DiscoveryAcquisition,
  ): Promise<DiscoveryPreparedCollectionPage> {
    const started = performance.now(),
      wallStarted = Date.parse(now());
    DiscoveryId.parse(claimId);
    const acquisition = await copyAcquisition(raw);
    const claim = await resolveClaim(claimId);
    const deadline = Math.min(
      Date.parse(acquisition.plan.deadlineAt),
      Date.parse(claim.processingDeadlineAt),
      Date.parse(claim.sourceLease.expiresAt),
    );
    const monotonicExpiresAt = started + Math.max(0, deadline - wallStarted);
    const remaining = () =>
      Math.max(
        0,
        Math.min(
          monotonicExpiresAt - performance.now(),
          deadline - Date.parse(now()),
        ),
      );
    const requireTime = () => {
      if (remaining() <= 0)
        return fail('timed-out', 'collection-prepare-deadline');
    };
    requireTime();
    await assertLiveRead(claim.id, acquisition.plan.id);
    const bodySha256 = await bytesDigest(acquisition.bytes);
    const durablePlan = await sql(
      'SELECT payload_json FROM discovery_source_plans WHERE id=?',
      [acquisition.plan.id],
    ).first<{ payload_json: string }>();
    if (
      !durablePlan ||
      canonical(planSchema.parse(JSON.parse(durablePlan.payload_json))) !==
        canonical(acquisition.plan) ||
      acquisition.endpoint !== acquisition.plan.endpoint
    )
      return fail('parser-failed', 'collection-acquisition-plan-mismatch');
    const attempt = await sql(
      "SELECT max_items FROM discovery_source_attempts WHERE id=? AND plan_id=? AND state='received' AND body_sha256=? AND received_bytes=?",
      [
        acquisition.attemptId,
        acquisition.plan.id,
        bodySha256,
        acquisition.bytes.length,
      ],
    ).first<{ max_items: number }>();
    if (
      !attempt ||
      claim.issuedPlanId !== acquisition.plan.id ||
      acquisition.plan.request.sourceId !== claim.source.id ||
      acquisition.plan.request.runId !== claim.roundId ||
      acquisition.plan.requestSha256 !==
        (await digest(acquisition.plan.request))
    )
      return fail('parser-failed', 'collection-acquisition-issued-binding');
    // Link metadata affects completeness. Authenticate its exact value (including
    // explicit absence) against the immutable transport finish digest before it
    // reaches the trusted parser. Legacy acquisitions retain their old shape.
    if (acquisition.responseLink !== undefined) {
      const finished = await sql('SELECT finish_sha256 FROM discovery_source_attempts WHERE id=?', [acquisition.attemptId]).first<{finish_sha256:string}>();
      const expected = await digest({attemptId:acquisition.attemptId,outcome:'received',receivedBytes:acquisition.bytes.length,httpStatus:acquisition.status,representationSha256:bodySha256,responseLink:acquisition.responseLink});
      if (!finished || finished.finish_sha256 !== expected) return fail('parser-failed','collection-response-link-binding');
    }
    requireTime();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let parserOutput: unknown;
    try {
      parserOutput = await Promise.race([
        Promise.resolve().then(() =>
          parser({
            bytes: new Uint8Array(acquisition.bytes),
            request: snapshot(acquisition.plan.request),
            requestSha256: acquisition.plan.requestSha256,
            representationSha256: bodySha256,
            parser: { ...claim.source.parser },
            maxItems: attempt.max_items,
            ...(acquisition.responseLink !== undefined ? {responseLink:acquisition.responseLink} : {}),
          }),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DiscoveryRuntimeError(
                  'timed-out',
                  'collection-prepare-deadline',
                ),
              ),
            remaining(),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    requireTime();
    const draft = DiscoveryCollectionDraft.parse(snapshot(parserOutput));
    if (
      draft.requestSha256 !== acquisition.plan.requestSha256 ||
      draft.representationSha256 !== bodySha256 ||
      draft.parser.id !== claim.source.parser.id ||
      draft.parser.revision !== claim.source.parser.revision ||
      draft.leads.length > attempt.max_items
    )
      return fail('parser-failed', 'collection-parser-binding-or-budget');
    await assertLiveRead(claim.id, acquisition.plan.id);
    requireTime();
    prunePrepared();
    if (prepared.size >= 128)
      return fail('budget-exhausted', 'collection-prepared-capacity');
    const fingerprint = await digest({
      claimId: claim.id,
      planId: acquisition.plan.id,
      bodySha256,
      draft,
    });
    requireTime();
    const handle = Object.freeze({}) as DiscoveryPreparedCollectionPage;
    prepared.set(handle, {
      claim,
      acquisition,
      draft,
      bodySha256,
      maxItems: attempt.max_items,
      fingerprint,
      expiresAt: new Date(deadline).toISOString(),
      monotonicExpiresAt,
    });
    return handle;
  }
  function discardPreparedPage(handle: DiscoveryPreparedCollectionPage) {
    prepared.delete(handle);
  }
  function releaseLease(claim: DiscoveryCollectionClaim) {
    return sql(
      'UPDATE discovery_source_leases SET fence=fence+1,expires_at=? WHERE id=? AND owner=? AND fence=?',
      [now(), claim.sourceLease.id, claim.owner, claim.sourceLease.fence],
    );
  }
  async function commitPage(
    ctx: DiscoveryCollectionContext,
    input: {
      prepared?: DiscoveryPreparedCollectionPage;
      requestBindingToken?: string;
    },
  ): Promise<DiscoveryCollectionPageReceipt> {
    ctx = contextSchema.parse(snapshot(ctx));
    if (
      !input ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some(
        (value) => !('value' in value),
      ) ||
      Object.keys(input).some(
        (key) => key !== 'prepared' && key !== 'requestBindingToken',
      )
    )
      return fail('permission-denied', 'collection-commit-input');
    const token = input.requestBindingToken;
    const handle = input.prepared;
    const value = handle ? prepared.get(handle) : undefined;
    const prior = await operation(ctx.operationId);
    if (prior) {
      if (
        prior.result_kind !== 'page' ||
        (value && prior.request_sha256 !== value.fingerprint)
      )
        return fail('unavailable', 'collection-operation-conflict');
      await authorize(
        ctx,
        'commit-page',
        prior.target_id,
        prior.request_sha256,
      );
      const page = await resolvePage(prior.result_id);
      if (!page) return fail('permission-denied', 'collection-page-removed');
      return page;
    }
    if (!value || !handle)
      return fail('permission-denied', 'collection-prepared-handle-invalid');
    prepared.delete(handle);
    prunePrepared();
    if (
      Date.parse(value.expiresAt) <= Date.parse(now()) ||
      value.monotonicExpiresAt <= performance.now()
    )
      return fail('timed-out', 'collection-prepared-expired');
    if (typeof token !== 'string' || !token || token.length > 2048)
      return fail('permission-denied', 'collection-issued-token-required');
    const { claim, acquisition, draft, bodySha256 } = value;
    const { cap } = await authorize(
      ctx,
      'commit-page',
      claim.roundId,
      value.fingerprint,
    );
    const requirePreparedTime = () => {
      if (
        value.monotonicExpiresAt <= performance.now() ||
        Date.parse(value.expiresAt) <= Date.parse(now())
      )
        return fail('timed-out', 'collection-prepared-expired');
    };
    requirePreparedTime();
    await assertLive(claim.id, 'capture', acquisition.plan.id);
    const pageOrdinal = claim.chain.pageCount + 1;
    const pageParameter = claim.source.endpointTemplate.pageParameter;
    const currentToken = pageParameter
      ? acquisition.plan.request.parameters[pageParameter]
      : undefined;
    const repeated =
      draft.nextCheckpoint !== null &&
      (draft.nextCheckpoint === currentToken ||
        Boolean(
          await sql(
            'SELECT token_sha256 FROM discovery_collection_tokens WHERE chain_id=? AND token_sha256=?',
            [claim.chain.id, await discoveryTokenDigest(draft.nextCheckpoint)],
          ).first(),
        ));
    const limitationCode = repeated
      ? 'collection-looping-token'
      : draft.truncated
        ? 'collection-truncated'
        : draft.rejectedCount
          ? 'collection-rejected-rows'
          : draft.providerLimited
            ? 'collection-provider-limited'
            : !draft.terminal && draft.nextCheckpoint === null
              ? 'collection-terminal-missing'
              : !draft.terminal && pageOrdinal >= claim.maxPagesPerChain
                ? 'collection-page-cap'
                : null;
    const complete = draft.terminal && limitationCode === null;
    const nextCheckpoint =
      limitationCode === null && !draft.terminal ? draft.nextCheckpoint : null;
    const committedAt = now(),
      pageId = `collection-page:${await digest([claim.chain.id, pageOrdinal, acquisition.plan.requestSha256])}`,
      representationId = `collection-body:${await digest([acquisition.plan.id, bodySha256])}`,
      originId = `collection-origin:${await digest(acquisition.plan.id)}`;
    const receipt: DiscoveryCollectionPageReceipt = {
      schemaVersion: DISCOVERY_COLLECTION_VERSION,
      id: pageId,
      operationId: ctx.operationId,
      committed: true,
      roundId: claim.roundId,
      slot: claim.slot,
      claimId: claim.id,
      chainId: claim.chain.id,
      pageOrdinal,
      planId: acquisition.plan.id,
      sourceId: claim.source.id,
      sourceRevision: claim.source.revision,
      requestSha256: acquisition.plan.requestSha256,
      representation: { id: representationId, revision: 1 },
      representationSha256: bodySha256,
      leadCount: draft.leads.length,
      rejectedCount: draft.rejectedCount,
      truncated: draft.truncated,
      providerLimited: draft.providerLimited,
      terminal: draft.terminal,
      nextCheckpoint,
      proposedCheckpoint: draft.nextCheckpoint,
      chainComplete: complete,
      limitationCode,
      committedAt,
      ...(acquisition.responseLink !== undefined ? {responseLink:acquisition.responseLink} : {}),
    };
    canonical(receipt);
    const evidenceContext = async (
      action: 'issue-request' | 'origin' | 'capture',
      targetId: string,
      operationId: string,
    ) => ({
      operationId,
      expectedRevision: null,
      capabilityToken: await capabilityFor({
        domain: 'evidence',
        action,
        targetId,
        operationId,
      }),
    });
    const store = createDiscoveryEvidenceStore(db, {
      resolveCapability: resolveEvidenceCapability,
      resolveIssuedSourceRequest: registry.resolveIssuedSourceRequest,
      now,
      composeCaptureGuard: async (guardInput) => {
        requirePreparedTime();
        const base = await registry.composeCaptureGuard(guardInput);
        requirePreparedTime();
        const after: D1StatementLike[] = [
          ...base.after,
          sql(
            'INSERT INTO discovery_collection_item_settlements VALUES(?,?,?,?,?)',
            [
              ctx.operationId,
              acquisition.attemptId,
              claim.chain.scopeSha256,
              value.maxItems,
              draft.leads.length,
            ],
          ),
          sql(
            'UPDATE discovery_source_budgets SET items=items-?+? WHERE id=?',
            [value.maxItems, draft.leads.length, claim.source.budget.id],
          ),
          sql(
            'INSERT INTO discovery_collection_pages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
              pageId,
              ctx.operationId,
              claim.id,
              claim.roundId,
              claim.slot,
              claim.chain.id,
              pageOrdinal,
              claim.chain.scopeSha256,
              acquisition.plan.id,
              representationId,
              1,
              bodySha256,
              draft.leads.length,
              canonical(receipt),
              await digest(receipt),
            ],
          ),
        ];
        for (const [ordinal, lead] of draft.leads.entries()) {
          const normalized = {
            ...lead,
            candidateKey: await discoveryProviderIdentityId({
              provider: claim.source.provider,
              installation: claim.source.installation,
              kind: lead.kind,
              nativeId: lead.nativeId,
            }),
            provider: claim.source.provider,
            installation: claim.source.installation,
            request: acquisition.plan.request,
            requestSha256: acquisition.plan.requestSha256,
            representation: receipt.representation,
            representationSha256: bodySha256,
            parser: claim.source.parser,
          };
          after.push(
            sql('INSERT INTO discovery_collection_leads VALUES(?,?,?,?,?,?)', [
              `collection-lead:${await digest([pageId, ordinal, lead.kind, lead.nativeId])}`,
              pageId,
              claim.chain.scopeSha256,
              ordinal,
              canonical(normalized),
              await digest(normalized),
            ]),
          );
        }
        if (currentToken !== undefined)
          after.push(
            sql(
              'INSERT INTO discovery_collection_tokens VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
              [
                claim.chain.id,
                await discoveryTokenDigest(currentToken),
                claim.chain.scopeSha256,
                pageOrdinal,
              ],
            ),
          );
        if (nextCheckpoint !== null)
          after.push(
            sql('INSERT INTO discovery_collection_tokens VALUES(?,?,?,?)', [
              claim.chain.id,
              await discoveryTokenDigest(nextCheckpoint),
              claim.chain.scopeSha256,
              pageOrdinal,
            ]),
          );
        after.push(
          sql(
            'UPDATE discovery_collection_chains SET revision=revision+1,page_count=?,status=?,checkpoint=?,last_receipt_id=?,expires_at=? WHERE id=?',
            [
              pageOrdinal,
              complete ? 'complete' : limitationCode ? 'partial' : 'active',
              nextCheckpoint,
              pageId,
              nextCheckpoint
                ? new Date(
                    Math.min(
                      Date.parse(committedAt) + claim.continuationTtlMs,
                      Date.parse(claim.source.expiresAt),
                    ),
                  ).toISOString()
                : null,
              claim.chain.id,
            ],
          ),
          sql(
            "UPDATE discovery_collection_slots SET state='finished',outcome=?,code=?,finished_at=? WHERE round_id=? AND slot_index=?",
            [
              complete
                ? draft.leads.length
                  ? 'healthy'
                  : 'healthy-empty'
                : 'partial',
              limitationCode ?? 'collection-page-committed',
              committedAt,
              claim.roundId,
              claim.slot,
            ],
          ),
          releaseLease(claim),
          ...advance(claim.roundId, claim.slot),
          sql(
            'INSERT INTO discovery_collection_health(source_id,last_attempted_at,last_successful_at,last_complete_at,last_good_receipt_id,last_good_scope_sha256,outcome,code) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at,last_successful_at=excluded.last_successful_at,last_complete_at=CASE WHEN excluded.last_complete_at IS NOT NULL THEN excluded.last_complete_at ELSE last_complete_at END,last_good_receipt_id=excluded.last_good_receipt_id,last_good_scope_sha256=excluded.last_good_scope_sha256,outcome=excluded.outcome,code=excluded.code',
            [
              claim.source.id,
              committedAt,
              committedAt,
              complete ? committedAt : null,
              pageId,
              claim.chain.scopeSha256,
              complete
                ? draft.leads.length
                  ? 'healthy'
                  : 'healthy-empty'
                : 'partial',
              limitationCode ?? 'collection-page-committed',
            ],
          ),
          check(
            `${ctx.operationId}:cap-final`,
            "julianday(?)>max(julianday('now'),julianday(?))",
            [cap.expiresAt, now()],
          ),
          audit(
            {
              operation_id: ctx.operationId,
              action: 'commit-page',
              target_id: claim.roundId,
              request_sha256: value.fingerprint,
              result_kind: 'page',
              result_id: pageId,
            },
            cap,
          ),
          clear(ctx.operationId),
        );
        requirePreparedTime();
        return {
          before: [
            ...base.before,
            guard(ctx.operationId, claim.id, 'capture', acquisition.plan.id),
          ],
          after,
        };
      },
    });
    const issued = {
      id: acquisition.plan.id,
      revision: 1,
      requestSha256: acquisition.plan.requestSha256,
      materialScope: claim.source.materialScope,
      actualEndpoint: acquisition.endpoint,
      originMemberId: acquisition.plan.originMemberId,
      permission: claim.source.permission,
      rights: claim.source.rights,
      expiresAt: acquisition.plan.retainedThrough,
      requestBindingToken: token,
    };
    try {
      await store.appendIssuedSourceRequest(
        await evidenceContext(
          'issue-request',
          issued.id,
          `collection-issued:${await digest(issued.id)}`,
        ),
        issued,
      );
      await store.appendOrigin(
        await evidenceContext(
          'origin',
          originId,
          `collection-origin-op:${await digest(originId)}`,
        ),
        {
          id: originId,
          revision: 1,
          status: 'provisional-source-response',
          originalWorkId: null,
          materialScope: claim.source.materialScope,
          issuedRequest: { id: issued.id, revision: 1 },
          requestSha256: issued.requestSha256,
          members: [issued.originMemberId],
          memberEndpoints: { [issued.originMemberId]: issued.actualEndpoint },
          retentionRights: [claim.source.rights],
          policy: claim.source.accessDecision,
          reason: 'Private source-response collection',
          requestBindingToken: token,
        },
      );
      await store.appendRepresentation(
        await evidenceContext('capture', representationId, ctx.operationId),
        {
          id: representationId,
          revision: 1,
          enrollment: claim.source.enrollment,
          configuration: claim.source.configuration,
          permission: claim.source.permission,
          rights: claim.source.rights,
          origin: { id: originId, revision: 1 },
          originMemberId: issued.originMemberId,
          parser: claim.source.parser,
          normalizer: claim.source.normalizer,
          materialScope: claim.source.materialScope,
          issuedRequest: { id: issued.id, revision: 1 },
          requestSha256: issued.requestSha256,
          actualEndpoint: issued.actualEndpoint,
          capturedAt: committedAt,
          byteKind: 'captured-body-bytes',
          format: draft.representationFormat,
          bytes: new Uint8Array(acquisition.bytes),
          requestBindingToken: token,
        },
      );
    } catch (error) {
      return mapError(error);
    }
    const persisted = await resolvePage(pageId);
    if (!persisted) return fail('unavailable', 'collection-page-ack-missing');
    return persisted;
  }
  async function finishSlot(
    ctx: DiscoveryCollectionContext,
    raw: { claimId: string; failure: z.infer<typeof DiscoverySourceFailure> },
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const input = z
      .object({ claimId: DiscoveryId, failure: DiscoverySourceFailure })
      .strict()
      .parse(snapshot(raw));
    const claim = await resolveClaim(input.claimId);
    if (input.failure.sourceId !== claim.source.id)
      return fail('permission-denied', 'collection-failure-source-binding');
    if (claim.issuedPlanId) {
      const plan = await sql(
        'SELECT payload_json FROM discovery_source_plans WHERE id=?',
        [claim.issuedPlanId],
      ).first<{ payload_json: string }>();
      if (
        plan &&
        input.failure.operationId !==
          planSchema.parse(JSON.parse(plan.payload_json)).request.operationId
      )
        return fail(
          'permission-denied',
          'collection-failure-operation-binding',
        );
    }
    return runMutation(
      ctx,
      'finish-slot',
      claim.roundId,
      input,
      async (op) => {
        const slot = await sql(
          'SELECT * FROM discovery_collection_slots WHERE round_id=? AND slot_index=?',
          [claim.roundId, claim.slot],
        ).first<SlotRow>();
        if (!slot) return fail('unavailable', 'collection-slot-missing');
        const skipped = await skipStatements(
          op,
          slot,
          input.failure.outcome,
          input.failure.code,
        );
        return {
          statements: [
            guard(op, claim.id, 'finish'),
            ...skipped.statements,
            releaseLease(claim),
            sql(
              'INSERT INTO discovery_collection_health(source_id,last_attempted_at,outcome,code) VALUES(?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at,outcome=excluded.outcome,code=excluded.code',
              [
                claim.source.id,
                now(),
                input.failure.outcome,
                input.failure.code,
              ],
            ),
            clear(op),
          ],
          kind: 'slot',
          id: skipped.id,
          result: skipped.ack,
        };
      },
      async (row) => {
        const ack = await slotAck(row.result_id);
        if (!ack) return fail('unavailable', 'collection-slot-ack-missing');
        return ack;
      },
    );
  }
  async function stopRound(
    ctx: DiscoveryCollectionContext,
    raw: { roundId: string; reasonCode: string },
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const input = z
      .object({
        roundId: DiscoveryId,
        reasonCode: z.string().regex(/^[a-z0-9-]{1,100}$/),
      })
      .strict()
      .parse(snapshot(raw));
    return runMutation(
      ctx,
      'stop-round',
      input.roundId,
      input,
      async () => ({
        kind: 'round',
        id: input.roundId,
        result: {
          ...(await readRound(input.roundId)),
          status: 'stopped' as const,
        },
        statements: [
          sql(
            "UPDATE discovery_source_leases SET fence=fence+1,expires_at=? WHERE EXISTS(SELECT 1 FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.claim_id=c.id WHERE c.round_id=? AND s.state='claimed' AND discovery_source_leases.id=c.source_lease_id AND discovery_source_leases.fence=c.source_lease_fence AND discovery_source_leases.owner=c.owner)",
            [now(), input.roundId],
          ),
          sql(
            "UPDATE discovery_collection_rounds SET status='stopped' WHERE id=?",
            [input.roundId],
          ),
        ],
      }),
      (row) => readRound(row.result_id),
    );
  }
  function createTransport(
    transportOptions: DiscoveryCollectionTransportOptions,
  ) {
    return registry.createTransport(transportOptions);
  }
  async function readHealth(
    sourceId: string,
  ): Promise<DiscoveryCollectionHealth | null> {
    const row = await sql(
      'SELECT * FROM discovery_collection_health WHERE source_id=?',
      [DiscoveryId.parse(sourceId)],
    ).first<Record<string, unknown>>();
    return row
      ? {
          sourceId: String(row.source_id),
          lastAttemptedAt: row.last_attempted_at as string | null,
          lastSuccessfulAt: row.last_successful_at as string | null,
          lastCompleteAt: row.last_complete_at as string | null,
          lastPublicRefreshAt: null,
          lastGoodReceiptId: row.last_good_receipt_id as string | null,
        }
      : null;
  }
  return {
    createRound,
    claimNext,
    resolveClaim,
    issueForClaim,
    preparePage,
    discardPreparedPage,
    commitPage,
    finishSlot,
    stopRound,
    resolvePage,
    resolveChainPage,
    resolveOperation,
    createTransport,
    readRound,
    readHealth,
  };
}
