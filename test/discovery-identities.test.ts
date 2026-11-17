import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { DISCOVERY_COUNTY_KEYS, makeDiscoveryDate, discoveryDateContained } from '../src/content/discovery-schema';
import { DiscoveryEntity, DiscoveryRelation, discoveryAffiliationIsCurrentLocal } from '../src/content/discovery-catalog';
import {
  putDiscoveryEntity, bindDiscoveryProviderIdentity, discoveryProviderIdentityId,
  putDiscoveryObservation, registerDiscoveryEvidenceReferences, registerDiscoveryDecisionReference,
  putDiscoveryRelation, putDiscoveryAlias, readDiscoveryEntity, reserveDiscoveryPublication,
} from '../src/ingest/discovery-store';
import type { D1DatabaseLike } from '../src/ingest/persistence';

const now = '2026-11-14T12:00:00Z', schemaVersion = 'discovery-v1', evidence = [{ id: 'evidence:synthetic', revision: 1 }];
const person = (id: string, displayName = 'Same Name', revision = 1) => ({ schemaVersion, id, revision, kind: 'person', displayName });
const paper = (id: string, sourceDate = makeDiscoveryDate('year', '2024')) => ({ schemaVersion, id, revision: 1, kind: 'artifact', artifactKind: 'publication', displayName: 'Synthetic paper', sourceDate });
const endpoint = (id: string, kind: string, revision = 1, artifactKind = 'publication') => ({
  id, kind, revision, ...(kind === 'artifact' ? { artifactKind } : {}),
});
const native = { provider: 'github', installation: 'github.com', kind: 'account', nativeId: '42' };
const decision = (id: string, revision = 1) => ({ schemaVersion, id: `decision:${id}:${revision}`, revision: 1,
  target: { kind: 'relationship', id, revision }, decision: 'accepted', authority: { kind: 'authenticated-reviewer', principalId: 'synthetic:reviewer', authenticationContextId: 'synthetic:auth' },
  reason: 'Synthetic authenticated-context fixture, not editorial admission', policy: { id: 'policy:v1', revision: 1 },
  expectedDependencies: { entries: [{ kind: 'evidence-observation', id: evidence[0].id, revision: 1, role: 'validity' }], required: [{ kind: 'evidence-observation', id: evidence[0].id }] },
  evidence, operationId: `review:${id}:${revision}`, decidedAt: now,
});
const relation = (id: string, kind: string, from: unknown, to: unknown, fields = {}, revision = 1) => ({
  schemaVersion, id, revision, kind, from, to, evidence, decision: { id: `decision:${id}:${revision}`, revision: 1 },
  status: 'active', sourceDate: makeDiscoveryDate('unknown', null), ...fields,
});

