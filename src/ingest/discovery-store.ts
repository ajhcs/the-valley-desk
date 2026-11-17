import {
  DiscoveryId,
  Revision,
  RevisionRef,
  ProviderIdentity,
  DiscoveryReviewDecision,
} from '../content/discovery-schema';
import {
  DiscoveryEntity,
  DiscoveryRelation,
  DiscoveryObservation,
  DiscoveryAlias,
} from '../content/discovery-catalog';
import type { D1DatabaseLike, D1StatementLike } from './persistence';

export class DiscoveryCatalogConflict extends Error {
  readonly code = 'discovery-catalog-conflict';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscoveryCatalogConflict';
  }
}

// Stable serialization makes object key order irrelevant to operation replay.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function discoveryProviderIdentityId(input: unknown): Promise<string> {
  const identity = ProviderIdentity.parse(input);
  return `provider:${await digest([identity.provider, identity.installation, identity.kind, identity.nativeId])}`;
}

async function batch(db: D1DatabaseLike, statements: D1StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'catalog write failed';
    throw new DiscoveryCatalogConflict(message, { cause: error });
  }
}

function statement(db: D1DatabaseLike, sql: string, values: unknown[] = []): D1StatementLike {
  return db.prepare(sql).bind(...values);
}

const pending = 'NOT EXISTS(SELECT 1 FROM discovery_catalog_operations WHERE operation_id=?)';
type WriteResult = { id: string; revision: number; operationId: string };
type WritePlan = {
  type: 'entity' | 'observation' | 'relation';
  id: string;
  revision: number;
  payload: unknown;
  statements: (operationId: string) => D1StatementLike[];
};

async function write(
  db: D1DatabaseLike,
  operationId: string,
  expectedRevision: number | null,
  plan: WritePlan,
): Promise<WriteResult> {
  DiscoveryId.parse(operationId);
  if (expectedRevision !== null) Revision.parse(expectedRevision);
  if (plan.revision !== (expectedRevision ?? 0) + 1) {
    throw new DiscoveryCatalogConflict('discovery-nonsequential-revision');
  }
  const requestHash = await digest({ type: plan.type, id: plan.id, expectedRevision, payload: plan.payload });
  await batch(db, [
    statement(db,
      'INSERT INTO discovery_catalog_write_guards VALUES(?,?,?,?,?,?) ON CONFLICT(operation_id) DO NOTHING',
      [operationId, requestHash, plan.type, plan.id, expectedRevision, plan.revision]),
    ...plan.statements(operationId),
    statement(db,
      `INSERT INTO discovery_catalog_${plan.type}_heads(id,revision) SELECT ?,? WHERE ${pending} ON CONFLICT(id) DO UPDATE SET revision=excluded.revision`,
      [plan.id, plan.revision, operationId]),
    statement(db,
      `INSERT INTO discovery_catalog_operations SELECT ?,?,?,?,? WHERE ${pending}`,
      [operationId, requestHash, plan.type, plan.id, plan.revision, operationId]),
  ]);
  return { id: plan.id, revision: plan.revision, operationId };
}

export async function putDiscoveryEntity(
  db: D1DatabaseLike,
  input: { operationId: string; expectedRevision: number | null; entity: unknown },
): Promise<WriteResult> {
  const entity = DiscoveryEntity.parse(input.entity);
  const payload = canonical(entity);
  const identityId = entity.kind === 'account' ? await discoveryProviderIdentityId(entity.identity) : null;
  return write(db, input.operationId, input.expectedRevision, {
    type: 'entity',
    id: entity.id,
    revision: entity.revision,
    payload: entity,
    statements: operationId => {
      const writes = [
        statement(db,
          `INSERT INTO discovery_catalog_entities SELECT ?,?,? WHERE ${pending} ON CONFLICT(id) DO NOTHING`,
          [entity.id, entity.kind, entity.kind === 'artifact' ? entity.artifactKind : null, operationId]),
        statement(db,
          `INSERT INTO discovery_catalog_entity_revisions SELECT ?,?,?,? WHERE ${pending}`,
          [entity.id, entity.revision, entity.kind, payload, operationId]),
      ];
      if (entity.kind === 'account') {
        writes.push(statement(db,
          `INSERT INTO discovery_catalog_provider_identities SELECT ?,?,?,?,?,? WHERE ${pending} ON CONFLICT(id) DO NOTHING`,
          [identityId, entity.identity.provider, entity.identity.installation,
            entity.identity.kind, entity.identity.nativeId, entity.id, operationId]));
      }
      return writes;
    },
  });
}

