import { z } from 'zod';
import { DiscoveryId, DiscoveryInstant } from '../../content/discovery-schema';
import {
  DiscoveryRepresentationInput,
  type DiscoveryCapabilityResolver,
} from '../../content/discovery-evidence';
import {
  canonicalDiscoveryEvidenceJson as canonical,
  createDiscoveryEvidenceStore,
} from '../discovery-evidence-store';
import type { D1DatabaseLike, D1StatementLike } from '../persistence';
import { DiscoverySourceRequest } from './source-contract';
import {
  DiscoveryRuntimeSource,
  DiscoverySourceQualification,
  DiscoverySamplingGrant,
  DiscoveryRuntimeError,
  type DiscoveryRegistryContext,
  type DiscoveryRegistryAction,
  type DiscoveryRegistryCapabilityResolver,
  type DiscoveryIssuedPlan,
  type DiscoveryIssueInput,
  type DiscoveryLease,
  type DiscoverySourceRegistry,
  type DiscoveryAttemptFinish,
  type DiscoveryCaptureGuardInput,
  type DiscoveryContinuationReceipt,
} from './runtime-contract';
import {
  constructDiscoveryEndpoint,
  discoveryEndpointTemplateDigest,
} from './endpoint';
import { createDiscoveryTransport } from './transport';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';