// These tests run an isolated local D1 database, with no env files, remote bindings,
// scheduler, provider requests, persisted runtime state, or production database ID.
test('WP04 real local D1 catalog, identity and transaction qualification', { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ DISCOVERY_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL('./fixtures/discovery-d1/wrangler.jsonc', import.meta.url)), envFiles: [], persist: false, remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const db = proxy.env.DISCOVERY_TEST_DB;
  const migrations = new URL('../migrations/', import.meta.url);
  const report: Record<string, unknown> = { runtime: process.version, baseline: 'c8b36d7e9b27376bf121d9d6670c500a25c62423', synthetic: true, database: 'isolated-local-D1', cases: {} };
  const cases = report.cases as Record<string, unknown>;
  const apply = async (name: string) => db.batch(unstable_splitSqlQuery(readFileSync(new URL(name, migrations), 'utf8')).map(sql => db.prepare(sql)));
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n < '0041').sort()) await apply(name);
  const legacySchema = (await db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()).results;
  await db.prepare("INSERT INTO watch_subjects(id,kind,external_key,slug,input_revision,input_sha256,first_seen_at) VALUES('legacy:core','policy','legacy:core','legacy-core',1,?,'2026-01-01')").bind('0'.repeat(64)).run();
  const legacyRows = (await db.prepare('SELECT * FROM watch_subjects').all()).results;
  await apply('0041_discovery_catalog.sql');
  assert.deepEqual((await db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'discovery_%' ORDER BY name").all()).results, legacySchema);
  assert.deepEqual((await db.prepare('SELECT * FROM watch_subjects').all()).results, legacyRows);
  await registerDiscoveryEvidenceReferences(db, evidence);
  const put = (entity: unknown, operationId: string, expectedRevision: number | null = null) => putDiscoveryEntity(db, { entity, operationId, expectedRevision });
  const storeRelation = async (r: ReturnType<typeof relation>, expectedRevision: number | null = null) => {
    await registerDiscoveryDecisionReference(db, decision(r.id, r.revision));
    return putDiscoveryRelation(db, { operationId: `relation:${r.id}:${r.revision}`, expectedRevision, relation: r });
  };
  const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  const dump = async () => {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%' ORDER BY name").all<{ name: string }>()).results!;
    const result: Record<string, unknown> = {};
    for (const { name } of tables) result[name] = (await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).results;
    return result;
  };

  await t.test('AC-WP04-01: stable tuple replay and ten immutable observation versions', async () => {
    await put({ schemaVersion, id: 'account:42', revision: 1, kind: 'account', displayName: 'old-handle', identity: native }, 'create:account42');
    const ids: string[] = [];
    for (let revision = 1; revision <= 10; revision++) {
      ids.push((await bindDiscoveryProviderIdentity(db, native, 'account:42')).id);
      const input = { operationId: `observation:${revision}`, expectedRevision: revision === 1 ? null : revision - 1,
        observation: { schemaVersion, id: 'observed:42', revision, identity: native, observedAt: now, sourceDate: makeDiscoveryDate('unknown', null), representationSha256: String(revision % 10).repeat(64) } };
      const first = await putDiscoveryObservation(db, input);
      assert.deepEqual(await putDiscoveryObservation(db, input), first);
    }
    assert.equal(new Set(ids).size, 1);
    assert.equal(await count('discovery_catalog_provider_identities'), 1);
    assert.equal(await count('discovery_catalog_observation_revisions'), 10);
    await put({ schemaVersion, id: 'account:42', revision: 2, kind: 'account', displayName: 'renamed-handle', identity: native }, 'rename:42', 1);
    assert.equal(await count('discovery_catalog_provider_identities'), 1);
    const repositoryIdentity = { ...native, kind: 'artifact', nativeId: 'repo-42' };
    await put({ ...paper('repository:42'), artifactKind: 'repository' }, 'create:repository42');
    const repositoryId = (await bindDiscoveryProviderIdentity(db, repositoryIdentity, 'repository:42')).id;
    await put({ ...paper('repository:42'), artifactKind: 'repository', revision: 2, displayName: 'Transferred/new-owner/new-name' }, 'transfer:repository42', 1);
    assert.equal((await bindDiscoveryProviderIdentity(db, repositoryIdentity, 'repository:42')).id, repositoryId);
    const before = await dump();
    await assert.rejects(putDiscoveryObservation(db, { operationId: 'observation:10', expectedRevision: 9, observation: { schemaVersion, id: 'observed:42', revision: 10, identity: native, observedAt: now, sourceDate: makeDiscoveryDate('unknown', null), representationSha256: 'f'.repeat(64) } }), /discovery-operation-conflict/);
    assert.deepEqual(await dump(), before);
    cases.AC01 = { returnedIds: ids, observationCount: 10, head: await db.prepare("SELECT * FROM discovery_catalog_observation_heads WHERE id='observed:42'").first(), aliasRenameAndRepositoryTransferPreserveIdentity: true };
  });

  await t.test('AC-WP04-02: matching names and reused aliases preserve separate identities', async () => {
    await put(person('person:one'), 'create:one'); await put(person('person:two'), 'create:two');
    for (const [id, subject] of [['alias:old', 'person:one'], ['alias:reused', 'person:two']]) await putDiscoveryAlias(db, { schemaVersion, id, subject: { id: subject, kind: 'person' }, value: '@same-handle', observedAt: now, evidence });
    assert.equal((await db.prepare("SELECT DISTINCT subject_id FROM discovery_catalog_aliases WHERE value='@same-handle'").all()).results!.length, 2);
    assert.notEqual((await readDiscoveryEntity(db, 'person:one'))!.id, (await readDiscoveryEntity(db, 'person:two'))!.id);
    const id = await discoveryProviderIdentityId(native);
    await assert.rejects(bindDiscoveryProviderIdentity(db, native, 'person:one'), /discovery-identity-conflict/);
    await assert.rejects(put({ schemaVersion, id: 'account:42', revision: 3, kind: 'account', displayName: 'new account', identity: { ...native, nativeId: 'different' } }, 'swap:42', 2), /discovery-account-identity-conflict/);
    await assert.rejects(bindDiscoveryProviderIdentity(db, { ...native, nativeId: 'different' }, 'account:42'), /discovery-account-identity-conflict/);
    const rejected = relation('unreviewed:merge', 'equivalence', endpoint('person:one', 'person'), endpoint('person:two', 'person'));
    await assert.rejects(putDiscoveryRelation(db, { operationId: 'unreviewed:merge', expectedRevision: null, relation: rejected }), /discovery-unaccepted-relationship/);
    await storeRelation(relation('reviewed:equivalence', 'equivalence', endpoint('person:one', 'person'), endpoint('person:two', 'person')));
    await storeRelation(relation('reviewed:equivalence', 'equivalence', endpoint('person:one', 'person'), endpoint('person:two', 'person'), { status: 'retracted' }, 2), 1);
    assert.equal(await count('discovery_catalog_entities'), 4);
    cases.AC02 = { identityId: id, aliases: (await db.prepare("SELECT * FROM discovery_catalog_aliases WHERE value='@same-handle'").all()).results, equivalenceRetractionPreservesBothSubjects: true, unreviewedMergeRejected: true };
  });

  await t.test('AC-WP04-03: independent creator and repository-free paper persist', async () => {
    await put(person('independent:creator', 'Independent professional'), 'create:independent');
    await put(paper('publication:independent'), 'create:paper');
    assert.equal((await readDiscoveryEntity(db, 'independent:creator'))!.kind, 'person');
    assert.equal((await readDiscoveryEntity(db, 'publication:independent'))!.kind, 'artifact');
    assert.equal(await db.prepare("SELECT * FROM discovery_catalog_relation_heads WHERE id='invented:project'").first(), null);
    assert.equal(DiscoveryEntity.safeParse({ ...person('invalid:account'), identity: native }).success, false);
    await reserveDiscoveryPublication(db, 'public:independent', { id: 'independent:creator', kind: 'person' });
    await reserveDiscoveryPublication(db, 'public:independent', { id: 'independent:creator', kind: 'person' });
    await assert.rejects(reserveDiscoveryPublication(db, 'public:independent', { id: 'publication:independent', kind: 'artifact' }), /discovery-reservation-conflict/);
    assert.deepEqual(await db.prepare("SELECT revision,generation FROM discovery_publication_reservations WHERE id='public:independent'").first(), { revision: 1, generation: 0 });
    cases.AC03 = { creator: await readDiscoveryEntity(db, 'independent:creator'), paper: await readDiscoveryEntity(db, 'publication:independent'), reservationGrantsNoPublication: true };
  });

  await t.test('AC-WP04-04: whole date intervals and retained source precision', async () => {
    const truth = [
      ['year', '2024', '2024-02-01', '2024-03-01', false],
      ['year', '2024', '2024-01-01', '2025-01-01', true],
      ['month', '2024-02', '2024-02-01', '2024-03-01', true],
      ['month', '2024-02', '2024-02-02', '2024-03-01', false],
      ['day', '2024-02-29', '2024-02-29', '2024-03-01', true],
      ['instant', '2024-02-29T23:00:00-02:00', '2024-02-29', '2024-03-01', false],
      ['instant', '2024-03-01T00:00:00Z', '2024-03-01', '2024-03-02', true],
      ['unknown', null, '2024-01-01', '2025-01-01', false],
    ] as const;
    for (const [precision, value, from, until, expected] of truth) assert.equal(discoveryDateContained(makeDiscoveryDate(precision, value), from, until), expected);
    assert.throws(() => makeDiscoveryDate('day', '2023-02-29'));
    assert.throws(() => makeDiscoveryDate('instant', '2024-02-01T00:00:00'));
    const stored = await readDiscoveryEntity(db, 'publication:independent');
    assert.equal(stored!.kind === 'artifact' && stored.sourceDate.precision, 'year');
    cases.AC04 = { truthTable: truth, retainedYear: stored, relocationOverlapDoesNotInferRegionalEligibility: true };
  });

  await t.test('AC-WP04-05: all nine county keys, outside/unknown/expired and nonprofessional negatives', async () => {
    await put({ schemaVersion, id: 'organization:one', revision: 1, kind: 'organization', displayName: 'Synthetic organization' }, 'create:organization');
    const checks: unknown[] = [];
    const affiliation = (id: string, county: string | null, extra = {}) => relation(id, 'affiliation', endpoint('person:one', 'person'), endpoint('organization:one', 'organization'), { county, basis: 'professional', validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', checkedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', ...extra });
    for (const [i, county] of DISCOVERY_COUNTY_KEYS.entries()) {
      const r = affiliation(`affiliation:county:${i}`, county);
      await storeRelation(r); assert.equal(discoveryAffiliationIsCurrentLocal(r, now), true); checks.push({ county, current: true });
    }
    const negatives = [affiliation('affiliation:outside', 'PA:Mercer'), affiliation('affiliation:outside2', 'NJ:Delaware'), affiliation('affiliation:unknown', null), affiliation('affiliation:expired', 'PA:Bucks', { expiresAt: '2026-11-14T12:00:00Z' }), affiliation('affiliation:unknown-end', 'PA:Bucks', { validUntil: null }), affiliation('affiliation:residence', 'PA:Bucks', { basis: 'residence' }), affiliation('affiliation:membership', 'PA:Bucks', { basis: 'membership' }), affiliation('affiliation:future-check', 'PA:Bucks', { checkedAt: '2026-11-15T00:00:00Z' }), affiliation('affiliation:retracted', 'PA:Bucks', { status: 'retracted' })];
    for (const r of negatives) { await storeRelation(r); assert.equal(discoveryAffiliationIsCurrentLocal(r, now), false); checks.push({ id: r.id, current: false }); }
    cases.AC05 = checks;
  });

  await t.test('AC-WP04-06: invalid endpoints, immutable rows, stale CAS and final-statement rollback', async () => {
    const rollbackCases: unknown[] = [];
    const unchanged = async (label: string, beforeImage: unknown) => {
      const after = await dump(); assert.deepEqual(after, beforeImage);
      rollbackCases.push({ label, before: beforeImage, after, identical: true });
    };
    const bad = relation('bad:endpoint', 'account-ownership', endpoint('person:one', 'person'), endpoint('publication:independent', 'artifact'));
    assert.equal(DiscoveryRelation.safeParse(bad).success, false);
    await registerDiscoveryDecisionReference(db, decision('bad:endpoint'));
    let before = await dump();
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO discovery_catalog_relation_families VALUES('bad:endpoint','account-ownership')"),
      db.prepare('INSERT INTO discovery_catalog_relation_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('bad:endpoint', 1, 'account-ownership', 'person:one', 1, 'person', 'publication:independent', 1, 'artifact', 'decision:bad:endpoint:1', 1, null, JSON.stringify(bad)),
    ]), /CHECK/);
    await unchanged('invalid endpoint kinds', before);
    // REPLACE implicitly deletes rows without DELETE triggers when SQLite's
    // recursive_triggers is off. Explicit insert guards must still preserve them.
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO discovery_catalog_entity_revisions SELECT id,revision,kind,json_set(payload_json,'$.displayName','Replacement') FROM discovery_catalog_entity_revisions WHERE id='person:one'").run(), /discovery-immutable/);
    await assert.rejects(db.prepare("INSERT OR REPLACE INTO discovery_catalog_entity_heads VALUES('person:one',1)").run(), /discovery-unguarded-head/);
    await unchanged('immutable revisions and heads reject REPLACE', before);
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('would:leak',1)"),
      db.prepare("UPDATE discovery_catalog_entity_revisions SET payload_json='{}' WHERE id='person:one'"),
    ]), /discovery-immutable/);
    await unchanged('immutable update rolls back preceding insert', before);
    await assert.rejects(db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('fractional:revision',1.5)").run(), /CHECK/);
    await assert.rejects(db.prepare('INSERT INTO discovery_catalog_aliases VALUES(?,?,?,?,?)').bind('missing:evidence', 'person:one', 'person', 'name', JSON.stringify({ id: 'missing:evidence', subject: { id: 'person:one', kind: 'person' }, value: 'name' })).run(), /CHECK/);
    await assert.rejects(db.prepare('INSERT INTO discovery_catalog_decision_refs VALUES(?,?,?)').bind('missing:evidence', 1, JSON.stringify({ id: 'missing:evidence', revision: 1, target: { kind: 'relationship', id: 'irrelevant', revision: 1 }, decision: 'accepted' })).run(), /CHECK/);
    await unchanged('fractional revisions and missing evidence rejected', before);
    for (const kind of ['artifact-version', 'equivalence']) {
      const id = `wrong:artifact-subtype:${kind}`;
      const incompatible = relation(id, kind, endpoint('repository:42', 'artifact', 2, 'repository'), endpoint('publication:independent', 'artifact'), kind === 'artifact-version' ? { version: 'v2' } : {});
      assert.equal(DiscoveryRelation.safeParse(incompatible).success, false);
      await registerDiscoveryDecisionReference(db, decision(id));
      const subtypeBefore = await dump();
      await assert.rejects(putDiscoveryRelation(db, { operationId: id, expectedRevision: null, relation: incompatible }));
      await unchanged(`${kind} application rejects incompatible artifact subtypes`, subtypeBefore);
      await assert.rejects(db.batch([
        db.prepare('INSERT INTO discovery_catalog_relation_families VALUES(?,?)').bind(id, kind),
        db.prepare('INSERT INTO discovery_catalog_relation_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, 1, kind, 'repository:42', 2, 'artifact', 'publication:independent', 1, 'artifact', `decision:${id}:1`, 1, null, JSON.stringify(incompatible)),
      ]), /discovery-incompatible-artifact-endpoints/);
      await unchanged(`${kind} SQL rejects incompatible artifact subtypes`, subtypeBefore);
    }
    await put(paper('publication:second-version'), 'create:second-version');
    await storeRelation(relation('publication:version-link', 'artifact-version', endpoint('publication:independent', 'artifact'), endpoint('publication:second-version', 'artifact'), { version: 'v2' }));
    await storeRelation(relation('publication:equivalence-link', 'equivalence', endpoint('publication:independent', 'artifact'), endpoint('publication:second-version', 'artifact')));
    assert.notEqual((await readDiscoveryEntity(db, 'publication:independent'))!.id, (await readDiscoveryEntity(db, 'publication:second-version'))!.id);
    // A concurrent winner advances the head. The stale writer's real batch must
    // roll back an earlier unrelated insert too; a zero-row UPDATE cannot pass.
    await put(person('person:one', 'Updated name', 2), 'advance:one', 1);
    before = await dump();
    const prefix: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('would:leak',1)"), ...statements]) };
    await assert.rejects(putDiscoveryEntity(prefix, { entity: person('person:one', 'Stale name', 2), operationId: 'stale:one', expectedRevision: 1 }), /discovery-stale-revision/);
    await unchanged('stale CAS rolls back preceding unrelated insert', before);
    const broken: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([...statements, db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('forced:failure',0)")]) };
    await assert.rejects(putDiscoveryEntity(broken, { entity: person('must:rollback'), operationId: 'final:failure', expectedRevision: null }), /CHECK/);
    await unchanged('final failure rolls back successful earlier statements', before);
    const winner = await Promise.allSettled([
      put(person('person:one', 'Concurrent A', 3), 'race:a', 2), put(person('person:one', 'Concurrent B', 3), 'race:b', 2),
    ]);
    assert.equal(winner.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(winner.filter(r => r.status === 'rejected').length, 1);
    assert.equal((await readDiscoveryEntity(db, 'person:one'))!.revision, 3);
    const abaName = (await readDiscoveryEntity(db, 'person:one'))!.displayName;
    await put(person('person:one', 'B', 4), 'aba:b', 3);
    await put(person('person:one', abaName, 5), 'aba:a', 4);
    assert.equal((await readDiscoveryEntity(db, 'person:one'))!.revision, 5);
    cases.AC06 = { rollbackCases, invalidEndpointAndImmutableBatchRolledBack: true, replaceCannotRewriteImmutableRowsOrHeads: true, staleBatchRolledBack: true, finalStatementFailureRolledBack: true, concurrentWinners: 1, abaHeadRevision: 5 };
  });
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual((await db.prepare('SELECT * FROM watch_subjects').all()).results, legacyRows);
  report.finalCounts = Object.fromEntries(await Promise.all(['entities', 'entity_revisions', 'provider_identities', 'observation_revisions', 'relation_revisions', 'aliases', 'operations'].map(async suffix => [suffix, await count(`discovery_catalog_${suffix}`)])));
  const evidenceDir = new URL('../.discovery-work/wp04/', import.meta.url);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(new URL('local-d1-results.json', evidenceDir), JSON.stringify(report, null, 2) + '\n');
});