// Binding a source-native identity never merges two catalog subjects. A separately
// reviewed, retractable equivalence relation is required for cross-source joins.
export async function bindDiscoveryProviderIdentity(
  db: D1DatabaseLike,
  input: unknown,
  subjectId: string,
): Promise<{ id: string; subjectId: string }> {
  const identity = ProviderIdentity.parse(input);
  DiscoveryId.parse(subjectId);
  const id = await discoveryProviderIdentityId(identity);
  await batch(db, [statement(db,
    'INSERT INTO discovery_catalog_provider_identities VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    [id, identity.provider, identity.installation, identity.kind, identity.nativeId, subjectId])]);
  return { id, subjectId };
}

export async function putDiscoveryObservation(
  db: D1DatabaseLike,
  input: { operationId: string; expectedRevision: number | null; observation: unknown },
): Promise<WriteResult> {
  const observation = DiscoveryObservation.parse(input.observation);
  const identityId = await discoveryProviderIdentityId(observation.identity);
  return write(db, input.operationId, input.expectedRevision, {
    type: 'observation',
    id: observation.id,
    revision: observation.revision,
    payload: observation,
    statements: operationId => [
      statement(db,
        `INSERT INTO discovery_catalog_observation_families SELECT ?,? WHERE ${pending} ON CONFLICT(id) DO NOTHING`,
        [observation.id, identityId, operationId]),
      statement(db,
        `INSERT INTO discovery_catalog_observation_revisions SELECT ?,?,?,? WHERE ${pending}`,
        [observation.id, observation.revision, identityId, canonical(observation), operationId]),
    ],
  });
}

// Reference anchors carry no content and make no assertion about evidence truth.
// The future evidence store owns retention, redaction and qualification.
export async function registerDiscoveryEvidenceReferences(
  db: D1DatabaseLike,
  input: unknown[],
): Promise<void> {
  if (input.length === 0 || input.length > 128) throw new Error('discovery-evidence-reference-bound');
  const refs = input.map(value => RevisionRef.parse(value));
  await batch(db, refs.map(ref => statement(db,
    'INSERT INTO discovery_catalog_evidence_refs VALUES(?,?) ON CONFLICT(id,revision) DO NOTHING',
    [ref.id, ref.revision])));
}

// Internal persistence only: callers must construct authority from authenticated
// server context. No source/model/body-provided authority is authenticated here.
export async function registerDiscoveryDecisionReference(db: D1DatabaseLike, input: unknown): Promise<void> {
  const decision = DiscoveryReviewDecision.parse(input);
  await batch(db, [statement(db,
    'INSERT INTO discovery_catalog_decision_refs VALUES(?,?,?) ON CONFLICT(id,revision) DO NOTHING',
    [decision.id, decision.revision, canonical(decision)])]);
}

export async function putDiscoveryRelation(
  db: D1DatabaseLike,
  input: { operationId: string; expectedRevision: number | null; relation: unknown },
): Promise<WriteResult> {
  const relation = DiscoveryRelation.parse(input.relation);
  return write(db, input.operationId, input.expectedRevision, {
    type: 'relation',
    id: relation.id,
    revision: relation.revision,
    payload: relation,
    statements: operationId => [
      statement(db,
        `INSERT INTO discovery_catalog_relation_families SELECT ?,? WHERE ${pending} ON CONFLICT(id) DO NOTHING`,
        [relation.id, relation.kind, operationId]),
      statement(db,
        `INSERT INTO discovery_catalog_relation_revisions SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${pending}`,
        [relation.id, relation.revision, relation.kind,
          relation.from.id, relation.from.revision, relation.from.kind,
          relation.to.id, relation.to.revision, relation.to.kind,
          relation.decision.id, relation.decision.revision,
          relation.kind === 'affiliation' ? relation.county : null,
          canonical(relation), operationId]),
    ],
  });
}

export async function putDiscoveryAlias(db: D1DatabaseLike, input: unknown): Promise<void> {
  const alias = DiscoveryAlias.parse(input);
  await batch(db, [statement(db,
    'INSERT INTO discovery_catalog_aliases VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    [alias.id, alias.subject.id, alias.subject.kind, alias.value, canonical(alias)])]);
}

export async function readDiscoveryEntity(db: D1DatabaseLike, id: string): Promise<DiscoveryEntity | null> {
  DiscoveryId.parse(id);
  const row = await statement(db,
    'SELECT r.payload_json FROM discovery_catalog_entity_heads h JOIN discovery_catalog_entity_revisions r ON r.id=h.id AND r.revision=h.revision WHERE h.id=?',
    [id]).first<{ payload_json: string }>();
  return row === null ? null : DiscoveryEntity.parse(JSON.parse(row.payload_json));
}

export async function reserveDiscoveryPublication(
  db: D1DatabaseLike,
  id: string,
  subject: { id: string; kind: 'person' | 'organization' | 'project' | 'artifact' },
): Promise<void> {
  DiscoveryId.parse(id);
  DiscoveryId.parse(subject.id);
  // A same-ID incompatible reservation must fail, rather than silently replay.
  await batch(db, [statement(db,
    'INSERT INTO discovery_publication_reservations(id,subject_id,subject_kind) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
    [id, subject.id, subject.kind])]);
}
