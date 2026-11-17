import { z } from 'zod';
import {
  DISCOVERY_SCHEMA_VERSION,
  DiscoveryId,
  RevisionRef,
  DiscoveryInstant,
} from '../content/discovery-schema';
import {
  DiscoveryIssuedSourceRequest,
  DiscoveryForumSupportSnapshot,
  DiscoveryForumEditInput,
  type DiscoveryForumSupportResolver,
  type DiscoverySourceChangeGuard,
  DISCOVERY_EVIDENCE_READ_LIMITS,
  type DiscoveryIssuedSourceRequestResolver,
  DiscoveryEvidenceControl,
  DiscoveryOrigin,
  DiscoveryRepresentationInput,
  DiscoveryEvidenceInput,
  DiscoveryClaimInput,
  DiscoveryDecisionInput,
  DiscoveryMutationContext,
  DiscoveryEvidenceDependency,
  DISCOVERY_NORMALIZER_VERSION,
  DISCOVERY_PARSER_VERSION,
  type DiscoveryEvidenceKind,
  type DiscoveryCapabilityAction,
  type DiscoveryCapabilityResolver,
  type DiscoveryEvidenceAck,
  type DiscoveryStoredRevision,
  type DiscoveryVerifiedCapability,
} from '../content/discovery-evidence';
import type { D1DatabaseLike, D1StatementLike } from './persistence';

export class DiscoveryEvidenceConflict extends Error {
  readonly code = 'discovery-evidence-conflict';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscoveryEvidenceConflict';
  }
}