const encoder = new TextEncoder();
export async function discoveryRuntimeDigest(value: unknown): Promise<string> {
  const bytes = encoder.encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function discoveryTokenDigest(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export const sourceConfigurationDigest = (source: DiscoveryRuntimeSource) =>
  discoveryRuntimeDigest(DiscoveryRuntimeSource.parse(source));
export const requestScopeDigest = (input: {
  scopeId: string;
  parameters: Record<string, string>;
  windowStart: string;
  windowEnd: string;
}) => discoveryRuntimeDigest(input);
const contextSchema = z
  .object({
    operationId: DiscoveryId.refine(
      (value) => value !== 'operation:unresolved',
      'reserved unresolved operation identity',
    ),
    capabilityToken: z.string().min(1).max(2048),
  })
  .strict();
const snapshot = <T>(value: T): T => JSON.parse(canonical(value)) as T;
const capabilitySchema = z
  .object({
    receiptId: DiscoveryId,
    principalId: DiscoveryId,
    authenticationContextId: DiscoveryId,
    minimalAuditRetention: z.literal('allow'),
    action: z.enum([
      'enroll',
      'qualify',
      'activate',
      'deactivate',
      'sample',
      'lease',
      'issue',
    ]),
    targetId: DiscoveryId,
    operationId: DiscoveryId,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: DiscoveryInstant,
  })
  .strict();
const refEq = (
  a: { id: string; revision: number },
  b: { id: string; revision: number },
) => a.id === b.id && a.revision === b.revision;
type SourceRow = {
  payload_json: string;
  configuration_sha256: string;
  scope_sha256: string;
  active: number;
  generation: number;
  qualification_id: string | null;
};
type PlanRow = { payload_json: string };
type AttemptRow = {
  id: string;
  plan_id: string;
  state: string;
  max_bytes: number;
  received_bytes: number | null;
  body_sha256: string | null;
  finish_sha256: string | null;
};

export function createDiscoverySourceRegistry(
  db: D1DatabaseLike,
  options: {
    resolveCapability: DiscoveryRegistryCapabilityResolver;
    now?: () => string;
    resolveContinuation?: (
      receiptId: string,
    ) => Promise<DiscoveryContinuationReceipt | null>;
  },
) {
  const sql = (query: string, values: unknown[] = []): D1StatementLike =>
    db.prepare(query).bind(...values);
  const now = () =>
    DiscoveryInstant.parse(options.now?.() ?? new Date().toISOString());
  const fail = (
    outcome: ConstructorParameters<typeof DiscoveryRuntimeError>[0],
    code: string,
  ): never => {
    throw new DiscoveryRuntimeError(outcome, code);
  };
  const instant = (s: string) => DiscoveryInstant.parse(s);
  const assertions = (id: string, query: string, values: unknown[] = []) =>
    sql(
      `INSERT INTO discovery_source_assertions SELECT ?,CASE WHEN (${query}) THEN 1 ELSE 0 END`,
      [id, ...values],
    );
  function mapError(error: unknown): never {
    if (error instanceof DiscoveryRuntimeError) throw error;
    const message = error instanceof Error ? error.message : '';
    if (/budget|CHECK constraint|sampling.*requests/i.test(message))
      return fail('budget-exhausted', 'discovery-source-budget-exhausted');
    if (/lease|deadline/.test(message))
      return fail('timed-out', 'discovery-source-lease-or-deadline');
    if (/activation|qualification/.test(message))
      return fail('disabled', 'discovery-source-activation-denied');
    if (/control|permission|expired|stale/.test(message))
      return fail(
        'permission-denied',
        'discovery-source-current-binding-denied',
      );
    return fail('unavailable', 'discovery-source-transaction-rejected');
  }
  async function source(
    id: string,
  ): Promise<SourceRow & { value: DiscoveryRuntimeSource }> {
    DiscoveryId.parse(id);
    const row = await sql(
      'SELECT s.*,h.active,h.generation,h.qualification_id FROM discovery_source_revisions s JOIN discovery_source_heads h ON h.source_id=s.source_id AND h.revision=s.revision WHERE s.source_id=?',
      [id],
    ).first<SourceRow>();
    if (!row) return fail('disabled', 'discovery-source-not-enrolled');
    return {
      ...row,
      value: DiscoveryRuntimeSource.parse(JSON.parse(row.payload_json)),
    };
  }
  async function plan(id: string): Promise<DiscoveryIssuedPlan> {
    DiscoveryId.parse(id);
    const row = await sql(
      'SELECT payload_json FROM discovery_source_plans WHERE id=?',
      [id],
    ).first<PlanRow>();
    if (!row) return fail('unavailable', 'discovery-source-plan-missing');
    return JSON.parse(row.payload_json) as DiscoveryIssuedPlan;
  }
  async function assertIntegrity(
    s: DiscoveryRuntimeSource,
    qualificationId?: string,
  ) {
    const reader = createDiscoveryEvidenceStore(db, {
      resolveCapability: async () => {
        throw new Error('read only');
      },
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
    ).map((kind) => ({ kind, ...s[kind] }));
    const controls = await Promise.all([
      ...refs.map((ref) => reader.readRevision(ref.kind, ref.id, ref.revision)),
      reader.readRevision(
        'policy',
        s.accessDecision.id,
        s.accessDecision.revision,
      ),
      reader.readRevision(
        'policy',
        s.displayRights.id,
        s.displayRights.revision,
      ),
    ]);
    if (controls.some((control) => !control?.usable))
      return fail('permission-denied', 'discovery-source-control-integrity');
    if (qualificationId) {
      const row = await sql(
        'SELECT payload_json FROM discovery_source_qualifications WHERE id=?',
        [qualificationId],
      ).first<{ payload_json: string }>();
      if (!row)
        return fail('disabled', 'discovery-source-qualification-missing');
      const qualification = DiscoverySourceQualification.parse(
        JSON.parse(row.payload_json),
      );
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
        return fail('permission-denied', 'discovery-source-sample-integrity');
    }
  }
  function guard(
    id: string,
    p: DiscoveryIssuedPlan,
    planId: string | null = p.id,
  ): D1StatementLike {
    return sql('INSERT INTO discovery_source_guards VALUES(?,?,?,?,?,?,?,?)', [
      id,
      p.source.id,
      p.source.revision,
      p.request.purpose,
      p.request.purpose === 'collection' ? p.request.qualification.id : null,
      p.request.purpose === 'qualification-sample'
        ? p.request.samplingAuthorization.id
        : null,
      planId,
      now(),
    ]);
  }
  function sourceGuard(
    id: string,
    s: DiscoveryRuntimeSource,
    purpose = 'control',
    qualificationId: string | null = null,
    samplingId: string | null = null,
  ) {
    return sql(
      'INSERT INTO discovery_source_guards VALUES(?,?,?,?,?,?,NULL,?)',
      [id, s.id, s.revision, purpose, qualificationId, samplingId, now()],
    );
  }
  const clearGuard = (id: string) =>
    sql('DELETE FROM discovery_source_guards WHERE id=?', [id]);
  async function authorized<T>(
    ctxRaw: DiscoveryRegistryContext,
    action: DiscoveryRegistryAction,
    targetId: string,
    input: unknown,
    build: (
      operationId: string,
    ) => Promise<{ statements: D1StatementLike[]; result: T }>,
  ): Promise<T> {
    const ctx = contextSchema.parse(snapshot(ctxRaw));
    DiscoveryId.parse(targetId);
    const digest = await discoveryRuntimeDigest({ action, targetId, input });
    const requested = {
      action,
      targetId,
      operationId: ctx.operationId,
      requestSha256: digest,
    };
    const cap = capabilitySchema.parse(
      snapshot(
        await options.resolveCapability(ctx.capabilityToken, { ...requested }),
      ),
    );
    if (
      !cap ||
      cap.action !== action ||
      cap.targetId !== targetId ||
      cap.operationId !== ctx.operationId ||
      cap.requestSha256 !== digest ||
      cap.minimalAuditRetention !== 'allow' ||
      !DiscoveryId.safeParse(cap.principalId).success ||
      !DiscoveryId.safeParse(cap.authenticationContextId).success ||
      !DiscoveryId.safeParse(cap.receiptId).success ||
      !DiscoveryInstant.safeParse(cap.expiresAt).success ||
      Date.parse(cap.expiresAt) <= Date.parse(now())
    )
      return fail('permission-denied', 'discovery-source-capability-denied');
    const previous = await sql(
      'SELECT request_sha256,result_json FROM discovery_source_operations WHERE operation_id=?',
      [ctx.operationId],
    ).first<{ request_sha256: string; result_json: string }>();
    if (previous) {
      if (previous.request_sha256 !== digest)
        return fail('unavailable', 'discovery-source-operation-conflict');
      const result = JSON.parse(previous.result_json);
      return (action === 'issue' ? await plan(result.id) : result) as T;
    }
    try {
      if (action === 'enroll')
        await assertIntegrity(input as DiscoveryRuntimeSource);
      if (['qualify', 'activate', 'sample', 'issue'].includes(action)) {
        const current = (await source(targetId)).value;
        const binding = input as { qualificationId?: string };
        await assertIntegrity(current, binding.qualificationId);
      }
      const built = await build(ctx.operationId);
      await db.batch([
        assertions(
          `${ctx.operationId}:cap`,
          "julianday(?)>max(julianday('now'),julianday(?))",
          [cap.expiresAt, now()],
        ),
        ...built.statements,
        assertions(
          `${ctx.operationId}:cap-final`,
          "julianday(?)>max(julianday('now'),julianday(?))",
          [cap.expiresAt, now()],
        ),
        sql('INSERT INTO discovery_source_operations VALUES(?,?,?,?)', [
          ctx.operationId,
          digest,
          canonical(
            action === 'issue'
              ? { id: (built.result as DiscoveryIssuedPlan).id }
              : built.result,
          ),
          canonical(cap),
        ]),
      ]);
      return built.result;
    } catch (error) {
      const raced = await sql(
        'SELECT request_sha256,result_json FROM discovery_source_operations WHERE operation_id=?',
        [ctx.operationId],
      ).first<{ request_sha256: string; result_json: string }>();
      if (raced?.request_sha256 === digest) {
        const result = JSON.parse(raced.result_json);
        return (action === 'issue' ? await plan(result.id) : result) as T;
      }
      await sql(
        'INSERT INTO discovery_source_rejections VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
        [
          ctx.operationId,
          targetId,
          error instanceof DiscoveryRuntimeError
            ? error.code
            : 'discovery-source-transaction-rejected',
          now(),
        ],
      ).run();
      return mapError(error);
    }
  }
  const ack = (operationId: string, id: string) => ({
    committed: true as const,
    operationId,
    id,
  });
  async function enroll(
    ctx: DiscoveryRegistryContext,
    raw: DiscoveryRuntimeSource,
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const s = DiscoveryRuntimeSource.parse(snapshot(raw));
    if (
      (await discoveryEndpointTemplateDigest(s.endpointTemplate)) !==
      s.materialScope.endpointTemplateSha256
    )
      return fail('misconfigured', 'discovery-source-template-digest');
    const digest = await sourceConfigurationDigest(s),
      scope = await discoveryRuntimeDigest(s.materialScope);
    return authorized(ctx, 'enroll', s.id, s, async (op) => ({
      result: ack(op, s.id),
      statements: [
        assertions(
          op,
          'coalesce((SELECT revision FROM discovery_source_heads WHERE source_id=?),0)=?',
          [s.id, s.revision - 1],
        ),
        sql('INSERT INTO discovery_source_revisions VALUES(?,?,?,?,?)', [
          s.id,
          s.revision,
          canonical(s),
          digest,
          scope,
        ]),
        sql(
          'INSERT INTO discovery_source_heads VALUES(?,?,0,0,NULL) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,active=0,generation=generation+1,qualification_id=NULL',
          [s.id, s.revision],
        ),
        sql(
          'INSERT INTO discovery_source_budgets(id,payload_json) VALUES(?,?) ON CONFLICT DO NOTHING',
          [s.budget.id, canonical(s.budget)],
        ),
        assertions(
          `${op}:budget`,
          '(SELECT payload_json FROM discovery_source_budgets WHERE id=?)=?',
          [s.budget.id, canonical(s.budget)],
        ),
        sourceGuard(`${op}:source`, s),
        clearGuard(`${op}:source`),
      ],
    }));
  }
  async function qualify(
    ctx: DiscoveryRegistryContext,
    raw: DiscoverySourceQualification,
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const q = DiscoverySourceQualification.parse(snapshot(raw)),
      s = (await source(q.sourceId)).value;
    return authorized(ctx, 'qualify', q.sourceId, q, async (op) => {
      if (
        q.sourceRevision !== s.revision ||
        q.installation !== s.installation ||
        q.configurationSha256 !== (await sourceConfigurationDigest(s)) ||
        !refEq(q.parser, s.parser) ||
        !refEq(q.permission, s.permission) ||
        !refEq(q.rights, s.rights) ||
        !refEq(q.accessDecision, s.accessDecision) ||
        !refEq(q.displayRights, s.displayRights) ||
        q.engineeringOwnerId !== s.engineeringOwnerId ||
        q.editorialOwnerId !== s.editorialOwnerId ||
        Date.parse(q.reviewedAt) > Date.parse(now()) ||
        Date.parse(q.expiresAt) <= Date.parse(now()) ||
        Date.parse(q.expiresAt) <= Date.parse(q.reviewedAt)
      )
        return fail('disabled', 'discovery-source-qualification-binding');
      const reader = createDiscoveryEvidenceStore(db, {
        resolveCapability: async () => {
          throw new Error('read only');
        },
        now,
      });
      const sampleAssertions: D1StatementLike[] = [];
      for (const sample of q.samples) {
        const retained = await reader.readRevision(
          'representation',
          sample.representation.id,
          sample.representation.revision,
        );
        const c = retained?.content as
          | {
              originalBytesSha256?: string;
              actualEndpoint?: string;
              materialScope?: unknown;
              parser?: { id: string; revision: number };
              configuration?: { id: string; revision: number };
            }
          | undefined;
        if (
          !retained?.usable ||
          !c ||
          c.originalBytesSha256 !== sample.representationSha256 ||
          c.actualEndpoint !== sample.endpoint ||
          canonical(c.materialScope) !== canonical(s.materialScope) ||
          !c.parser ||
          !refEq(c.parser, s.parser) ||
          !c.configuration ||
          !refEq(c.configuration, s.configuration)
        )
          return fail('disabled', 'discovery-source-qualification-sample');
        sampleAssertions.push(
          assertions(
            `${op}:sample:${sample.representation.id}`,
            "EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind='representation' AND c.id=? AND c.revision=? AND json_extract(c.payload_json,'$.originalBytesSha256')=? AND NOT EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=c.kind AND t.id=c.id AND t.revision=c.revision) AND NOT EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=c.kind AND t.id=c.id AND t.revision=c.revision))",
            [
              sample.representation.id,
              sample.representation.revision,
              sample.representationSha256,
            ],
          ),
        );
      }
      return {
        result: ack(op, q.id),
        statements: [
          sql('INSERT INTO discovery_source_qualifications VALUES(?,?,?,?,?)', [
            q.id,
            q.sourceId,
            q.sourceRevision,
            canonical(q),
            q.expiresAt,
          ]),
          sourceGuard(op, s, 'control', q.id),
          ...sampleAssertions,
          clearGuard(op),
        ],
      };
    });
  }
  async function activate(
    ctx: DiscoveryRegistryContext,
    input: {
      sourceId: string;
      sourceRevision: number;
      qualificationId: string;
    },
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    input = z
      .object({
        sourceId: DiscoveryId,
        sourceRevision: z.number().int().positive().safe(),
        qualificationId: DiscoveryId,
      })
      .strict()
      .parse(snapshot(input));
    const s = (await source(input.sourceId)).value;
    return authorized(ctx, 'activate', input.sourceId, input, async (op) => ({
      result: ack(op, input.sourceId),
      statements: [
        assertions(
          op,
          'EXISTS(SELECT 1 FROM discovery_source_qualifications WHERE id=? AND source_id=? AND source_revision=?) AND (SELECT revision FROM discovery_source_heads WHERE source_id=?)=?',
          [
            input.qualificationId,
            input.sourceId,
            input.sourceRevision,
            input.sourceId,
            input.sourceRevision,
          ],
        ),
        sql(
          'UPDATE discovery_source_heads SET active=1,generation=generation+1,qualification_id=? WHERE source_id=?',
          [input.qualificationId, input.sourceId],
        ),
        sourceGuard(`${op}:active`, s, 'collection', input.qualificationId),
        clearGuard(`${op}:active`),
      ],
    }));
  }
  async function deactivate(
    ctx: DiscoveryRegistryContext,
    input: { sourceId: string; expectedGeneration: number; reasonCode: string },
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    input = z
      .object({
        sourceId: DiscoveryId,
        expectedGeneration: z.number().int().nonnegative().safe(),
        reasonCode: DiscoveryId,
      })
      .strict()
      .parse(snapshot(input));
    return authorized(ctx, 'deactivate', input.sourceId, input, async (op) => ({
      result: ack(op, input.sourceId),
      statements: [
        assertions(
          op,
          '(SELECT generation FROM discovery_source_heads WHERE source_id=?)=?',
          [input.sourceId, input.expectedGeneration],
        ),
        sql(
          'UPDATE discovery_source_heads SET active=0,generation=generation+1 WHERE source_id=?',
          [input.sourceId],
        ),
      ],
    }));
  }
  async function authorizeSampling(
    ctx: DiscoveryRegistryContext,
    raw: DiscoverySamplingGrant,
  ) {
    ctx = contextSchema.parse(snapshot(ctx));
    const g = DiscoverySamplingGrant.parse(snapshot(raw)),
      s = (await source(g.sourceId)).value;
    return authorized(ctx, 'sample', g.sourceId, g, async (op) => ({
      result: ack(op, g.id),
      statements: [
        assertions(
          op,
          "?>? AND julianday(?)>max(julianday('now'),julianday(?))",
          [g.sourceRevision, g.sourceRevision - 1, g.expiresAt, now()],
        ),
        sourceGuard(`${op}:source`, { ...s, revision: g.sourceRevision }),
        sql(
          'INSERT INTO discovery_source_sampling(id,source_id,source_revision,max_requests,expires_at) VALUES(?,?,?,?,?)',
          [g.id, g.sourceId, g.sourceRevision, g.maxRequests, g.expiresAt],
        ),
        clearGuard(`${op}:source`),
      ],
    }));
  }
  async function acquireLease(
    ctx: DiscoveryRegistryContext,
    input: {
      id: string;
      sourceId: string;
      owner: string;
      expectedFence: number;
      expiresAt: string;
    },
  ): Promise<DiscoveryLease> {
    ctx = contextSchema.parse(snapshot(ctx));
    input = z
      .object({
        id: DiscoveryId,
        sourceId: DiscoveryId,
        owner: DiscoveryId,
        expectedFence: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - 1),
        expiresAt: DiscoveryInstant,
      })
      .strict()
      .parse(snapshot(input));
    return authorized(ctx, 'lease', input.sourceId, input, async (op) => ({
      result: {
        id: input.id,
        sourceId: input.sourceId,
        owner: input.owner,
        fence: input.expectedFence + 1,
        expiresAt: input.expiresAt,
      },
      statements: [
        assertions(
          op,
          "coalesce((SELECT fence FROM discovery_source_leases WHERE id=?),0)=? AND julianday(?)>max(julianday('now'),julianday(?)) AND NOT EXISTS(SELECT 1 FROM discovery_source_leases WHERE id=? AND owner<>? AND julianday(expires_at)>max(julianday('now'),julianday(?)))",
          [
            input.id,
            input.expectedFence,
            input.expiresAt,
            now(),
            input.id,
            input.owner,
            now(),
          ],
        ),
        sql(
          'INSERT INTO discovery_source_leases VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,expires_at=excluded.expires_at WHERE source_id=excluded.source_id',
          [
            input.id,
            input.sourceId,
            input.owner,
            input.expectedFence + 1,
            input.expiresAt,
          ],
        ),
        assertions(
          `${op}:lease`,
          'EXISTS(SELECT 1 FROM discovery_source_leases WHERE id=? AND source_id=? AND fence=? AND owner=?)',
          [input.id, input.sourceId, input.expectedFence + 1, input.owner],
        ),
      ],
    }));
  }
  async function issue(
    ctx: DiscoveryRegistryContext,
    input: DiscoveryIssueInput,
  ): Promise<DiscoveryIssuedPlan> {
    ctx = contextSchema.parse(snapshot(ctx));
    input = z
      .object({
        id: DiscoveryId,
        sourceId: DiscoveryId,
        sourceRevision: z.number().int().positive().safe(),
        runId: DiscoveryId,
        purpose: z.enum(['collection', 'qualification-sample']),
        qualificationId: DiscoveryId.optional(),
        samplingGrantId: DiscoveryId.optional(),
        parameters: z
          .record(z.string().min(1).max(64), z.string().max(512))
          .refine((v) => Object.keys(v).length <= 20),
        checkpoint: z.string().max(4096).nullable(),
        continuation: z
          .object({
            parentReceiptId: DiscoveryId,
            sourceId: DiscoveryId,
            installation: DiscoveryId,
            scopeId: DiscoveryId,
            sourceRevision: z.number().int().positive().safe(),
            querySha256: z.string().regex(/^[a-f0-9]{64}$/),
            tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
            expiresAt: DiscoveryInstant,
          })
          .strict()
          .optional(),
        lease: z
          .object({
            id: DiscoveryId,
            owner: DiscoveryId,
            fence: z.number().int().positive().safe(),
          })
          .strict(),
        deadlineAt: DiscoveryInstant,
      })
      .strict()
      .parse(snapshot(input));
    const srow = await source(input.sourceId),
      s = srow.value;
    return authorized(ctx, 'issue', input.sourceId, input, async (op) => {
      DiscoveryId.parse(input.id);
      DiscoveryId.parse(input.runId);
      instant(input.deadlineAt);
      if (
        input.sourceRevision !== s.revision ||
        Date.parse(input.deadlineAt) <= Date.parse(now()) ||
        Date.parse(input.deadlineAt) - Date.parse(now()) >
          s.budget.maxWallTimeMs
      )
        return fail('timed-out', 'discovery-source-issued-deadline');
      if (
        input.purpose === 'collection'
          ? Boolean(input.samplingGrantId) || !input.qualificationId
          : Boolean(input.qualificationId) || !input.samplingGrantId
      )
        return fail('misconfigured', 'discovery-source-purpose-binding');
      const nonpage = { ...input.parameters };
      if (s.endpointTemplate.pageParameter)
        delete nonpage[s.endpointTemplate.pageParameter];
      if (
        (await requestScopeDigest({
          scopeId: s.scopeId,
          parameters: nonpage,
          windowStart: s.budget.windowStart,
          windowEnd: s.budget.windowEnd,
        })) !== s.materialScope.requestScopeSha256
      )
        return fail('permission-denied', 'discovery-source-query-scope');
      let parentCaptureId: string | undefined;
      if (input.continuation) {
        if (!options.resolveContinuation)
          return fail(
            'permission-denied',
            'discovery-source-page-resolver-unavailable',
          );
        const raw = await options.resolveContinuation(
          input.continuation.parentReceiptId,
        );
        if (!raw)
          return fail(
            'permission-denied',
            'discovery-source-continuation-uncommitted',
          );
        const resolved = z
          .object({
            parentReceiptId: DiscoveryId,
            sourceId: DiscoveryId,
            installation: DiscoveryId,
            scopeId: DiscoveryId,
            sourceRevision: z.number().int().positive().safe(),
            querySha256: z.string().regex(/^[a-f0-9]{64}$/),
            tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
            expiresAt: DiscoveryInstant,
            parentCaptureOperationId: DiscoveryId,
            parentPlanId: DiscoveryId,
            representation: z
              .object({
                id: DiscoveryId,
                revision: z.number().int().positive().safe(),
              })
              .strict(),
            representationSha256: z.string().regex(/^[a-f0-9]{64}$/),
            nextCheckpoint: z.string().min(1).max(512),
          })
          .strict()
          .parse(snapshot(raw));
        const previous = await sql(
          'SELECT c.plan_id,c.representation_id,c.representation_revision FROM discovery_source_captures c WHERE c.operation_id=? AND c.settled=1',
          [resolved.parentCaptureOperationId],
        ).first<{
          plan_id: string;
          representation_id: string;
          representation_revision: number;
        }>();
        if (!previous)
          return fail(
            'permission-denied',
            'discovery-source-continuation-uncommitted',
          );
        const reader = createDiscoveryEvidenceStore(db, {
          resolveCapability: async () => {
            throw new Error('read only');
          },
          now,
        });
        const retained = await reader.readRevision(
          'representation',
          previous.representation_id,
          previous.representation_revision,
        );
        if (
          !retained?.usable ||
          !retained.content ||
          previous.plan_id !== resolved.parentPlanId ||
          previous.representation_id !== resolved.representation.id ||
          previous.representation_revision !==
            resolved.representation.revision ||
          (retained.content as { originalBytesSha256: string })
            .originalBytesSha256 !== resolved.representationSha256
        )
          return fail(
            'permission-denied',
            'discovery-source-continuation-unusable',
          );
        const parent = await plan(previous.plan_id),
          c = input.continuation;
        const {
          parentCaptureOperationId: unusedCapture,
          parentPlanId: unusedPlan,
          representation: unusedRep,
          representationSha256: unusedHash,
          nextCheckpoint: unusedNext,
          ...descriptor
        } = resolved;
        void unusedCapture;
        void unusedPlan;
        void unusedRep;
        void unusedHash;
        void unusedNext;
        if (
          canonical(descriptor) !== canonical(c) ||
          parent.source.id !== s.id ||
          parent.source.revision !== s.revision ||
          c.sourceId !== s.id ||
          c.installation !== s.installation ||
          c.scopeId !== s.scopeId ||
          c.sourceRevision !== s.revision ||
          c.querySha256 !== s.materialScope.requestScopeSha256 ||
          Date.parse(c.expiresAt) <= Date.parse(now()) ||
          input.checkpoint !== resolved.nextCheckpoint ||
          (await discoveryTokenDigest(resolved.nextCheckpoint)) !==
            c.tokenSha256
        )
          return fail(
            'permission-denied',
            'discovery-source-continuation-binding',
          );
        parentCaptureId = resolved.parentCaptureOperationId;
      } else if (input.checkpoint !== null)
        return fail(
          'permission-denied',
          'discovery-source-continuation-required',
        );
      else if (s.endpointTemplate.pageParameter) {
        const page = input.parameters[s.endpointTemplate.pageParameter],
          rule =
            s.endpointTemplate.parameters[s.endpointTemplate.pageParameter];
        if (
          page !== undefined &&
          page !== (rule.kind === 'integer' ? String(rule.min) : '*')
        )
          return fail('permission-denied', 'discovery-source-initial-page');
      }
      const endpoint = await constructDiscoveryEndpoint(
        s.endpointTemplate,
        Object.entries(input.parameters),
        input.continuation,
        now(),
      );
      const lease = await sql(
        'SELECT id,source_id,owner,fence,expires_at FROM discovery_source_leases WHERE id=?',
        [input.lease.id],
      ).first<{
        id: string;
        source_id: string;
        owner: string;
        fence: number;
        expires_at: string;
      }>();
      if (
        !lease ||
        lease.source_id !== s.id ||
        lease.owner !== input.lease.owner ||
        lease.fence !== input.lease.fence
      )
        return fail('timed-out', 'discovery-source-issued-lease');
      const request = DiscoverySourceRequest.parse({
        schemaVersion: 'discovery-v1',
        operationId: op,
        runId: input.runId,
        sourceId: s.id,
        provider: s.provider,
        installation: s.installation,
        scopeId: s.scopeId,
        enrollment: s.enrollment,
        configuration: s.configuration,
        permission: s.permission,
        parser: s.parser,
        endpointConstructor: s.endpointTemplate.id,
        parameters: input.parameters,
        checkpoint: input.checkpoint,
        budgetReservation: { id: input.id, revision: 1 },
        leaseFence: { id: lease.id, revision: lease.fence },
        purpose: input.purpose,
        ...(input.purpose === 'collection'
          ? { qualification: { id: input.qualificationId, revision: 1 } }
          : {
              samplingAuthorization: { id: input.samplingGrantId, revision: 1 },
            }),
      });
      const token = crypto.randomUUID();
      const result: DiscoveryIssuedPlan = {
        id: input.id,
        source: s,
        request,
        endpoint,
        requestSha256: await discoveryRuntimeDigest(request),
        configurationSha256: srow.configuration_sha256,
        activationGeneration: srow.generation,
        deadlineAt: input.deadlineAt,
        retainedThrough: s.expiresAt,
        maxResponseBytes: s.budget.maxResponseBytes,
        maxItems: Math.min(100, s.budget.maxItems),
        lease: {
          id: lease.id,
          sourceId: lease.source_id,
          owner: lease.owner,
          fence: lease.fence,
          expiresAt: lease.expires_at,
        },
        originMemberId: `member:${input.id}`,
        requestBindingToken: token,
        ...(input.continuation
          ? {
              continuation: input.continuation,
              continuationParentCaptureId: parentCaptureId,
            }
          : {}),
      };
      const { requestBindingToken: _secret, ...durablePlan } = result;
      void _secret;
      return {
        result,
        statements: [
          sql(
            'INSERT INTO discovery_source_plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
              result.id,
              s.id,
              s.revision,
              input.purpose,
              input.qualificationId ?? null,
              input.samplingGrantId ?? null,
              srow.generation,
              lease.id,
              lease.owner,
              lease.fence,
              endpoint,
              result.requestSha256,
              await discoveryRuntimeDigest(token),
              result.deadlineAt,
              canonical(durablePlan),
            ],
          ),
          guard(op, result),
          clearGuard(op),
        ],
      };
    });
  }
  async function resolvePlan(id: string) {
    const p = await plan(id),
      key = `check:${crypto.randomUUID()}`;
    await assertIntegrity(
      p.source,
      p.request.purpose === 'collection'
        ? p.request.qualification.id
        : undefined,
    );
    try {
      await db.batch([guard(key, p), clearGuard(key)]);
    } catch (e) {
      return mapError(e);
    }
    return p;
  }
  async function resolvePlanIdentity(id: string) {
    if (!DiscoveryId.safeParse(id).success) return null;
    const rows = await sql(
      `SELECT operation_id, request_sha256, authority_json
       FROM discovery_source_operations
       WHERE json_extract(result_json, '$.id') = ?
         AND json_extract(authority_json, '$.action') = 'issue'
       LIMIT 2`,
      [id],
    ).all<{
      operation_id: string;
      request_sha256: string;
      authority_json: string;
    }>();
    if (!Array.isArray(rows.results))
      return fail('unavailable', 'discovery-source-identity-unavailable');
    if (rows.results.length !== 1) return null;
    const row = rows.results[0];
    const audit = capabilitySchema.safeParse(JSON.parse(row.authority_json));
    if (
      !audit.success ||
      audit.data.action !== 'issue' ||
      audit.data.operationId !== row.operation_id ||
      audit.data.requestSha256 !== row.request_sha256
    )
      return fail('unavailable', 'discovery-source-identity-audit-invalid');
    // Historical expiry restricts new action, not the explicitly permitted
    // minimal audit record. This survives removal of the source-bearing plan.
    return {
      sourceId: audit.data.targetId,
      operationId: audit.data.operationId,
    };
  }
  async function reserveAttempt(input: {
    planId: string;
    attemptId: string;
    endpoint: string;
    ordinal: number;
    hop: number;
  }) {
    input = z
      .object({
        planId: DiscoveryId,
        attemptId: DiscoveryId,
        endpoint: z.string().max(2048),
        ordinal: z.number().int().min(0).max(100),
        hop: z.number().int().min(0).max(5),
      })
      .strict()
      .parse(snapshot(input));
    const p = await plan(input.planId),
      s = p.source;
    await assertIntegrity(
      s,
      p.request.purpose === 'collection'
        ? p.request.qualification.id
        : undefined,
    );
    if (input.endpoint !== p.endpoint)
      return fail('permission-denied', 'discovery-source-attempt-endpoint');
    if (
      await sql('SELECT id FROM discovery_source_attempts WHERE id=?', [
        input.attemptId,
      ]).first()
    )
      return fail('unavailable', 'discovery-source-attempt-already-dispatched');
    const backoff = await sql(
      'SELECT next_attempt_at FROM discovery_source_backoff WHERE source_id=?',
      [s.id],
    ).first<{ next_attempt_at: string }>();
    if (backoff && Date.parse(backoff.next_attempt_at) > Date.parse(now()))
      throw new DiscoveryRuntimeError(
        'rate-limited',
        'discovery-source-backoff',
        backoff.next_attempt_at,
      );
    const key = `attempt:${input.attemptId}`;
    const budgetBefore = await readBudget(s.budget.id);
    const reservedItems = Math.min(
      p.maxItems,
      s.budget.maxItems - budgetBefore.items,
    );
    if (reservedItems < 1)
      return fail('budget-exhausted', 'discovery-source-item-budget');
    try {
      await db.batch([
        guard(key, p),
        assertions(
          `${key}:backoff`,
          "NOT EXISTS(SELECT 1 FROM discovery_source_backoff WHERE source_id=? AND julianday(next_attempt_at)>max(julianday('now'),julianday(?)))",
          [s.id, now()],
        ),
        assertions(
          `${key}:window`,
          "julianday(?)<=max(julianday('now'),julianday(?)) AND julianday(?)>max(julianday('now'),julianday(?))",
          [s.budget.windowStart, now(), s.budget.windowEnd, now()],
        ),
        assertions(`${key}:items`, '?>0', [s.budget.maxItems]),
        sql(
          'UPDATE discovery_source_budgets SET requests=requests+1,reserved_bytes=reserved_bytes+?,pages=pages+1,items=items+? WHERE id=?',
          [p.maxResponseBytes, reservedItems, s.budget.id],
        ),
        ...(p.request.purpose === 'qualification-sample'
          ? [
              sql(
                'UPDATE discovery_source_sampling SET requests=requests+1 WHERE id=?',
                [p.request.samplingAuthorization.id],
              ),
            ]
          : []),
        sql(
          "INSERT INTO discovery_source_attempts(id,plan_id,ordinal,hop,state,max_bytes,max_items) VALUES(?,?,?,?,'dispatched',?,?)",
          [
            input.attemptId,
            p.id,
            input.ordinal,
            input.hop,
            p.maxResponseBytes,
            reservedItems,
          ],
        ),
        clearGuard(key),
      ]);
    } catch (e) {
      return mapError(e);
    }
    return {
      attemptId: input.attemptId,
      plan: p,
      request: p.request,
      maxResponseBytes: p.maxResponseBytes,
      deadlineAt: p.deadlineAt,
    };
  }
  async function finishAttempt(input: DiscoveryAttemptFinish) {
    const finish = z
      .object({
        attemptId: DiscoveryId,
        outcome: z.enum([
          'received',
          'disabled',
          'misconfigured',
          'auth-failed',
          'rate-limited',
          'upstream-failed',
          'parser-failed',
          'timed-out',
          'unavailable',
          'permission-denied',
          'budget-exhausted',
        ]),
        receivedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        httpStatus: z.number().int().min(100).max(599).optional(),
        responseLink: z.string().max(4096).nullable().optional(),
        retryAfter: DiscoveryInstant.nullable().optional(),
        code: z
          .string()
          .regex(/^[a-z0-9:-]{1,200}$/)
          .optional(),
        representationSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    const a = await sql('SELECT * FROM discovery_source_attempts WHERE id=?', [
      finish.attemptId,
    ]).first<AttemptRow>();
    if (!a) return fail('unavailable', 'discovery-source-attempt-missing');
    const digest = await discoveryRuntimeDigest(finish);
    if (a.finish_sha256) {
      if (a.finish_sha256 !== digest)
        return fail('unavailable', 'discovery-source-finish-conflict');
      return;
    }
    const p = await plan(a.plan_id);
    if (
      finish.outcome === 'received' &&
      (!finish.representationSha256 ||
        finish.receivedBytes > a.max_bytes ||
        finish.receivedBytes < 1 ||
        !finish.httpStatus ||
        finish.httpStatus < 200 ||
        finish.httpStatus > 299 ||
        Date.parse(p.deadlineAt) <= Date.parse(now()))
    )
      return fail('timed-out', 'discovery-source-received-body-invalid');
    const statements = [
      sql(
        "UPDATE discovery_source_attempts SET state=?,received_bytes=?,body_sha256=?,outcome=?,http_status=?,finish_sha256=? WHERE id=? AND state='dispatched' AND finish_sha256 IS NULL",
        [
          finish.outcome === 'received' ? 'received' : 'finished',
          finish.receivedBytes,
          finish.representationSha256 ?? null,
          finish.outcome,
          finish.httpStatus ?? null,
          digest,
          finish.attemptId,
        ],
      ),
      assertions(
        `finish:${finish.attemptId}`,
        '(SELECT finish_sha256 FROM discovery_source_attempts WHERE id=?)=?',
        [finish.attemptId, digest],
      ),
    ];
    if (finish.outcome !== 'received') {
      const prior = await sql(
        'SELECT failures FROM discovery_source_backoff WHERE source_id=?',
        [p.source.id],
      ).first<{ failures: number }>();
      const failures = Math.min(30, (prior?.failures ?? 0) + 1),
        until =
          finish.retryAfter ??
          new Date(
            Date.parse(now()) +
              Math.min(86400000, 60000 * 2 ** Math.min(failures - 1, 10)),
          ).toISOString();
      statements.push(
        sql(
          'INSERT INTO discovery_source_backoff VALUES(?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET next_attempt_at=CASE WHEN julianday(excluded.next_attempt_at)>julianday(next_attempt_at) THEN excluded.next_attempt_at ELSE next_attempt_at END,failures=min(30,failures+1),last_code=excluded.last_code',
          [
            p.source.id,
            until,
            failures,
            finish.code ?? 'discovery-source-attempt-failed',
          ],
        ),
      );
    }
    try {
      await db.batch(statements);
    } catch (e) {
      return mapError(e);
    }
  }
  const resolveIssuedSourceRequest: DiscoverySourceRegistry['resolveIssuedSourceRequest'] =
    async (token, binding) => {
      binding = z
        .object({
          operationId: DiscoveryId,
          targetId: DiscoveryId,
          action: z.enum(['issue-request', 'origin', 'capture']),
          mutationRequestSha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(snapshot(binding));
      if (typeof token !== 'string' || token.length > 2048) return null;
      const row = await sql(
        'SELECT payload_json FROM discovery_source_plans WHERE binding_token_sha256=?',
        [await discoveryRuntimeDigest(token)],
      ).first<PlanRow>();
      if (!row) return null;
      const p = await resolvePlan(
        (JSON.parse(row.payload_json) as DiscoveryIssuedPlan).id,
      );
      return {
        issuedRequest: { id: p.id, revision: 1 },
        requestSha256: p.requestSha256,
        materialScope: p.source.materialScope,
        actualEndpoint: p.endpoint,
        originMemberId: p.originMemberId,
        permission: p.source.permission,
        rights: p.source.rights,
        expiresAt: p.retainedThrough,
        ...binding,
      };
    };
  async function composeCaptureGuard(input: DiscoveryCaptureGuardInput) {
    input = snapshot(input);
    const r = DiscoveryRepresentationInput.parse(input.representation);
    if (
      r.materialScope.kind !== 'source-response' ||
      !r.issuedRequest ||
      r.issuedRequest.revision !== 1
    )
      return fail('permission-denied', 'discovery-source-capture-request');
    const p = await plan(r.issuedRequest.id),
      op = input.context.operationId;
    await assertIntegrity(
      p.source,
      p.request.purpose === 'collection'
        ? p.request.qualification.id
        : undefined,
    );
    if (
      r.requestSha256 !== p.requestSha256 ||
      r.actualEndpoint !== p.endpoint ||
      r.originMemberId !== `member:${p.id}` ||
      canonical(r.materialScope) !== canonical(p.source.materialScope)
    )
      return fail('permission-denied', 'discovery-source-capture-binding');
    const attempt = await sql(
      "SELECT * FROM discovery_source_attempts WHERE plan_id=? AND state='received' AND body_sha256=? AND received_bytes=? ORDER BY ordinal DESC,hop DESC LIMIT 1",
      [p.id, input.bytesSha256, input.byteLength],
    ).first<AttemptRow>();
    if (!attempt)
      return fail('permission-denied', 'discovery-source-capture-unreceived');
    return {
      before: [
        guard(op, p),
        sql(
          'INSERT INTO discovery_source_captures(operation_id,plan_id,attempt_id,representation_id,representation_revision,byte_length,body_sha256) VALUES(?,?,?,?,?,?,?)',
          [
            op,
            p.id,
            attempt.id,
            r.id,
            r.revision,
            input.byteLength,
            input.bytesSha256,
          ],
        ),
      ],
      after: [
        sql(
          'UPDATE discovery_source_captures SET settled=1 WHERE operation_id=?',
          [op],
        ),
        sql(
          'UPDATE discovery_source_budgets SET reserved_bytes=reserved_bytes-?,retained_bytes=retained_bytes+? WHERE id=?',
          [attempt.max_bytes, input.byteLength, p.source.budget.id],
        ),
        assertions(
          `${op}:settled`,
          'EXISTS(SELECT 1 FROM discovery_source_captures WHERE operation_id=? AND settled=1)',
          [op],
        ),
        clearGuard(op),
      ],
    };
  }
  async function readBudget(id: string) {
    const row = await sql(
      'SELECT requests,reserved_bytes AS reservedBytes,retained_bytes AS retainedBytes,pages,items FROM discovery_source_budgets WHERE id=?',
      [DiscoveryId.parse(id)],
    ).first<{
      requests: number;
      reservedBytes: number;
      retainedBytes: number;
      pages: number;
      items: number;
    }>();
    if (!row) return fail('unavailable', 'discovery-source-budget-missing');
    return row;
  }
  function createEvidenceStore(evidenceOptions: {
    resolveCapability: DiscoveryCapabilityResolver;
    now?: () => string;
  }) {
    return createDiscoveryEvidenceStore(db, {
      resolveCapability: evidenceOptions.resolveCapability,
      now,
      resolveIssuedSourceRequest,
      composeCaptureGuard,
    });
  }
  async function resolveRetainedRepresentation(ref: {
    id: string;
    revision: number;
  }): Promise<DiscoveryTrustedAdapterRepresentation | null> {
    ref = z
      .object({ id: DiscoveryId, revision: z.number().int().positive().safe() })
      .strict()
      .parse(snapshot(ref));
    const capture = await sql(
      'SELECT c.plan_id,a.max_items FROM discovery_source_captures c JOIN discovery_source_attempts a ON a.id=c.attempt_id WHERE c.representation_id=? AND c.representation_revision=? AND c.settled=1',
      [ref.id, ref.revision],
    ).first<{ plan_id: string; max_items: number }>();
    if (!capture) return null;
    const stored = await createDiscoveryEvidenceStore(db, {
      resolveCapability: async () => {
        throw new Error('read only');
      },
      now,
    }).readRevision('representation', ref.id, ref.revision);
    if (!stored?.usable || !stored.content) return null;
    const retained = stored.content as {
      bytes: number[];
      originalBytesSha256: string;
    };
    const issued = await plan(capture.plan_id);
    return {
      ...ref,
      bytes: new Uint8Array(retained.bytes),
      representationSha256: retained.originalBytesSha256,
      request: issued.request,
      remainingItems: capture.max_items,
    };
  }
  const internal = {
    enroll,
    qualify,
    activate,
    deactivate,
    authorizeSampling,
    acquireLease,
    issue,
    resolvePlan,
    resolvePlanIdentity,
    reserveAttempt,
    finishAttempt,
    resolveIssuedSourceRequest,
    composeCaptureGuard,
    readBudget,
  } satisfies DiscoverySourceRegistry;
  function createTransport(
    transportOptions: Omit<
      Parameters<typeof createDiscoveryTransport>[0],
      'registry'
    >,
  ) {
    return createDiscoveryTransport({
      ...transportOptions,
      registry: internal,
    });
  }
  // Dispatch completion is a closure owned by transport, not a management API.
  return {
    enroll,
    qualify,
    activate,
    deactivate,
    authorizeSampling,
    acquireLease,
    issue,
    resolvePlan,
    resolveIssuedSourceRequest,
    composeCaptureGuard,
    readBudget,
    createEvidenceStore,
    createTransport,
    resolveRetainedRepresentation,
  };
}