// Accept actual JSON only; do not silently turn NaN into null, discard undefined,
// invoke getters, or accept inherited/prototype properties as structured evidence.
export function canonicalDiscoveryEvidenceJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string' || typeof v === 'boolean')
      return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || seen.has(v))
      throw new DiscoveryEvidenceConflict('discovery-evidence-non-json');
    seen.add(v);
    let result: string;
    if (Array.isArray(v)) {
      const descriptors = Object.getOwnPropertyDescriptors(v);
      const keys = Object.getOwnPropertyNames(v);
      if (
        Object.getPrototypeOf(v) !== Array.prototype ||
        Object.getOwnPropertySymbols(v).length ||
        keys.length !== v.length + 1 ||
        Object.values(descriptors).some((d) => !('value' in d))
      )
        throw new DiscoveryEvidenceConflict('discovery-evidence-non-json');
      const items: string[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = descriptors[String(i)];
        if (!d || !('value' in d))
          throw new DiscoveryEvidenceConflict('discovery-evidence-sparse-json');
        items.push(visit(d.value));
      }
      result = `[${items.join(',')}]`;
    } else {
      if (
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new DiscoveryEvidenceConflict('discovery-evidence-non-json');
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (
        Object.getOwnPropertySymbols(v).length ||
        Object.values(descriptors).some((d) => !('value' in d))
      )
        throw new DiscoveryEvidenceConflict('discovery-evidence-non-json');
      result = `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${visit(descriptors[k].value)}`)
        .join(',')}}`;
    }
    seen.delete(v);
    return result;
  }
  const result = visit(value);
  if (new TextEncoder().encode(result).byteLength > 262144)
    throw new DiscoveryEvidenceConflict('discovery-evidence-size-bound');
  return result;
}

// Validate duplicate raw JSON keys before using native JSON.parse results.
// Structured values parse the original UTF-8 text, before NFC text normalization.
function rejectDuplicateJsonKeys(text: string): void {
  const tokens =
    text.match(
      /"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    ) ?? [];
  function decimalValue(token: string): string {
    const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(
      token,
    )!;
    let coefficient = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
    if (!coefficient) return '0';
    if ((match[4] ?? '0').length > 8)
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-unsupported-json-number',
      );
    let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
    const trailing = coefficient.length - coefficient.replace(/0+$/, '').length;
    coefficient = coefficient.slice(0, coefficient.length - trailing);
    exponent += BigInt(trailing);
    return `${match[1]}${coefficient}e${exponent}`;
  }
  for (const token of tokens)
    if (/^-?[0-9]/.test(token)) {
      const number = Number(token);
      if (
        !Number.isFinite(number) ||
        decimalValue(token) !== decimalValue(JSON.stringify(number))
      )
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-unsupported-json-number',
        );
    }
  let position = 0;
  function walk(depth: number): void {
    if (depth > 64)
      throw new DiscoveryEvidenceConflict('discovery-evidence-json-depth');
    const token = tokens[position++];
    if (token === '{') {
      const names = new Set<string>();
      if (tokens[position] === '}') {
        position++;
        return;
      }
      while (position < tokens.length) {
        const key = JSON.parse(tokens[position++]) as string;
        if (names.has(key))
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-duplicate-json-key',
          );
        names.add(key);
        position++; // colon; native JSON.parse already validated grammar.
        walk(depth + 1);
        if (tokens[position++] === '}') return;
      }
    } else if (token === '[') {
      if (tokens[position] === ']') {
        position++;
        return;
      }
      while (position < tokens.length) {
        walk(depth + 1);
        if (tokens[position++] === ']') return;
      }
    }
  }
  walk(0);
}

async function sha(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
async function hash(value: unknown): Promise<string> {
  return sha(new TextEncoder().encode(canonicalDiscoveryEvidenceJson(value)));
}
const snapshot = (value: unknown): unknown =>
  JSON.parse(canonicalDiscoveryEvidenceJson(value));
const dependency = (
  kind: DiscoveryEvidenceKind,
  ref: { id: string; revision: number },
) => ({ kind, ...ref });
// A trusted runtime may join its issuance/lease/budget predicates to a capture.
// These are prepared statements from the same database, never request-body SQL.
// This extends the evidence revision transaction; it does not acknowledge a page.
export type DiscoveryEvidenceCaptureGuard = (input: {
  context: DiscoveryMutationContext;
  representation: z.infer<typeof DiscoveryRepresentationInput>;
  byteLength: number;
  bytesSha256: string;
}) => Promise<{ before: D1StatementLike[]; after: D1StatementLike[] }>;
const pending =
  'NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=?)';
const retained = z
  .object({
    schemaVersion: z
      .literal(DISCOVERY_SCHEMA_VERSION)
      .default(DISCOVERY_SCHEMA_VERSION),
    id: DiscoveryId,
    revision: RevisionRef.shape.revision,
    representation: RevisionRef,
    observedAt: DiscoveryInstant,
  })
  .strict();
const capabilitySchema = z
  .object({
    receiptId: DiscoveryId,
    principalId: DiscoveryId,
    authenticationContextId: DiscoveryId,
    action: z.enum([
      'issue-request',
      'control',
      'origin',
      'capture',
      'evidence',
      'claim',
      'decision',
      'private-note',
      'refresh-failure',
      'revoke',
      'invalidate-source-support',
    ]),
    targetId: DiscoveryId,
    operationId: DiscoveryId,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: DiscoveryInstant,
    minimalAuditRetention: z.literal('allow'),
  })
  .strict();
type Context = z.output<typeof DiscoveryMutationContext>;
type Ref = z.infer<typeof DiscoveryEvidenceDependency>;
type Build = {
  content: unknown;
  refs?: Ref[];
  expectedHeads?: Ref[];
  plan?: Record<string, unknown>;
  expiresAt?: string;
  scopeKey?: string;
  extra?: (operationId: string) => D1StatementLike[];
  captureComposition?: { before: D1StatementLike[]; after: D1StatementLike[] };
};

export function createDiscoveryEvidenceStore(
  db: D1DatabaseLike,
  options: {
    resolveCapability: DiscoveryCapabilityResolver;
    resolveIssuedSourceRequest?: DiscoveryIssuedSourceRequestResolver;
    composeCaptureGuard?: DiscoveryEvidenceCaptureGuard;
    resolveForumSupport?: DiscoveryForumSupportResolver;
    composeSourceChangeGuard?: DiscoverySourceChangeGuard;
    now?: () => string;
  },
) {
  const sql = (query: string, values: unknown[] = []): D1StatementLike =>
    db.prepare(query).bind(...values);
  const now = () =>
    DiscoveryInstant.parse(options.now?.() ?? new Date().toISOString());
  const content = async (
    kind: DiscoveryEvidenceKind,
    ref: { id: string; revision: number },
  ) => {
    const row = await readRevision(kind, ref.id, ref.revision);
    if (!row || !row.usable || row.content === null)
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-unusable-reference',
      );
    return row.content as Record<string, unknown>;
  };
  async function readRevision(
    kind: DiscoveryEvidenceKind,
    id: string,
    revision: number,
  ): Promise<DiscoveryStoredRevision | null> {
    DiscoveryEvidenceDependency.parse({ kind, id, revision });
    const rows =
      (
        await sql(
          `WITH RECURSIVE ancestors(kind,id,revision) AS (
      SELECT kind,id,revision FROM discovery_evidence_revisions WHERE kind=? AND id=? AND revision=?
      UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN ancestors a ON e.dependent_kind=a.kind AND e.dependent_id=a.id AND e.dependent_revision=a.revision
      LIMIT 513
    ), bounded AS (
      SELECT a.kind,a.id,a.revision,x.content_sha256,c.payload_json,
       EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) AS ancestor_tombstoned
       FROM ancestors a JOIN discovery_evidence_revisions x USING(kind,id,revision) LEFT JOIN discovery_evidence_contents c USING(kind,id,revision) LIMIT 513
    ), bounds AS (
      SELECT count(*) AS ancestor_count,coalesce(sum(length(CAST(payload_json AS BLOB))),0) AS ancestor_bytes FROM bounded
    ), qualified AS (
      SELECT b.* FROM bounded b CROSS JOIN bounds s WHERE s.ancestor_count<=512 AND s.ancestor_bytes<=4194304
    ) SELECT r.content_sha256 AS target_sha256,c.payload_json IS NOT NULL AS target_content_present,s.ancestor_count,s.ancestor_bytes,
      EXISTS(SELECT 1 FROM ancestors a JOIN discovery_evidence_revisions x USING(kind,id,revision) WHERE x.expires_at IS NOT NULL AND julianday(x.expires_at)<=max(julianday('now'),julianday(?))) AS expired,
      EXISTS(SELECT 1 FROM ancestors a WHERE
       NOT EXISTS(SELECT 1 FROM discovery_evidence_contents x WHERE x.kind=a.kind AND x.id=a.id AND x.revision=a.revision) OR
       EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) OR
       EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=a.kind AND i.id=a.id AND i.revision=a.revision) OR
       (a.kind IN ('rights','permission','enrollment') AND (SELECT h.revision FROM discovery_evidence_heads h WHERE h.kind=a.kind AND h.id=a.id) IS NOT a.revision)
      ) AS unusable,
      EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=r.kind AND t.id=r.id AND t.revision=r.revision) AS tombstoned,
      EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=r.kind AND i.id=r.id AND i.revision=r.revision) AS invalidated,
      q.kind AS ancestor_kind,q.id AS ancestor_id,q.revision AS ancestor_revision,q.content_sha256,q.payload_json,q.ancestor_tombstoned
      FROM discovery_evidence_revisions r LEFT JOIN discovery_evidence_contents c USING(kind,id,revision) CROSS JOIN bounds s LEFT JOIN qualified q ON 1=1
      WHERE r.kind=? AND r.id=? AND r.revision=?`,
          [kind, id, revision, now(), kind, id, revision],
        ).all<{
          target_sha256: string;
          target_content_present: number;
          ancestor_count: number;
          ancestor_bytes: number;
          expired: number;
          unusable: number;
          tombstoned: number;
          invalidated: number;
          ancestor_kind: DiscoveryEvidenceKind | null;
          ancestor_id: string | null;
          ancestor_revision: number | null;
          content_sha256: string;
          payload_json: string | null;
          ancestor_tombstoned: number;
        }>()
      ).results ?? [];
    if (!rows.length) return null;
    const row = rows[0];
    if (
      row.ancestor_count > DISCOVERY_EVIDENCE_READ_LIMITS.maxAncestors ||
      row.ancestor_bytes >
        DISCOVERY_EVIDENCE_READ_LIMITS.maxAncestorContentBytes
    )
      throw new DiscoveryEvidenceConflict('discovery-evidence-ancestor-bound');
    let parsedContent: unknown = null;
    let quarantined = false;
    for (const observed of rows) {
      if (!observed.ancestor_kind) continue;
      const entry = {
        kind: observed.ancestor_kind,
        id: observed.ancestor_id,
        revision: observed.ancestor_revision,
        content_sha256: observed.content_sha256,
        payload_json: observed.payload_json,
      };
      if (entry.payload_json === null) {
        if (!observed.ancestor_tombstoned) quarantined = true;
        continue;
      }
      let verifiedContent: unknown = null;
      let corrupted = false;
      if (entry.payload_json !== null) {
        try {
          verifiedContent = JSON.parse(entry.payload_json);
          corrupted = (await hash(verifiedContent)) !== entry.content_sha256;
          if (entry.kind === 'representation' && !corrupted) {
            const rep = verifiedContent as Record<string, unknown>;
            if (
              !Array.isArray(rep.bytes) ||
              rep.bytes.length === 0 ||
              rep.bytes.length > 48000 ||
              !rep.bytes.every(
                (v) =>
                  typeof v === 'number' &&
                  Number.isInteger(v) &&
                  v >= 0 &&
                  v <= 255,
              ) ||
              rep.normalizerVersion !== DISCOVERY_NORMALIZER_VERSION ||
              rep.parserVersion !== DISCOVERY_PARSER_VERSION
            )
              corrupted = true;
            else {
              const originalBytes = new Uint8Array(rep.bytes as number[]);
              const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
                originalBytes,
              );
              const normalized = decoded
                .replace(/\r\n?/g, '\n')
                .normalize('NFC');
              corrupted =
                (await sha(originalBytes)) !== rep.originalBytesSha256 ||
                typeof rep.normalizedText !== 'string' ||
                normalized !== rep.normalizedText ||
                (await sha(new TextEncoder().encode(normalized))) !==
                  rep.normalizedTextSha256;
              if (rep.format === 'json') {
                rejectDuplicateJsonKeys(decoded);
                corrupted =
                  corrupted || !same(JSON.parse(decoded), rep.structured);
              } else if (rep.format !== 'text') corrupted = true;
            }
          }
        } catch {
          corrupted = true;
        }
      }
      if (entry.kind === kind && entry.id === id && entry.revision === revision)
        parsedContent = verifiedContent;
      quarantined = quarantined || corrupted;
    }
    return {
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      kind,
      id,
      revision,
      contentSha256: row.target_sha256,
      tombstoned: !!row.tombstoned,
      invalidated: !!row.invalidated,
      expired: !!row.expired,
      quarantined,
      usable:
        !quarantined &&
        !row.expired &&
        !row.unusable &&
        !!row.target_content_present &&
        parsedContent !== null,
      content:
        !row.target_content_present || row.expired || quarantined
          ? null
          : parsedContent,
    };
  }
  async function ack(operationId: string): Promise<DiscoveryEvidenceAck> {
    const row = await sql(
      'SELECT * FROM discovery_evidence_operations WHERE operation_id=?',
      [operationId],
    ).first<{
      kind: DiscoveryEvidenceKind;
      id: string;
      revision: number;
      content_sha256: string;
    }>();
    if (!row)
      throw new DiscoveryEvidenceConflict('discovery-evidence-missing-ack');
    const state = await readRevision(row.kind, row.id, row.revision);
    return {
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      committed: true,
      operationId,
      kind: row.kind,
      id: row.id,
      revision: row.revision,
      contentSha256: row.content_sha256,
      tombstoned: state?.tombstoned ?? true,
      usable: state?.usable ?? false,
      expired: state?.expired ?? false,
      quarantined: state?.quarantined ?? false,
    };
  }
  async function mutate(
    kind: DiscoveryEvidenceKind,
    action: DiscoveryCapabilityAction,
    rawContext: DiscoveryMutationContext,
    input: { id: string; revision: number },
    build: (
      ctx: Context,
      authority: DiscoveryVerifiedCapability,
    ) => Promise<Build>,
  ): Promise<DiscoveryEvidenceAck> {
    const ctx = DiscoveryMutationContext.parse(rawContext);
    const requestSha256 = await hash({
      schemaVersion: ctx.schemaVersion,
      kind,
      expectedRevision: ctx.expectedRevision,
      expectedHeads: ctx.expectedHeads,
      input,
    });
    const request = {
      action,
      targetId: input.id,
      operationId: ctx.operationId,
      requestSha256,
    };
    const cap = capabilitySchema.parse(
      await options.resolveCapability(ctx.capabilityToken, request),
    );
    const capabilitySha256 = await hash(cap);
    const checkedAt = now();
    if (
      cap.action !== action ||
      cap.targetId !== input.id ||
      cap.operationId !== ctx.operationId ||
      cap.requestSha256 !== requestSha256 ||
      Date.parse(cap.expiresAt) <= Date.parse(checkedAt)
    )
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-capability-denied',
      );
    const previous = await sql(
      'SELECT request_sha256 FROM discovery_evidence_operations WHERE operation_id=?',
      [ctx.operationId],
    ).first<{ request_sha256: string }>();
    if (previous) {
      if (previous.request_sha256 !== requestSha256)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-operation-conflict',
        );
      return ack(ctx.operationId);
    }
    if (input.revision !== (ctx.expectedRevision ?? 0) + 1)
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-nonsequential-revision',
      );
    const built = await build(ctx, cap);
    const uniqueHeads = new Map<string, number>();
    for (const ref of [...ctx.expectedHeads, ...(built.expectedHeads ?? [])]) {
      const key = `${ref.kind}:${ref.id}`;
      if (uniqueHeads.has(key) && uniqueHeads.get(key) !== ref.revision)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-contradictory-heads',
        );
      uniqueHeads.set(key, ref.revision);
    }
    const payload = canonicalDiscoveryEvidenceJson(built.content);
    const contentSha256 = await sha(new TextEncoder().encode(payload));
    const refs = [...(built.refs ?? [])];
    for (const ref of refs) {
      if (kind === 'revocation' && ref.kind === 'rights') continue;
      const state = await readRevision(ref.kind, ref.id, ref.revision);
      if (!state?.usable)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-unusable-reference',
        );
    }
    const expectedHeads = [
      ...ctx.expectedHeads,
      ...(built.expectedHeads ?? []),
    ];
    if (refs.length > 512 || expectedHeads.length > 512)
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-dependency-bound',
      );
    const plan = canonicalDiscoveryEvidenceJson({
      action,
      refs,
      expectedHeads,
      binding: payload,
      capabilitySha256,
      scopeKey: built.scopeKey ?? null,
      ...built.plan,
    });
    try {
      await db.batch([
        sql('INSERT INTO discovery_evidence_guards VALUES(?,?,?,?,?,?,?,?,?)', [
          ctx.operationId,
          requestSha256,
          kind,
          input.id,
          ctx.expectedRevision,
          input.revision,
          plan,
          canonicalDiscoveryEvidenceJson(cap),
          checkedAt,
        ]),
        ...(built.captureComposition?.before ?? []),
        sql(
          `INSERT INTO discovery_evidence_revisions SELECT ?,?,?,?,?,? WHERE ${pending}`,
          [
            kind,
            input.id,
            input.revision,
            contentSha256,
            built.expiresAt ?? null,
            built.scopeKey ?? null,
            ctx.operationId,
          ],
        ),
        sql(
          `INSERT INTO discovery_evidence_contents SELECT ?,?,?,? WHERE ${pending}`,
          [kind, input.id, input.revision, payload, ctx.operationId],
        ),
        ...refs.map((r) =>
          sql(
            `INSERT INTO discovery_evidence_edges SELECT ?,?,?,?,?,? WHERE ${pending} ON CONFLICT DO NOTHING`,
            [
              r.kind,
              r.id,
              r.revision,
              kind,
              input.id,
              input.revision,
              ctx.operationId,
            ],
          ),
        ),
        ...(built.extra?.(ctx.operationId) ?? []),
        sql(
          `INSERT INTO discovery_evidence_heads SELECT ?,?,? WHERE ${pending} ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision`,
          [kind, input.id, input.revision, ctx.operationId],
        ),
        sql(
          `INSERT INTO discovery_evidence_operations SELECT ?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${pending}`,
          [
            ctx.operationId,
            requestSha256,
            kind,
            input.id,
            input.revision,
            contentSha256,
            cap.receiptId,
            capabilitySha256,
            cap.principalId,
            cap.authenticationContextId,
            cap.action,
            ctx.operationId,
          ],
        ),
        ...(built.captureComposition?.after ?? []),
        sql('DELETE FROM discovery_evidence_guards WHERE operation_id=?', [
          ctx.operationId,
        ]),
      ]);
    } catch (error) {
      throw new DiscoveryEvidenceConflict(
        error instanceof Error
          ? error.message
          : 'discovery-evidence-transaction-failed',
        { cause: error },
      );
    }
    return ack(ctx.operationId);
  }

  async function appendControl(ctx: DiscoveryMutationContext, raw: unknown) {
    const v = DiscoveryEvidenceControl.parse(snapshot(raw));
    if (v.kind === 'rights' && (!v.rights?.retain || !v.rights.transform))
      throw new DiscoveryEvidenceConflict('discovery-evidence-use-revocation');
    const scope = v.permission?.materialScope ?? v.rights?.materialScope;
    const sourceRefs: Ref[] =
      scope?.kind === 'source-response'
        ? [
            dependency('enrollment', scope.enrollment),
            dependency('configuration', scope.configuration),
          ]
        : [];
    const grantRefs: Ref[] = v.permission
      ? [
          dependency('enrollment', v.permission.enrollment),
          dependency('configuration', v.permission.configuration),
        ]
      : [];
    return mutate(v.kind, 'control', ctx, v, async () => ({
      content: v,
      expiresAt: v.expiresAt,
      scopeKey: scope ? await hash(scope) : undefined,
      refs: [...sourceRefs, ...grantRefs].filter(
        (r, i, a) =>
          a.findIndex(
            (x) =>
              canonicalDiscoveryEvidenceJson(x) ===
              canonicalDiscoveryEvidenceJson(r),
          ) === i,
      ),
      expectedHeads: [...sourceRefs, ...grantRefs],
    }));
  }
  function unpackToken(raw: unknown): {
    body: Record<string, unknown>;
    token: string | undefined;
  } {
    const value = snapshot(raw) as Record<string, unknown>;
    const { requestBindingToken, ...body } = value;
    if (
      requestBindingToken !== undefined &&
      (typeof requestBindingToken !== 'string' ||
        !requestBindingToken ||
        requestBindingToken.length > 2048)
    )
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-issued-token-invalid',
      );
    return { body, token: requestBindingToken as string | undefined };
  }
  async function verifiedIssued(
    token: string | undefined,
    ctx: Context,
    cap: DiscoveryVerifiedCapability,
    action: 'issue-request' | 'origin' | 'capture',
  ) {
    if (!token || !options.resolveIssuedSourceRequest)
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-issued-resolver-required',
      );
    const binding = {
      operationId: ctx.operationId,
      targetId: cap.targetId,
      action,
      mutationRequestSha256: cap.requestSha256,
    };
    const resolved = snapshot(
      await options.resolveIssuedSourceRequest(token, binding),
    );
    const schema = DiscoveryIssuedSourceRequest.omit({
      id: true,
      revision: true,
      schemaVersion: true,
    })
      .extend({
        issuedRequest: RevisionRef,
        operationId: DiscoveryId,
        targetId: DiscoveryId,
        action: z.enum(['issue-request', 'origin', 'capture']),
        mutationRequestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict();
    const result = schema.parse(resolved);
    if (
      result.operationId !== binding.operationId ||
      result.targetId !== binding.targetId ||
      result.action !== action ||
      result.mutationRequestSha256 !== binding.mutationRequestSha256
    )
      throw new DiscoveryEvidenceConflict(
        'discovery-evidence-issued-mutation-mismatch',
      );
    const {
      issuedRequest,
      operationId: unusedOp,
      targetId: unusedTarget,
      action: unusedAction,
      mutationRequestSha256: unusedDigest,
      ...stable
    } = result;
    void unusedOp;
    void unusedTarget;
    void unusedAction;
    void unusedDigest;
    return DiscoveryIssuedSourceRequest.parse({ ...stable, ...issuedRequest });
  }
  function same(left: unknown, right: unknown): boolean {
    return (
      canonicalDiscoveryEvidenceJson(left) ===
      canonicalDiscoveryEvidenceJson(right)
    );
  }
  async function appendIssuedSourceRequest(
    ctx: DiscoveryMutationContext,
    raw: unknown,
  ) {
    const { body, token } = unpackToken(raw);
    const v = DiscoveryIssuedSourceRequest.parse(body);
    return mutate(
      'issued-request',
      'issue-request',
      ctx,
      v,
      async (parsed, cap) => {
        const issued = await verifiedIssued(
          token,
          parsed,
          cap,
          'issue-request',
        );
        if (!same(v, issued))
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-issued-binding-mismatch',
          );
        const scope = v.materialScope;
        const refs = [
          dependency('rights', v.rights),
          dependency('permission', v.permission),
          dependency('enrollment', scope.enrollment),
          dependency('configuration', scope.configuration),
        ];
        return {
          content: v,
          refs,
          expectedHeads: refs,
          expiresAt: v.expiresAt,
          scopeKey: await hash(scope),
          plan: {
            rights: v.rights,
            permission: v.permission,
            enrollment: scope.enrollment,
            configuration: scope.configuration,
            scopeKey: await hash(scope),
            materialScope: scope,
            materialScopeJson: canonicalDiscoveryEvidenceJson(scope),
            verifiedIssuedBinding: canonicalDiscoveryEvidenceJson(issued),
          },
        };
      },
    );
  }
  const affected = `WITH RECURSIVE affected(kind,id,revision) AS (
    SELECT source_kind,source_id,source_revision FROM discovery_evidence_edges WHERE source_kind=? AND source_id=? AND source_revision=?
    UNION SELECT e.dependent_kind,e.dependent_id,e.dependent_revision FROM discovery_evidence_edges e JOIN affected a ON e.source_kind=a.kind AND e.source_id=a.id AND e.source_revision=a.revision
  )`;
  async function appendOrigin(ctx: DiscoveryMutationContext, raw: unknown) {
    const { body, token } = unpackToken(raw);
    const v = DiscoveryOrigin.parse(body);
    return mutate('origin', 'origin', ctx, v, async (parsed, cap) => {
      const issued =
        v.status === 'provisional-source-response'
          ? await verifiedIssued(token, parsed, cap, 'origin')
          : null;
      if (
        issued &&
        v.status === 'provisional-source-response' &&
        (!same(v.issuedRequest, { id: issued.id, revision: issued.revision }) ||
          v.requestSha256 !== issued.requestSha256 ||
          !same(v.materialScope, issued.materialScope) ||
          v.members.length !== 1 ||
          v.members[0] !== issued.originMemberId ||
          v.memberEndpoints[issued.originMemberId] !== issued.actualEndpoint ||
          !v.retentionRights.some((r) => same(r, issued.rights)))
      )
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-issued-origin-mismatch',
        );
      const issuedRefs = issued
        ? [
            dependency('issued-request', {
              id: issued.id,
              revision: issued.revision,
            }),
          ]
        : [];
      return {
        content: v,
        refs: [
          dependency('policy', v.policy),
          ...v.retentionRights.map((r) => dependency('rights', r)),
          ...issuedRefs,
        ],
        expectedHeads: [
          dependency('policy', v.policy),
          ...v.retentionRights.map((r) => dependency('rights', r)),
          ...issuedRefs,
        ],
        plan: issued
          ? {
              issuedRequest: { id: issued.id, revision: issued.revision },
              issuedBinding: canonicalDiscoveryEvidenceJson(issued),
            }
          : {},
        extra: (op) => [
          // Origin revisions are adjudicated complete replacement sets. Existing work
          // keys cannot be split into two live origins through different mirrors.
          sql(
            `DELETE FROM discovery_evidence_origin_members WHERE origin_id=? AND ${pending}`,
            [v.id, op],
          ),
          ...v.members.map((member) =>
            sql(
              `INSERT INTO discovery_evidence_origin_members SELECT ?,?,?,? WHERE ${pending}`,
              [member, v.id, v.revision, v.originalWorkId, op],
            ),
          ),
          ...(parsed.expectedRevision === null
            ? []
            : [
                sql(
                  `${affected} INSERT INTO discovery_evidence_invalidations SELECT kind,id,revision,? FROM affected a WHERE kind<>'origin' AND NOT EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=a.kind AND i.id=a.id AND i.revision=a.revision) AND ${pending}`,
                  ['origin', v.id, parsed.expectedRevision, op, op],
                ),
                sql(
                  `UPDATE discovery_evidence_state SET invalidation_epoch=invalidation_epoch+1 WHERE ${pending}`,
                  [op],
                ),
              ]),
        ],
      };
    });
  }
  async function appendRepresentation(
    ctx: DiscoveryMutationContext,
    raw: z.input<typeof DiscoveryRepresentationInput> & {
      bytes: Uint8Array;
      requestBindingToken?: string;
    },
  ) {
    if (
      !(raw.bytes instanceof Uint8Array) ||
      raw.bytes.byteLength === 0 ||
      raw.bytes.byteLength > 48000
    )
      throw new DiscoveryEvidenceConflict('discovery-evidence-byte-bound');
    const { bytes: sourceBytes, requestBindingToken, ...rest } = raw;
    const bytes = new Uint8Array(sourceBytes);
    const v = DiscoveryRepresentationInput.parse(snapshot(rest));
    const input = { ...v, bytes: Array.from(bytes) };
    return mutate(
      'representation',
      'capture',
      ctx,
      input,
      async (parsed, cap) => {
        const scope = v.materialScope;
        const issued =
          scope.kind === 'source-response'
            ? await verifiedIssued(requestBindingToken, parsed, cap, 'capture')
            : null;
        if (
          issued &&
          (!same(v.issuedRequest, {
            id: issued.id,
            revision: issued.revision,
          }) ||
            v.requestSha256 !== issued.requestSha256 ||
            !same(scope, issued.materialScope) ||
            v.actualEndpoint !== issued.actualEndpoint ||
            v.originMemberId !== issued.originMemberId ||
            !same(v.permission, issued.permission) ||
            !same(v.rights, issued.rights))
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-issued-capture-mismatch',
          );
        if (
          scope.kind === 'artifact' &&
          (v.issuedRequest !== undefined ||
            v.requestSha256 !== undefined ||
            requestBindingToken !== undefined)
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-artifact-request-mismatch',
          );
        const parser = await content('parser', v.parser),
          normalizer = await content('normalizer', v.normalizer);
        const origin = (await content(
          'origin',
          v.origin,
        )) as unknown as DiscoveryOrigin;
        const originRights = await Promise.all(
          origin.retentionRights.map((r) => content('rights', r)),
        );
        if (
          !originRights.some((r) => {
            const owner = (r as unknown as DiscoveryEvidenceControl).rights;
            return owner && same(owner.materialScope, scope);
          })
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-origin-rights-mismatch',
          );
        if (
          (scope.kind === 'artifact' &&
            origin.status !== 'reviewed-original-work') ||
          (scope.kind === 'source-response' &&
            (origin.status !== 'provisional-source-response' ||
              !same(origin.issuedRequest, v.issuedRequest) ||
              origin.requestSha256 !== v.requestSha256 ||
              !same(origin.materialScope, scope)))
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-provenance-scope-mismatch',
          );
        if (
          origin.retired ||
          origin.memberEndpoints[v.originMemberId] !== v.actualEndpoint
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-origin-member-mismatch',
          );
        if (
          parser.value !== DISCOVERY_PARSER_VERSION ||
          normalizer.value !== DISCOVERY_NORMALIZER_VERSION
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-unsupported-transform',
          );
        let text: string;
        let decoded: string;
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          text = decoded.replace(/\r\n?/g, '\n').normalize('NFC');
        } catch {
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-invalid-utf8',
          );
        }
        let structured: unknown;
        if (v.format === 'json') {
          try {
            structured = JSON.parse(decoded!);
          } catch {
            throw new DiscoveryEvidenceConflict(
              'discovery-evidence-invalid-json',
            );
          }
          rejectDuplicateJsonKeys(decoded!);
        }
        const bytesDigest = await sha(bytes);
        const earlier = await sql(
          "SELECT c.payload_json FROM discovery_evidence_contents c WHERE c.kind='representation' AND c.id=? ORDER BY c.revision DESC LIMIT 1",
          [v.id],
        ).first<{ payload_json: string }>();
        if (
          earlier &&
          JSON.parse(earlier.payload_json).originalBytesSha256 === bytesDigest
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-use-observation',
          );
        const refs: Ref[] = (
          [
            'enrollment',
            'configuration',
            'permission',
            'rights',
            'origin',
            'parser',
            'normalizer',
          ] as const
        ).map((k) => dependency(k, v[k]));
        if (issued)
          refs.push(
            dependency('issued-request', {
              id: issued.id,
              revision: issued.revision,
            }),
          );
        const composed =
          issued && options.composeCaptureGuard
            ? await options.composeCaptureGuard({
                context: snapshot(parsed) as DiscoveryMutationContext,
                representation: DiscoveryRepresentationInput.parse(snapshot(v)),
                byteLength: bytes.byteLength,
                bytesSha256: bytesDigest,
              })
            : undefined;
        return {
          ...(composed
            ? {
                captureComposition: {
                  before: [...composed.before],
                  after: [...composed.after],
                },
              }
            : {}),
          content: {
            ...v,
            bytes: Array.from(bytes),
            originalBytesSha256: bytesDigest,
            normalizedText: text,
            normalizedTextSha256: await sha(new TextEncoder().encode(text)),
            normalizerVersion: DISCOVERY_NORMALIZER_VERSION,
            parserVersion: DISCOVERY_PARSER_VERSION,
            storageLocation: `d1:${v.id}:${v.revision}`,
            ...(v.format === 'json' ? { structured } : {}),
          },
          refs,
          expectedHeads: refs,
          scopeKey: await hash(scope),
          plan: {
            rights: v.rights,
            permission: v.permission,
            enrollment: v.enrollment,
            configuration: v.configuration,
            materialScope: scope,
            materialScopeJson: canonicalDiscoveryEvidenceJson(scope),
            scopeKey: await hash(scope),
            ...(issued
              ? {
                  issuedRequest: { id: issued.id, revision: issued.revision },
                  issuedBinding: canonicalDiscoveryEvidenceJson(issued),
                }
              : {}),
            origin: v.origin,
            originMemberId: v.originMemberId,
            actualEndpoint: v.actualEndpoint,
          },
        };
      },
    );
  }
  async function observeRepresentation(
    ctx: DiscoveryMutationContext,
    raw: unknown,
  ) {
    const v = retained.parse(snapshot(raw));
    return mutate('observation', 'capture', ctx, v, async () => ({
      content: v,
      refs: [dependency('representation', v.representation)],
    }));
  }
  function pointerValue(root: unknown, pointer: string): unknown {
    if (pointer === '') return root;
    if (!pointer.startsWith('/'))
      throw new DiscoveryEvidenceConflict('discovery-evidence-invalid-pointer');
    let value: unknown = root;
    for (const part of pointer.slice(1).split('/')) {
      if (/~(?:[^01]|$)/.test(part))
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-invalid-pointer',
        );
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (
        value === null ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, key) ||
        (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-invalid-pointer',
        );
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }
  function boundary(text: string, offset: number): boolean {
    return (
      offset >= 0 &&
      offset <= text.length &&
      !(
        offset > 0 &&
        offset < text.length &&
        /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
        /[\uDC00-\uDFFF]/.test(text[offset])
      )
    );
  }
  async function appendEvidence(ctx: DiscoveryMutationContext, raw: unknown) {
    const v = DiscoveryEvidenceInput.parse(snapshot(raw));
    return mutate('evidence', 'evidence', ctx, v, async () => {
      const rep = await content('representation', v.representation);
      const s = v.selector;
      if (s.kind === 'text-span') {
        const text = rep.normalizedText as string;
        if (
          s.end <= s.start ||
          !boundary(text, s.start) ||
          !boundary(text, s.end) ||
          text.slice(s.start, s.end) !== s.quote
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-span-mismatch',
          );
      } else {
        if (
          rep.format !== 'json' ||
          canonicalDiscoveryEvidenceJson(
            pointerValue(rep.structured, s.pointer),
          ) !== canonicalDiscoveryEvidenceJson(s.value)
        )
          throw new DiscoveryEvidenceConflict(
            'discovery-evidence-pointer-mismatch',
          );
      }
      return {
        content: {
          ...v,
          originalBytesSha256: rep.originalBytesSha256,
          normalizedTextSha256: rep.normalizedTextSha256,
          byteKind: rep.byteKind,
          origin: rep.origin,
        },
        refs: [dependency('representation', v.representation)],
        plan: { sourceSupportRepresentation: v.representation, sourceSupportSelector: v.selector },
      };
    });
  }
  async function appendClaim(ctx: DiscoveryMutationContext, raw: unknown) {
    const v = DiscoveryClaimInput.parse(snapshot(raw));
    return mutate('claim', 'claim', ctx, v, async () => ({
      content: {
        ...v,
        evidenceDigests: await Promise.all(
          v.evidence.map(async (ref) => {
            const row = await readRevision('evidence', ref.id, ref.revision);
            if (!row || !row.usable)
              throw new DiscoveryEvidenceConflict(
                'discovery-evidence-unusable-reference',
              );
            return { ...ref, contentSha256: row.contentSha256 };
          }),
        ),
      },
      refs: [
        ...v.evidence.map((r) => dependency('evidence', r)),
        dependency('policy', v.policy),
      ],
      expectedHeads: [dependency('policy', v.policy)],
      plan: { subject: v.subject, subjectRevision: v.subjectRevision },
    }));
  }
  async function appendDecision(ctx: DiscoveryMutationContext, raw: unknown) {
    const v = DiscoveryDecisionInput.parse(snapshot(raw));
    return mutate('decision', 'decision', ctx, v, async (parsed, cap) => {
      const claim = (await content(
        'claim',
        v.claim,
      )) as unknown as DiscoveryClaimInput;
      const scope = await hash([claim.subject, claim.predicate]);
      if (
        parsed.expectedRevision === null
          ? v.supersedes !== undefined
          : !v.supersedes ||
            v.supersedes.id !== v.id ||
            v.supersedes.revision !== parsed.expectedRevision
      )
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-invalid-supersedes',
        );
      return {
        content: {
          ...v,
          authority: {
            kind: 'authenticated-reviewer',
            principalId: cap.principalId,
            authenticationContextId: cap.authenticationContextId,
          },
          evidence: claim.evidence,
          evidenceDigests: (
            claim as DiscoveryClaimInput & { evidenceDigests: unknown }
          ).evidenceDigests,
          expectedSubject: {
            ...claim.subject,
            revision: claim.subjectRevision,
          },
          expectedHeads: [
            ...parsed.expectedHeads,
            dependency('claim', v.claim),
            dependency('policy', v.policy),
          ],
        },
        refs: [
          dependency('claim', v.claim),
          dependency('policy', v.policy),
          ...claim.evidence.map((r) => dependency('evidence', r)),
        ],
        expectedHeads: [
          dependency('claim', v.claim),
          dependency('policy', v.policy),
        ],
        plan: {
          subject: claim.subject,
          subjectRevision: claim.subjectRevision,
        },
        extra: (op) => [
          sql(
            `INSERT INTO discovery_evidence_decision_scopes SELECT ?,? WHERE ${pending} ON CONFLICT(scope_key) DO NOTHING`,
            [scope, v.id, op],
          ),
          sql(
            `INSERT INTO discovery_evidence_scope_checks SELECT ?,?,? WHERE ${pending}`,
            [op, scope, v.id, op],
          ),
        ],
      };
    });
  }
  async function appendPrivateNote(
    ctx: DiscoveryMutationContext,
    raw: unknown,
  ) {
    const v = z
      .object({
        schemaVersion: z
          .literal(DISCOVERY_SCHEMA_VERSION)
          .default(DISCOVERY_SCHEMA_VERSION),
        id: DiscoveryId,
        revision: RevisionRef.shape.revision,
        subject: DiscoveryEvidenceDependency,
        text: z.string().min(1).max(4000),
      })
      .strict()
      .parse(snapshot(raw));
    return mutate('private-note', 'private-note', ctx, v, async () => ({
      content: v,
      refs: [v.subject],
    }));
  }
  async function recordRefreshFailure(
    ctx: DiscoveryMutationContext,
    raw: unknown,
  ) {
    const v = retained
      .extend({ code: DiscoveryId })
      .strict()
      .parse(snapshot(raw));
    return mutate('refresh-failure', 'refresh-failure', ctx, v, async () => ({
      content: v,
      refs: [dependency('representation', v.representation)],
    }));
  }
  async function revokeRetention(ctx: DiscoveryMutationContext, raw: unknown) {
    const v = z
      .object({
        schemaVersion: z
          .literal(DISCOVERY_SCHEMA_VERSION)
          .default(DISCOVERY_SCHEMA_VERSION),
        id: DiscoveryId,
        revision: RevisionRef.shape.revision,
        rights: RevisionRef,
        policy: RevisionRef,
        reason: z.string().min(1).max(2000),
      })
      .strict()
      .parse(snapshot(raw));
    return mutate('revocation', 'revoke', ctx, v, async () => {
      const rightsRow = await sql(
        "SELECT payload_json FROM discovery_evidence_contents WHERE kind='rights' AND id=? AND revision=?",
        [v.rights.id, v.rights.revision],
      ).first<{ payload_json: string }>();
      if (!rightsRow)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-unusable-reference',
        );
      const rights = DiscoveryEvidenceControl.parse(
        JSON.parse(rightsRow.payload_json),
      );
      if (!rights.rights)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-invalid-rights',
        );
      const scope = rights.rights.materialScope;
      const scopeKey = await hash(scope);
      const rightsHead = await sql(
        "SELECT revision FROM discovery_evidence_heads WHERE kind='rights' AND id=?",
        [v.rights.id],
      ).first<{ revision: number }>();
      if (!rightsHead)
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-missing-rights-head',
        );
      // Revocation reasons may quote forbidden source content; keep them removable
      // and erase this transaction's content too. Only IDs/hash audit survives.
      const closure = `WITH RECURSIVE affected(kind,id,revision) AS (
        SELECT c.kind,c.id,c.revision FROM discovery_evidence_contents c JOIN discovery_evidence_revisions r USING(kind,id,revision) WHERE c.kind='rights' AND r.scope_key=?
        UNION SELECT e.dependent_kind,e.dependent_id,e.dependent_revision FROM discovery_evidence_edges e JOIN affected a ON e.source_kind=a.kind AND e.source_id=a.id AND e.source_revision=a.revision
      )`;
      return {
        content: v,
        refs: [dependency('rights', v.rights), dependency('policy', v.policy)],
        expectedHeads: [
          dependency('rights', {
            id: v.rights.id,
            revision: rightsHead.revision,
          }),
          dependency('policy', v.policy),
        ],
        extra: (op) => [
          sql(
            `INSERT INTO discovery_evidence_revoked_scopes SELECT ?,? WHERE ${pending} ON CONFLICT DO NOTHING`,
            [scopeKey, op, op],
          ),
          sql(
            `${closure} INSERT INTO discovery_evidence_tombstones SELECT kind,id,revision,? FROM affected a WHERE NOT EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) AND ${pending}`,
            [scopeKey, op, op],
          ),
          sql(
            `INSERT INTO discovery_evidence_tombstones SELECT 'revocation',?,?,? WHERE NOT EXISTS(SELECT 1 FROM discovery_evidence_tombstones WHERE kind='revocation' AND id=? AND revision=?) AND ${pending}`,
            [v.id, v.revision, op, v.id, v.revision, op],
          ),
          sql(
            `INSERT INTO discovery_evidence_invalidations SELECT kind,id,revision,? FROM discovery_evidence_tombstones t WHERE operation_id=? AND NOT EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=t.kind AND i.id=t.id AND i.revision=t.revision) AND ${pending}`,
            [op, op, op],
          ),
          sql(
            `DELETE FROM discovery_evidence_contents WHERE EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=discovery_evidence_contents.kind AND t.id=discovery_evidence_contents.id AND t.revision=discovery_evidence_contents.revision AND t.operation_id=?) AND ${pending}`,
            [op, op],
          ),
          sql(
            `UPDATE discovery_evidence_state SET invalidation_epoch=invalidation_epoch+1 WHERE ${pending}`,
            [op],
          ),
        ],
      };
    });
  }
  /** Removal-only current-support invalidation. No editorial decision or erasure. */
  async function invalidateSourceSupport(rawContext: DiscoveryMutationContext, raw: unknown) {
    const ctx = DiscoveryMutationContext.parse(snapshot(rawContext)), value = DiscoveryForumEditInput.parse(snapshot(raw));
    const result = await mutate('source-change', 'invalidate-source-support', ctx, value, async () => {
      if (!options.resolveForumSupport || !options.composeSourceChangeGuard) throw new DiscoveryEvidenceConflict('discovery-source-support-resolver-required');
      const resolve = async (receiptId: string) => { const result=DiscoveryForumSupportSnapshot.parse(snapshot(await options.resolveForumSupport!(receiptId, value.postId))); if (result.receiptId!==receiptId || result.postId!==value.postId) throw new DiscoveryEvidenceConflict('discovery-source-support-receipt-binding'); return result; };
      const prior = await resolve(value.priorReceiptId), current = await resolve(value.currentReceiptId);
      const binding = (v: typeof prior) => ({sourceId:v.sourceId, sourceRevision:v.sourceRevision, installation:v.installation, scopeId:v.scopeId,
        configuration:v.configuration, enrollment:v.enrollment, permission:v.permission, rights:v.rights, parser:v.parser,
        normalizer:v.normalizer, policy:v.policy, topicId:v.topicId, postId:v.postId});
      if (!same(binding(prior),binding(current)) || !same(value.policy,current.policy) || prior.postId !== value.postId ||
          current.postVersion <= prior.postVersion || Date.parse(current.updatedAt) < Date.parse(prior.updatedAt))
        throw new DiscoveryEvidenceConflict('discovery-source-support-edit-binding');
      const bindingKey = await hash(binding(current));
      const old = await content('representation',prior.representation), fresh = await content('representation',current.representation);
      const checkBody = async (entry: typeof prior, body: Record<string,unknown>) => {
        const scope = body.materialScope as Record<string,unknown>;
        const post = pointerValue(body.structured,entry.postPointer) as Record<string,unknown>;
        if (!scope || scope.kind !== 'source-response' || scope.sourceId !== entry.sourceId || scope.installation !== entry.installation || scope.scopeId !== entry.scopeId ||
            !same(body.configuration,entry.configuration) || !same(body.enrollment,entry.enrollment) || !same(body.permission,entry.permission) || !same(body.rights,entry.rights) || !same(body.parser,entry.parser) || !same(body.normalizer,entry.normalizer) ||
            body.originalBytesSha256 !== entry.representationSha256 || post.id !== entry.postId || post.topic_id !== entry.topicId || post.version !== entry.postVersion || post.updated_at !== entry.updatedAt ||
            await hash(post) !== entry.postSha256) throw new DiscoveryEvidenceConflict('discovery-source-support-body-binding');
        const capturedAt=DiscoveryInstant.parse(body.capturedAt);
        if (Date.parse(entry.updatedAt)>Date.parse(capturedAt)) throw new DiscoveryEvidenceConflict('discovery-source-support-future-edit');
        return capturedAt;
      };
      const oldAt = await checkBody(prior,old), currentAt = await checkBody(current,fresh);
      if (!(Date.parse(currentAt)>Date.parse(oldAt)) || Date.parse(currentAt)>Date.parse(now())) throw new DiscoveryEvidenceConflict('discovery-source-support-observation-order');
      const sourceHead=await sql('SELECT revision,generation,active,qualification_id FROM discovery_source_heads WHERE source_id=?',[current.sourceId]).first<{revision:number;generation:number;active:number;qualification_id:string|null}>();
      if (!sourceHead || !sourceHead.active || !sourceHead.qualification_id || sourceHead.revision!==current.sourceRevision) throw new DiscoveryEvidenceConflict('discovery-source-support-current-frame');
      const watermark = await sql('SELECT version,captured_at,source_generation,qualification_id FROM discovery_source_support_watermarks WHERE binding_key=?',[bindingKey]).first<{version:number;captured_at:string;source_generation:number;qualification_id:string}>();
      if (watermark && (watermark.source_generation!==sourceHead.generation || watermark.qualification_id!==sourceHead.qualification_id)) throw new DiscoveryEvidenceConflict('discovery-source-support-cross-generation');
      if (watermark && (watermark.version >= current.postVersion || Date.parse(watermark.captured_at)>=Date.parse(currentAt))) throw new DiscoveryEvidenceConflict('discovery-source-support-stale-watermark');
      // ALL captures for this source, including captures lacking WP07 page settlement.
      const inventory = (await sql(`SELECT r.id,r.revision,r.content_sha256 AS sha256,p.source_revision,pg.id AS receipt_id
        FROM discovery_source_captures c JOIN discovery_source_plans p ON p.id=c.plan_id
        JOIN discovery_evidence_revisions r ON r.kind='representation' AND r.id=c.representation_id AND r.revision=c.representation_revision
        LEFT JOIN discovery_collection_pages pg ON pg.representation_id=r.id AND pg.representation_revision=r.revision
        WHERE p.source_id=? ORDER BY r.id,r.revision LIMIT 129`,[current.sourceId]).all<{
          id:string;revision:number;sha256:string;source_revision:number;receipt_id:string|null
        }>()).results ?? [];
      if (!inventory.length || inventory.length>128 || new Set(inventory.map(r=>canonicalDiscoveryEvidenceJson([r.id,r.revision]))).size!==inventory.length)
        throw new DiscoveryEvidenceConflict('discovery-source-support-inventory-bound');
      const targets:{representation:{id:string;revision:number};postPointer:string;postVersion:number}[]=[];
      const unmapped:{id:string;revision:number}[]=[];
      const refs:Ref[]=[dependency('policy',value.policy)]; let byteCount=0;
      for (const item of inventory) {
        const state = await readRevision('representation',item.id,item.revision);
        if (!state || state.contentSha256!==item.sha256) throw new DiscoveryEvidenceConflict('discovery-source-support-inventory-integrity');
        if (!state.usable) continue; // Already unusable ancestry cannot support any current claim/new evidence.
        const body = state.content as Record<string,unknown>;
        byteCount += new TextEncoder().encode(canonicalDiscoveryEvidenceJson(body)).byteLength;
        if (byteCount>4194304) throw new DiscoveryEvidenceConflict('discovery-source-support-inventory-bound');
        refs.push(dependency('representation',{id:item.id,revision:item.revision}));
        if (item.source_revision!==current.sourceRevision) throw new DiscoveryEvidenceConflict('discovery-source-support-cross-configuration');
        const posts = (body.structured as any)?.post_stream?.posts;
        const matches = Array.isArray(posts) ? posts.filter((post:any)=>post?.id===current.postId) : [];
        if (!matches.length) {
          const uses=await sql(`SELECT count(*) AS n FROM discovery_evidence_edges WHERE source_kind='representation' AND source_id=? AND source_revision=? AND dependent_kind='evidence'`,[item.id,item.revision]).first<{n:number}>();
          if ((uses?.n??0)>0) throw new DiscoveryEvidenceConflict('discovery-source-support-unmapped-history');
          unmapped.push({id:item.id,revision:item.revision});
          continue;
        }
        if (matches.length!==1 || !item.receipt_id) throw new DiscoveryEvidenceConflict('discovery-source-support-unmapped-history');
        const entry=await resolve(item.receipt_id); await checkBody(entry,body);
        if (!same(binding(entry),binding(current)) || !same(entry.representation,{id:item.id,revision:item.revision}) || entry.postVersion>current.postVersion ||
            (entry.postVersion===current.postVersion && entry.postSha256!==current.postSha256)) throw new DiscoveryEvidenceConflict('discovery-source-support-history-conflict');
        if (entry.postVersion<current.postVersion) targets.push({representation:{id:item.id,revision:item.revision},postPointer:entry.postPointer,postVersion:entry.postVersion});
      }
      if (!targets.some(t=>same(t.representation,prior.representation))) throw new DiscoveryEvidenceConflict('discovery-source-support-prior-uncovered');
      const composed=await options.composeSourceChangeGuard({operationId:ctx.operationId,snapshot:current});
      const roots=`SELECT e.id,e.revision, json_extract(e.payload_json,'$.selector.kind') AS selector_kind FROM discovery_evidence_contents e JOIN json_each(?) t
        WHERE e.kind='evidence' AND NOT EXISTS(SELECT 1 FROM discovery_evidence_invalidations done WHERE done.kind=e.kind AND done.id=e.id AND done.revision=e.revision) AND json_extract(e.payload_json,'$.representation.id')=json_extract(t.value,'$.representation.id')
        AND json_extract(e.payload_json,'$.representation.revision')=json_extract(t.value,'$.representation.revision')
        AND (json_extract(e.payload_json,'$.selector.kind')='text-span' OR json_extract(e.payload_json,'$.selector.pointer')=''
          OR json_extract(e.payload_json,'$.selector.pointer')=json_extract(t.value,'$.postPointer')
          OR instr(json_extract(e.payload_json,'$.selector.pointer'),json_extract(t.value,'$.postPointer')||'/')=1
          OR instr(json_extract(t.value,'$.postPointer'),json_extract(e.payload_json,'$.selector.pointer')||'/')=1)`;
      const targetsJson=canonicalDiscoveryEvidenceJson(targets);
      const closure=`WITH RECURSIVE roots AS (${roots}), affected(kind,id,revision) AS (
        SELECT 'evidence',id,revision FROM roots UNION SELECT e.dependent_kind,e.dependent_id,e.dependent_revision FROM discovery_evidence_edges e
        JOIN affected a ON e.source_kind=a.kind AND e.source_id=a.id AND e.source_revision=a.revision)`;
      return {content:{...value,kind:'native-post-edit',binding:binding(current),bindingKey,prior,current,oldCapturedAt:oldAt,currentCapturedAt:currentAt,
          inventory:inventory.map(({id,revision,sha256})=>({id,revision,sha256})),targets},refs,
        expectedHeads:[dependency('policy',value.policy)],captureComposition:composed,
        plan:{sourceSupport:{bindingKey,sourceId:current.sourceId,sourceRevision:current.sourceRevision,postId:current.postId,
          configuration:current.configuration,installation:current.installation,scopeId:current.scopeId,topicId:current.topicId,
          sourceGeneration:sourceHead.generation,qualificationId:sourceHead.qualification_id,
          currentVersion:current.postVersion,currentCapturedAt:currentAt,currentPostSha256:current.postSha256,
          currentRepresentation:current.representation,currentPostPointer:current.postPointer,
          expectedVersion:watermark?.version??null,unmapped,inventory:inventory.map(({id,revision,sha256})=>({id,revision,sha256})),targets}},
        extra:op=>[
          sql(`INSERT INTO discovery_source_support_events(operation_id,binding_key,root_count,conservative_count)
            SELECT ?,?,(SELECT count(*) FROM (${roots})),(SELECT count(*) FROM (${roots}) WHERE selector_kind='text-span') WHERE ${pending}`,
            [op,bindingKey,targetsJson,targetsJson,op]),
          sql(`${closure} INSERT INTO discovery_evidence_invalidations SELECT kind,id,revision,? FROM affected a WHERE
            NOT EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=a.kind AND i.id=a.id AND i.revision=a.revision) AND ${pending}`,[targetsJson,op,op]),
          sql(`INSERT INTO discovery_source_support_watermarks(binding_key,source_id,source_revision,installation,scope_id,configuration_id,configuration_revision,topic_id,post_id,version,captured_at,post_sha256,operation_id,representation_id,representation_revision,post_pointer,source_generation,qualification_id)
            SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${pending} ON CONFLICT(binding_key) DO UPDATE SET version=excluded.version,captured_at=excluded.captured_at,post_sha256=excluded.post_sha256,operation_id=excluded.operation_id,representation_id=excluded.representation_id,representation_revision=excluded.representation_revision,post_pointer=excluded.post_pointer,source_generation=excluded.source_generation,qualification_id=excluded.qualification_id`,
            [bindingKey,current.sourceId,current.sourceRevision,current.installation,current.scopeId,current.configuration.id,current.configuration.revision,current.topicId,current.postId,current.postVersion,currentAt,current.postSha256,op,current.representation.id,current.representation.revision,current.postPointer,sourceHead.generation,sourceHead.qualification_id,op]),
          sql(`UPDATE discovery_evidence_state SET invalidation_epoch=invalidation_epoch+1 WHERE ${pending}`,[op])],
      };
    });
    const counts=await sql('SELECT root_count,conservative_count FROM discovery_source_support_events WHERE operation_id=?',[ctx.operationId]).first<{root_count:number;conservative_count:number}>();
    if (!counts) throw new DiscoveryEvidenceConflict('discovery-source-support-missing-ack');
    return {...result,affectedEvidenceCount:counts.root_count,conservativeSpanCount:counts.conservative_count,
      currentClaimScope:'existing-exact-source-frame-support-only' as const,publicVisibilityIntegration:'requires-WP16' as const,deletionVerified:false as const};
  }
  async function distinctOriginCount(raw: unknown[]): Promise<number> {
    const refs = z.array(RevisionRef).min(1).max(128).parse(snapshot(raw));
    const origins = new Set<string>();
    for (const ref of refs) {
      const evidence = await content('evidence', ref);
      const origin = await content(
        'origin',
        RevisionRef.parse(evidence.origin),
      );
      if (origin.status === 'provisional-source-response')
        throw new DiscoveryEvidenceConflict(
          'discovery-evidence-unresolved-provenance',
        );
      origins.add(DiscoveryId.parse(origin.originalWorkId));
    }
    return origins.size;
  }
  return {
    appendControl,
    appendIssuedSourceRequest,
    appendOrigin,
    appendRepresentation,
    observeRepresentation,
    appendEvidence,
    appendClaim,
    appendDecision,
    appendPrivateNote,
    recordRefreshFailure,
    revokeRetention,
    invalidateSourceSupport,
    readRevision,
    distinctOriginCount,
  };
}
