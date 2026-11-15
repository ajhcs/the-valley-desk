import { makeDiscoveryDate } from '../src/content/discovery-schema';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import {
  createDiscoveryEvidenceStore,
  canonicalDiscoveryEvidenceJson,
} from '../src/ingest/discovery-evidence-store';
import {
  createDiscoverySourceRegistry,
  sourceConfigurationDigest,
  requestScopeDigest,
} from '../src/ingest/discovery/source-registry';
import { discoveryEndpointTemplateDigest } from '../src/ingest/discovery/endpoint';
import {
  DiscoveryRuntimeSource,
  type DiscoveryEndpointTemplate,
} from '../src/ingest/discovery/runtime-contract';
import { DiscoverySourcePage } from '../src/ingest/discovery/source-contract';
import {
  DISCOVERY_COLLECTION_VERSION,
  type DiscoveryCollectionParser,
  type DiscoveryCollectionLead,
  type DiscoveryPreparedCollectionPage,
} from '../src/ingest/discovery/collection-contract';
import { createDiscoveryCollectionStore } from '../src/ingest/discovery/collection-store';
import { createDiscoveryCollector } from '../src/ingest/discovery/collector';
import type {
  D1DatabaseLike,
  D1StatementLike,
} from '../src/ingest/persistence';

const BASE = '2030-01-01T00:00:00.000Z',
  EXPIRY = '2090-01-01T00:00:00.000Z';
const ref = (id: string, revision = 1) => ({ id, revision });
const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const at = (instant: string, ms: number) =>
  new Date(Date.parse(instant) + ms).toISOString();
let serial = 0;
const context = (label: string) => ({
  operationId: `test:${label}:${++serial}`,
  capabilityToken: 'synthetic-collection-capability',
});
const evidenceContext = (
  label: string,
  expectedRevision: number | null = null,
) => ({ ...context(label), expectedRevision });
const authority = async (_token: string, request: any) => ({
  receiptId: 'synthetic:receipt',
  principalId: 'synthetic:reviewer',
  authenticationContextId: 'synthetic:auth',
  minimalAuditRetention: 'allow' as const,
  expiresAt: EXPIRY,
  ...request,
});
const lead = (
  nativeId = 'native-one',
  displayName = 'Synthetic independent creator',
  extra: Partial<DiscoveryCollectionLead> = {},
): DiscoveryCollectionLead => ({
  nativeId,
  kind: 'person',
  displayName,
  relatedAccounts: [],
  unresolvedPeople: [],
  publicationAuthorized: false,
  sourceStage: 'profile',
  sourceDates: [],
  ...extra,
});
const pageBody = (
  options: {
    leads?: ReturnType<typeof lead>[];
    terminal?: boolean;
    nextCheckpoint?: string | null;
    rejectedCount?: number;
    truncated?: boolean;
    providerLimited?: boolean;
  } = {},
) =>
  JSON.stringify({
    leads: options.leads ?? [lead()],
    terminal: options.terminal ?? true,
    nextCheckpoint: options.nextCheckpoint ?? null,
    rejectedCount: options.rejectedCount ?? 0,
    truncated: options.truncated ?? false,
    providerLimited: options.providerLimited ?? false,
  });
const parser: DiscoveryCollectionParser = async (input) => {
  const body = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
  );
  return {
    schemaVersion: DISCOVERY_COLLECTION_VERSION,
    representationFormat: 'json',
    requestSha256: input.requestSha256,
    representationSha256: input.representationSha256,
    parser: input.parser,
    leads: body.leads,
    terminal: body.terminal,
    nextCheckpoint: body.nextCheckpoint,
    rejectedCount: body.rejectedCount,
    truncated: body.truncated,
    providerLimited: body.providerLimited,
  };
};


// Independent synthetic local D1 harness, adapted from accepted WP07 tests.
    async function fixture(sub: TestContext) {
      const proxy = await getPlatformProxy<{
        DISCOVERY_TEST_DB: D1DatabaseLike;
      }>({
        configPath: fileURLToPath(
          new URL('./fixtures/discovery-d1/wrangler.jsonc', import.meta.url),
        ),
        envFiles: [],
        persist: false,
        remoteBindings: false,
      });
      sub.after(() => proxy.dispose());
      const db = proxy.env.DISCOVERY_TEST_DB,
        migrations = new URL('../migrations/', import.meta.url);
      const names = readdirSync(migrations)
        .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < '0045')
        .sort();
      assert.equal(names.length, 44);
      for (const name of names)
        await db.batch(
          unstable_splitSqlQuery(
            readFileSync(new URL(name, migrations), 'utf8'),
          ).map((sql) => db.prepare(sql)),
        );
      let current = BASE;
      const now = () => current;
      const registry = createDiscoverySourceRegistry(db, {
        resolveCapability: authority,
        now,
      });
      const evidence = createDiscoveryEvidenceStore(db, {
        resolveCapability: authority,
        now,
      });
      const dump = async () => {
        const tables = (
          await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%' ORDER BY name",
            )
            .all<{ name: string }>()
        ).results!;
        const output: Record<string, unknown> = {};
        for (const { name } of tables)
          output[name] = (
            (await db.prepare(`SELECT * FROM ${name}`).all()).results ?? []
          ).sort((a, b) =>
            canonicalDiscoveryEvidenceJson(a).localeCompare(
              canonicalDiscoveryEvidenceJson(b),
            ),
          );
        return output;
      };
      async function source(
        tag: string,
        options: {
          maxRequests?: number;
          maxRetainedBytes?: number;
          maxResponseBytes?: number;
          maxItems?: number;
          maxWallTimeMs?: number;
          requiresAuth?: boolean;
          provider?: 'institutional';
          path?: string;
          scopeId?: string;
          sourceId?: string;
          revision?: number;
          budgetWindowStart?: string;
          template?: DiscoveryEndpointTemplate;
          params?: Record<string,string>;
          perPage?: number;
        } = {},
      ) {
        const ids = {
          enrollment: `enrollment:${tag}`,
          configuration: `configuration:${tag}`,
          parser: `parser:${tag}`,
          normalizer: `normalizer:${tag}`,
          permission: `permission:${tag}`,
          rights: `rights:${tag}`,
          policy: `policy:${tag}`,
          access: `access:${tag}`,
          display: `display:${tag}`,
        };
        for (const [kind, id, value] of [
          ['enrollment', ids.enrollment, 'active'],
          ['configuration', ids.configuration, 'synthetic-v1'],
          ['parser', ids.parser, 'text-or-json-v1'],
          ['normalizer', ids.normalizer, 'utf8-nfc-lf-v1'],
          ['policy', ids.policy, 'retention-policy'],
          ['policy', ids.access, 'source-access-authorized'],
          ['policy', ids.display, 'source-display-unassessed'],
        ] as const)
          await evidence.appendControl(evidenceContext(`seed:${id}`), {
            id,
            revision: 1,
            kind,
            value,
          });
        const template: DiscoveryEndpointTemplate = options.template ?? {
          id: `endpoint:${tag}`,
          origin: 'https://export.arxiv.org',
          path: options.path ?? '/api/query',
          fixed: options.perPage ? {per_page:String(options.perPage)} : {},
          parameters: {
            q: { kind: 'text', maxLength: 200 },
            page: { kind: 'integer', min: 1, max: 10 },
          },
          required: ['q'],
          pageParameter: 'page',
        };
        const scope = {
          kind: 'source-response' as const,
          sourceId: options.sourceId ?? `source:${tag}`,
          installation: `installation:${tag}`,
          scopeId: options.scopeId ?? `scope:${tag}`,
          enrollment: ref(ids.enrollment),
          configuration: ref(ids.configuration),
          endpointConstructor: template.id,
          endpointTemplateSha256:
            await discoveryEndpointTemplateDigest(template),
          requestScopeSha256: await requestScopeDigest({
            scopeId: options.scopeId ?? `scope:${tag}`,
            parameters: options.params ? Object.fromEntries(Object.entries(options.params).filter(([key])=>key!==template.pageParameter)) : { q: 'synthetic' },
            windowStart: options.budgetWindowStart ?? '2020-01-01T00:00:00Z',
            windowEnd: EXPIRY,
          }),
          material: 'metadata' as const,
        };
        await evidence.appendControl(
          evidenceContext(`seed:${ids.permission}`),
          {
            id: ids.permission,
            revision: 1,
            kind: 'permission',
            value: 'allow',
            permission: {
              enrollment: scope.enrollment,
              configuration: scope.configuration,
              materialScope: scope,
              fetch: true,
              retain: true,
              transform: true,
            },
          },
        );
        await evidence.appendControl(evidenceContext(`seed:${ids.rights}`), {
          id: ids.rights,
          revision: 1,
          kind: 'rights',
          value: 'allow',
          rights: { materialScope: scope, retain: true, transform: true },
        });
        const value = DiscoveryRuntimeSource.parse({
          id: scope.sourceId,
          revision: options.revision ?? 1,
          provider: 'institutional',
          installation: scope.installation,
          scopeId: scope.scopeId,
          enrollment: scope.enrollment,
          configuration: scope.configuration,
          permission: ref(ids.permission),
          rights: ref(ids.rights),
          parser: ref(ids.parser),
          normalizer: ref(ids.normalizer),
          materialScope: scope,
          endpointTemplate: template,
          requiresAuth: options.requiresAuth ?? false,
          ...(options.requiresAuth
            ? { credentialRef: `credential:${tag}` }
            : {}),
          engineeringOwnerId: 'synthetic:engineering',
          editorialOwnerId: 'synthetic:editorial',
          maintenanceOwnerId: 'synthetic:maintenance',
          credentialOwnerId: 'synthetic:credential-owner',
          accessDecision: ref(ids.access),
          displayRights: ref(ids.display),
          costs: {
            qualificationHours: 1,
            maintenanceHoursPerMonth: 1,
            accessChargeBasis:
              'Synthetic local fixture; actual provider costs unknown',
          },
          budget: {
            id: `budget:${tag}`,
            windowStart: options.budgetWindowStart ?? '2020-01-01T00:00:00Z',
            windowEnd: EXPIRY,
            maxRequests: options.maxRequests ?? 30,
            maxRetainedBytes: options.maxRetainedBytes ?? 200000,
            maxPages: 30,
            maxItems: options.maxItems ?? 1000,
            maxResponseBytes: options.maxResponseBytes ?? 4096,
            maxWallTimeMs: options.maxWallTimeMs ?? 30000,
          },
          expiresAt: EXPIRY,
        });
        await registry.enroll(context(`enroll:${tag}`), value);
        const grant = {
          id: `sample:${tag}`,
          sourceId: value.id,
          sourceRevision: value.revision,
          maxRequests: 1,
          expiresAt: EXPIRY,
        };
        await registry.authorizeSampling(context(`sample:${tag}`), grant);
        const priorLease=await db.prepare('SELECT id,fence FROM discovery_source_leases WHERE source_id=?').bind(value.id).first<{id:string;fence:number}>();
        const lease = await registry.acquireLease(
          context(`sample-lease:${tag}`),
          {
            id: priorLease?.id ?? `lease:${tag}`,
            sourceId: value.id,
            owner: 'synthetic:qualification-worker',
            expectedFence: priorLease?.fence ?? 0,
            expiresAt: at(current, 30000),
          },
        );
        const plan = await registry.issue(context(`sample-issue:${tag}`), {
          id: `plan:${tag}:sample`,
          sourceId: value.id,
          sourceRevision: value.revision,
          runId: `run:${tag}:sample`,
          purpose: 'qualification-sample',
          samplingGrantId: grant.id,
          parameters: options.params ?? { q: 'synthetic', page: '1' },
          checkpoint: null,
          lease: { id: lease.id, owner: lease.owner, fence: lease.fence },
          deadlineAt: at(current, options.maxWallTimeMs ?? 30000),
        });
        const acquired = await registry
          .createTransport({
            credentialResolver: async (_reference, context) => ({
              origin: context.origin,
              headers: {
                Authorization: 'Bearer synthetic-qualification-credential',
              },
              expiresAt: EXPIRY,
            }),
            clock: () => Date.parse(current),
            egress: {
              send: async () =>
                new Response(
                  JSON.stringify({
                    provider: 'institutional',
                    records: [
                      {
                        creatorId: 'sample-creator',
                        creatorKind: 'person',
                        displayName: 'Synthetic qualification sample',
                      },
                    ],
                    nextCheckpoint: null,
                    terminal: true,
                  }),
                ),
            },
          })
          .acquire(plan.id);
        assert.equal(acquired.ok, true);
        if (!acquired.ok) throw new Error(JSON.stringify(acquired));
        const store = registry.createEvidenceStore({
          resolveCapability: authority,
        });
        await store.appendIssuedSourceRequest(
          evidenceContext(`sample-issued:${tag}`),
          {
            id: plan.id,
            revision: 1,
            requestSha256: plan.requestSha256,
            materialScope: scope,
            actualEndpoint: plan.endpoint,
            originMemberId: plan.originMemberId,
            permission: value.permission,
            rights: value.rights,
            expiresAt: plan.retainedThrough,
            requestBindingToken: plan.requestBindingToken,
          },
        );
        const origin = {
          id: `origin:${tag}:sample`,
          revision: 1,
          status: 'provisional-source-response' as const,
          originalWorkId: null,
          materialScope: scope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          members: [plan.originMemberId],
          memberEndpoints: { [plan.originMemberId]: plan.endpoint },
          retentionRights: [value.rights],
          policy: ref(ids.policy),
          reason: 'Synthetic qualification sample',
          requestBindingToken: plan.requestBindingToken,
        };
        await store.appendOrigin(
          evidenceContext(`sample-origin:${tag}`),
          origin,
        );
        const representation = {
          id: `representation:${tag}:sample`,
          revision: 1,
          enrollment: value.enrollment,
          configuration: value.configuration,
          permission: value.permission,
          rights: value.rights,
          origin: ref(origin.id),
          originMemberId: plan.originMemberId,
          parser: value.parser,
          normalizer: value.normalizer,
          materialScope: scope,
          issuedRequest: ref(plan.id),
          requestSha256: plan.requestSha256,
          actualEndpoint: plan.endpoint,
          capturedAt: current,
          byteKind: 'captured-body-bytes' as const,
          format: 'json' as const,
          bytes: acquired.acquisition.bytes,
          requestBindingToken: plan.requestBindingToken,
        };
        await store.appendRepresentation(
          evidenceContext(`sample-capture:${tag}`),
          representation,
        );
        const qualificationId = `qualification:${tag}`;
        await registry.qualify(context(`qualify:${tag}`), {
          id: qualificationId,
          sourceId: value.id,
          sourceRevision: value.revision,
          installation: value.installation,
          configurationSha256: await sourceConfigurationDigest(value),
          parser: value.parser,
          permission: value.permission,
          rights: value.rights,
          accessDecision: value.accessDecision,
          displayRights: value.displayRights,
          engineeringOwnerId: value.engineeringOwnerId,
          editorialOwnerId: value.editorialOwnerId,
          reviewedAt: current,
          expiresAt: EXPIRY,
          samples: [
            {
              endpoint: plan.endpoint,
              representation: ref(representation.id),
              representationSha256: sha(acquired.acquisition.bytes),
            },
          ],
        });
        await registry.activate(context(`activate:${tag}`), {
          sourceId: value.id,
          sourceRevision: value.revision,
          qualificationId,
        });
        return {
          value,
          ids,
          scope,
          lease,
          qualificationId,
          parameters: options.params ?? { q: 'synthetic', page: '1' },
        };
      }
      const makeStore = (
        selectedDb: D1DatabaseLike = db,
        selectedParser: DiscoveryCollectionParser = parser,
      ) =>
        createDiscoveryCollectionStore(selectedDb, {
          resolveCapability: authority,
          resolveRegistryCapability: authority,
          resolveEvidenceCapability: authority,
          capabilityFor: async () => 'synthetic-runtime-capability',
          parser: selectedParser,
          now,
        });
      const makeCollector = (
        store: ReturnType<typeof makeStore>,
        options: Partial<Parameters<typeof createDiscoveryCollector>[0]> = {},
      ) =>
        createDiscoveryCollector({
          store,
          capabilityFor: async () => 'synthetic-collection-capability',
          clock: () => Date.parse(current),
          maxStepMs: 30000,
          cleanupMs: 1000,
          ...options,
        });
      const makeRound = (
        store: ReturnType<typeof makeStore>,
        id: string,
        cohortId: string,
        sources: Awaited<ReturnType<typeof source>>[],
        options: { maxPagesPerChain?: number; continuationTtlMs?: number } = {},
      ) =>
        store.createRound(context(`round:${id}`), {
          id,
          cohortId,
          sources: sources.map((s) => ({
            sourceId: s.value.id,
            parameters: s.parameters,
          })),
          maxPagesPerChain: options.maxPagesPerChain ?? 10,
          continuationTtlMs: options.continuationTtlMs ?? 60000,
        });
      const stepInput = (
        roundId: string,
        owner = 'worker:main',
        label = roundId,
        leaseMs = 60000,
        processingMs = 30000,
      ) => ({
        roundId,
        owner,
        claimOperationId: context(`claim:${label}`).operationId,
        expiresAt: at(current, leaseMs),
        processingDeadlineAt: at(current, processingMs),
      });
      return {
        db,
        registry,
        evidence,
        now,
        advance: (ms: number) => {
          current = at(current, ms);
        },
        setTime: (value: string) => {
          current = value;
        },
        source,
        dump,
        makeStore,
        makeCollector,
        makeRound,
        stepInput,
      };
    }






test('WP13 request budget is enforced before institutional egress', {timeout: 600_000}, async t => {
  const f = await fixture(t);
  const s = await f.source('institutional-budget', {maxRequests: 1});
  f.advance(31000);
  const store = f.makeStore();
  await f.makeRound(store, 'round:institutional-budget', 'cohort:institutional-budget', [s]);
  let sends = 0;
  const result = await f.makeCollector(store, {transportOptions: {
    clock: () => Date.parse(f.now()),
    egress: {send: async () => { sends++; return new Response(pageBody()); }},
  }}).step(f.stepInput('round:institutional-budget'));
  assert.notEqual(result.kind, 'page');
  assert.equal(sends, 0);
  assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt, null);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<{n:number}>())?.n, 0);
});

const retain = (tag: string, value: unknown) => {
  mkdirSync('.discovery-work/wp12-terra', {recursive:true});
  writeFileSync(`.discovery-work/wp12-terra/wp13-${tag}-${process.pid}.json`, JSON.stringify(value, null, 2)+'\n');
};
const institutionTemplate: DiscoveryEndpointTemplate = {
  id: 'endpoint:directory', origin: 'https://profiles.example.org', path: '/people',
  fixed: {}, parameters: {page: {kind: 'integer', min: 1, max: 10}},
  required: ['page'], pageParameter: 'page',
};
const classes = {
  record:'profile',name:'name',healthTechBasis:'health-tech-basis',
  affiliation:'affiliation',unit:'unit',county:'county',locationRole:'location-role',
  dateStart:'date-start',dateEnd:'date-end',currentThrough:'current-through',
  sourceDate:'source-date',creator:'creator',publisher:'publisher',adopter:'adopter',
  professionalId:'professional-id',
};
const institutionScope = {
  declaredId:'fixture:independent',revision:1,sourceFamily:'independent-professional' as const,
  recordKind:'person' as const,endpointTemplate:institutionTemplate,
  originUrl:'https://profiles.example.org/people',provenanceOriginId:'origin:profiles',
  pageSize:10,maxPages:10,maxItems:100,denominator:'Reviewed public directory members',
  rosterTotal:null,classes,startDay:'2020-01-01',endDay:'2031-01-01',dateBasis:'source-profile-date' as const,
};
const profile = (id: string, affiliation: string, extra = '') =>
  `<article class="profile" id="${id}"><h2 class="name">Jordan Vale</h2><p class="health-tech-basis">Designs clinical software.</p><time class="source-date" datetime="2029-06-01">2029-06-01</time>${affiliation}${extra}</article>`;
const unit = (county: string, role: string, dates: string) =>
  `<section class="affiliation"><span class="unit">Synthetic unit</span><span class="county">${county}</span><span class="location-role">${role}</span>${dates}</section>`;
const dateStart = '<time class="date-start" datetime="2028">2028</time>';
const currentThrough = '<time class="current-through" datetime="2031-01-01">2031-01-01</time>';

test('WP13 synthetic directory retains creator-first and temporal/location cases in D1', {timeout: 600_000}, async t => {
  const {qualifyDiscoveryInstitutionalScope, createDiscoveryInstitutionalAdapter} = await import('../src/ingest/discovery/institutional');
  const scope = await qualifyDiscoveryInstitutionalScope(institutionScope);
  const f = await fixture(t);
  const s = await f.source('institutional-directory', {scopeId: scope.id, template: institutionTemplate, params: {page:'1'}});
  let store: ReturnType<typeof f.makeStore>;
  const adapter = createDiscoveryInstitutionalAdapter({
    resolveSource: async (id: string) => id === s.value.id ? s.value : null,
    resolveScope: async (id: string) => id === scope.id ? scope : null,
    resolvePlan: (id: string) => f.registry.resolvePlan(id),
    resolvePage: (id: string) => store.resolvePage(id),
    resolveRepresentation: (r: {id:string;revision:number}) => f.registry.resolveRetainedRepresentation(r),
    resolveClaim: (id: string) => store.resolveClaim(id),
    resolveChainPage: (id: string, n: number) => store.resolveChainPage(id,n), now: f.now,
  });
  let inspected: any;
  store = f.makeStore(f.db, async input => { inspected = await adapter.inspect(input); return inspected.draft; });
  const local = unit('PA:Philadelphia', 'actual-unit', dateStart + currentThrough);
  const away = unit('PA:Philadelphia', 'headquarters', dateStart + currentThrough) + unit('PA:Lancaster', 'actual-unit', dateStart + currentThrough);
  const old = unit('PA:Philadelphia', 'actual-unit', dateStart + '<time class="date-end" datetime="2028-12-31">2028-12-31</time>');
  const unknown = unit('PA:Philadelphia', 'actual-unit', dateStart);
  const body = `<!doctype html><html><body>${profile('local',local)}${profile('away',away)}${profile('old',old)}${profile('unknown',unknown)}</body></html>`;
  f.advance(31000);
  await f.makeRound(store, 'round:institutional-directory', 'cohort:institutional-directory', [s]);
  let sends = 0;
  const result = await f.makeCollector(store, {transportOptions: {clock: () => Date.parse(f.now()), egress: {send: async () => {sends++; return new Response(body);}}}}).step(f.stepInput('round:institutional-directory'));
  assert.equal(result.kind, 'page', JSON.stringify(result));
  if (result.kind !== 'page') throw new Error(JSON.stringify(result));
  assert.equal(sends, 1);
  assert.equal(inspected.draft.leads.length, 4);
  assert.ok(inspected.draft.leads.every((lead: any) => lead.kind === 'person' && lead.publicationAuthorized === false));
  const [positive, outside, historical, unknownExpiry] = inspected.metadata;
  assert.equal(positive.affiliations[0].currentLocalSupported, true);
  assert.ok(outside.affiliations.every((a: any) => a.currentLocalSupported === false));
  assert.equal(historical.affiliations[0].temporalStatus, 'historic');
  assert.equal(unknownExpiry.affiliations[0].temporalStatus, 'unknown');
  assert.equal(historical.affiliations[0].currentLocalSupported, false);
  assert.equal(unknownExpiry.affiliations[0].currentLocalSupported, false);
  for (const record of inspected.metadata) for (const field of [record.name, record.healthTechBasis, record.sourceDate]) {
    assert.equal(body.slice(field.start, field.end), field.excerpt);
  }
  assert.ok(inspected.gaps.some((gap: any) => gap.code === 'roster-completeness-unknown'));
  assert.equal(inspected.coverage.complete, false);
  assert.equal(new TextDecoder().decode((await f.registry.resolveRetainedRepresentation(result.receipt.representation))!.bytes), body);
  assert.deepEqual((await adapter.replay(result.receipt.id)).draft, inspected.draft);
  assert.equal((await store.resolveChainPage(result.receipt.chainId, 1))?.id, result.receipt.id);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<{n:number}>())?.n, 0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_collection_pages').first<{n:number}>())?.n, 1);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_collection_leads').first<{n:number}>())?.n, 4);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_observation_revisions').first<{n:number}>())?.n, 0);
  f.setTime('2032-01-01T00:00:00.000Z');
  const later = await adapter.replay(result.receipt.id);
  assert.equal(later.metadata[0].affiliations[0].temporalStatus, 'historic');
  assert.equal(later.metadata[0].sourceVersion, positive.sourceVersion);
  await f.makeRound(store,'round:institutional-moved','cohort:institutional-moved',[s]);
  const movedBody = body.replace('<body>', '<body>   ');
  const moved = await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(movedBody)}}}).step(f.stepInput('round:institutional-moved'));
  assert.equal(moved.kind,'page',JSON.stringify(moved));
  assert.equal(inspected.metadata[0].sourceVersion,positive.sourceVersion);
  assert.notEqual(inspected.metadata[0].name.start,positive.name.start);
  retain('directory', {body,receipt:result.receipt,replayAfterExpiry:later,movedBody,moved,projection:inspected});
});

async function institutionalHarness(t: TestContext, tag: string, changes: Record<string, unknown> = {}) {
  const {qualifyDiscoveryInstitutionalScope, createDiscoveryInstitutionalAdapter} = await import('../src/ingest/discovery/institutional');
  const scope = await qualifyDiscoveryInstitutionalScope({...institutionScope, ...changes} as any);
  const f = await fixture(t);
  const s = await f.source(tag, {scopeId: scope.id, template: institutionTemplate, params:{page:'1'}});
  let store: ReturnType<typeof f.makeStore>, inspected: any;
  const inputs: any[] = [], plans: any[] = [], chainLookups: number[] = [];
  const adapter = createDiscoveryInstitutionalAdapter({
    resolveSource: async id => id === s.value.id ? s.value : null,
    resolveScope: async id => id === scope.id ? scope : null,
    resolvePlan: id => f.registry.resolvePlan(id), resolvePage: id => store.resolvePage(id),
    resolveRepresentation: r => f.registry.resolveRetainedRepresentation(r),
    resolveClaim: id => store.resolveClaim(id), resolveChainPage: (id,n) => {chainLookups.push(n); return store.resolveChainPage(id,n);}, now: f.now,
  });
  store = f.makeStore(f.db, async input => {
    inputs.push(structuredClone(input));
    plans.push(await f.registry.resolvePlan(input.request.budgetReservation.id));
    await assert.rejects(()=>adapter.inspect({...input,responseLink:'<https://attacker.example/path#token=headercanary>; rel=next'}));
    inspected = await adapter.inspect(input); return inspected.draft;
  });
  f.advance(31000);
  return {f,s,store,adapter,inputs,plans,chainLookups,scopeInput:{...institutionScope,...changes},inspect:()=>inspected};
}

test('association output preserves separate publisher and creator, and off-scope navigation stays inert', {timeout:600_000}, async t => {
  const h = await institutionalHarness(t, 'association-output', {sourceFamily:'association',recordKind:'output'});
  const body = `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="https://other.example.org/feed"></head><body><article class="profile" id="work"><h2 class="name">Synthetic guide</h2><p class="health-tech-basis">Clinical software guidance</p><time class="source-date" datetime="2029-06-01">2029-06-01</time><span class="publisher">Regional Association</span><span class="creator">Independent Designer</span></article></body></html>`;
  await h.f.makeRound(h.store, 'round:association', 'cohort:association', [h.s]);
  const requested: string[] = [];
  const result = await h.f.makeCollector(h.store, {transportOptions: {clock:()=>Date.parse(h.f.now()), egress:{send:async url=>{requested.push(url);return new Response(body);}}}}).step(h.f.stepInput('round:association'));
  assert.equal(result.kind,'page',JSON.stringify(result)); if(result.kind!=='page') throw Error('page missing');
  const view = h.inspect(), record = view.metadata[0];
  assert.deepEqual(record.relationships.map((r:any)=>[r.role,r.evidence.value,r.targetIdentity]), [['creator','Independent Designer',null],['publisher','Regional Association',null]]);
  assert.equal(view.draft.leads[0].publicationAuthorized,false);
  assert.equal(view.draft.leads[0].kind,'artifact');
  assert.ok(view.navigation.some((n:any)=>n.url==='https://other.example.org/feed' && n.requested===false));
  assert.deepEqual(requested,['https://profiles.example.org/people?page=1']);
  assert.ok(!requested.some(url=>url.includes('/feed')));
  assert.deepEqual((await h.adapter.replay(result.receipt.id)).metadata[0].relationships,record.relationships);
  retain('association',{body,requested,receipt:result.receipt,projection:view});
  assert.equal((await h.f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<{n:number}>())?.n,0);
});

test('private contact, script, and hidden content prevent whole response retention', {timeout:600_000}, async t => {
  for (const [name, extra] of [['contact','<p>private@example.org</p>'],['script','<script>secret</script>'],['hidden','<p hidden>secret</p>'],['entity-contact','<p>private&#64;example.org</p>'],['stylesheet','<link rel="stylesheet" href="https://styles.example.org/layout.css">'],['url-token','<a href="https://profiles.example.org/people?token=privatecanary">Link</a>'],['fragment','<a href="https://profiles.example.org/people#token=fragmentcanary">Link</a>']] as const) await t.test(name, async sub => {
    const h = await institutionalHarness(sub, `privacy-${name}`);
    const body = `<!doctype html><html><body>${profile('person',unit('PA:Philadelphia','actual-unit',dateStart+currentThrough))}${extra}</body></html>`;
    await h.f.makeRound(h.store, `round:privacy-${name}`, `cohort:privacy-${name}`, [h.s]);
    let sends = 0;
    const result = await h.f.makeCollector(h.store,{transportOptions:{clock:()=>Date.parse(h.f.now()),egress:{send:async()=>{sends++;return new Response(body);}}}}).step(h.f.stepInput(`round:privacy-${name}`));
    assert.equal(result.kind,'failure',JSON.stringify(result));
    if (result.kind === 'failure') assert.equal(result.ack.outcome, 'parser-failed');
    assert.equal(sends,1);
    assert.equal((await h.f.db.prepare('SELECT count(*) AS n FROM discovery_collection_pages').first<{n:number}>())?.n,0);
    assert.equal((await h.f.db.prepare('SELECT count(*) AS n FROM discovery_collection_leads').first<{n:number}>())?.n,0);
    const retainedDump = JSON.stringify(await h.f.dump());
    assert.equal(retainedDump.includes(body),false);
    for (const canary of ['private@example.org','private&#64;example.org','privatecanary','fragmentcanary','headercanary','styles.example.org']) assert.equal(retainedDump.includes(canary),false);
    assert.equal((await h.store.readHealth(h.s.value.id))?.lastCompleteAt,null);
    retain(`privacy-${name}`,{result,sends,health:await h.store.readHealth(h.s.value.id)});
  });
});

test('partial three-page directory preserves denominator gap and replay ancestry', {timeout:600_000}, async t => {
  const h = await institutionalHarness(t,'partial-directory',{rosterTotal:5});
  const local = unit('PA:Philadelphia','actual-unit',dateStart+currentThrough);
  const bodies = [
    `<!doctype html><html><body>${profile('a',local)}<a rel="next" href="https://profiles.example.org/people?page=2">Next</a></body></html>`,
    `<!doctype html><html><body>${profile('a',local)}<a rel="next" href="https://profiles.example.org/people?page=3">Next</a></body></html>`,
    `<!doctype html><html><body>${profile('a',local)}</body></html>`,
  ];
  const receipts:any[]=[]; let sends=0, finalView:any;
  for(let page=0;page<3;page++) {
    await h.f.makeRound(h.store,`round:partial-${page}`,'cohort:partial',[h.s]);
    const result=await h.f.makeCollector(h.store,{transportOptions:{clock:()=>Date.parse(h.f.now()),egress:{send:async()=>new Response(bodies[sends++])}}}).step(h.f.stepInput(`round:partial-${page}`));
    assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');
    receipts.push(result.receipt);finalView=h.inspect();h.f.advance(1000);
  }
  assert.equal(sends,3);assert.ok(receipts.every(r=>r.chainComplete===false));
  assert.equal(finalView.coverage.rosterTotal,5);assert.equal(finalView.consumedItems,3);
  assert.ok(finalView.gaps.some((g:any)=>g.code==='roster-denominator-mismatch'));
  assert.equal(finalView.coverage.complete,false);
  h.chainLookups.length=0;
  assert.equal((await h.adapter.replay(receipts[2].id)).consumedItems,3);
  assert.ok(h.chainLookups.includes(1), 'third-page replay resolves first ancestor by chain ordinal');
  const original=await h.f.db.prepare('SELECT chain_id FROM discovery_collection_pages WHERE id=?').bind(receipts[0].id).first<{chain_id:string}>();
  assert.ok(original);
  await h.f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind('chain:corrupt',receipts[0].id).run();
  await assert.rejects(()=>h.adapter.replay(receipts[2].id));
  await h.f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind(original.chain_id,receipts[0].id).run();
  assert.equal((await h.adapter.replay(receipts[2].id)).consumedItems,3);
  const firstId=(await h.adapter.replay(receipts[0].id)).draft.leads[0].nativeId;
  const secondId=(await h.adapter.replay(receipts[1].id)).draft.leads[0].nativeId;
  const thirdId=finalView.draft.leads[0].nativeId;
  assert.equal(firstId,'https://profiles.example.org/people?page=1#a');
  assert.equal(secondId,'https://profiles.example.org/people?page=2#a');
  assert.equal(thirdId,'https://profiles.example.org/people?page=3#a');
  assert.equal(new Set([firstId,secondId,thirdId]).size,3);
  assert.equal((await h.f.db.prepare('SELECT count(*) AS n FROM discovery_collection_pages').first<{n:number}>())?.n,3);
  assert.equal((await h.store.readHealth(h.s.value.id))?.lastCompleteAt,null);
  const representations=await Promise.all(receipts.map(r=>h.f.registry.resolveRetainedRepresentation(r.representation)));
  const claims=await Promise.all(receipts.map(r=>h.store.resolveClaim(r.claimId)));
  const noToken=(plan:any)=>{const copy=structuredClone(plan);delete copy.requestBindingToken;return copy;};
  const binary=(value:any)=>({...value,bytes:Array.from(value.bytes)});
  retain('truth-snapshot',{scopeInput:h.scopeInput,source:h.s.value,plans:h.plans.map(noToken),inputs:h.inputs.map(binary),receipts,representations:representations.map(binary),claims,now:h.f.now()});
  retain('partial-directory',{bodies,receipts,finalView,sends,corruptFirstAncestorRejected:true,chainLookups:h.chainLookups});
});

test('identical mirrored biographies require a reviewed D1 origin ledger', {timeout:600_000},async t=>{
  const f=await fixture(t),store=f.evidence;
  const {createDiscoveryInstitutionalAdapter}=await import('../src/ingest/discovery/institutional');
  const adapter=createDiscoveryInstitutionalAdapter({resolveSource:async()=>null,resolveScope:async()=>null,
    resolvePlan:async()=>{throw Error('unused')},resolvePage:async()=>null,resolveRepresentation:async()=>null,
    resolveClaim:async()=>{throw Error('unused')},resolveChainPage:async()=>null,
    distinctOriginCount:refs=>store.distinctOriginCount(refs),now:f.now});
  const materialScope={kind:'artifact' as const,artifactId:'artifact:biography',artifactVersion:'v1',material:'text' as const};
  for(const [kind,id,value] of [['enrollment','enrollment:mirror','active'],['configuration','configuration:mirror','v1'],['parser','parser:mirror','text-or-json-v1'],['normalizer','normalizer:mirror','utf8-nfc-lf-v1'],['policy','policy:mirror','v1']] as const)
    await store.appendControl(evidenceContext(`seed:${id}`),{id,revision:1,kind,value});
  await store.appendControl(evidenceContext('mirror:permission'),{id:'permission:mirror',revision:1,kind:'permission',value:'allow',permission:{enrollment:ref('enrollment:mirror'),configuration:ref('configuration:mirror'),materialScope,fetch:true,retain:true,transform:true}});
  await store.appendControl(evidenceContext('mirror:rights'),{id:'rights:mirror',revision:1,kind:'rights',value:'allow',rights:{materialScope,retain:true,transform:true}});
  const members=['member:original','member:mirror'], endpoints={'member:original':'https://source.example.org/bio','member:mirror':'https://mirror.example.org/bio'};
  const origin=(id:string,work:string,which:string[],revision=1)=>({id,revision,originalWorkId:work,members:which,memberEndpoints:Object.fromEntries(which.map(m=>[m,endpoints[m as keyof typeof endpoints]])),retentionRights:[ref('rights:mirror')],policy:ref('policy:mirror'),reason:'Synthetic reviewed biography origin',...(which.length?{}:{retired:true})});
  await store.appendOrigin(evidenceContext('origin:original'),origin('origin:original','work:original',[members[0]]));
  await store.appendOrigin(evidenceContext('origin:mirror'),origin('origin:mirror','work:mirror',[members[1]]));
  const capture=async(tag:string,member:string,originId:string,revision:number)=>{
    const body='Jordan Vale designs clinical software.';
    const representation={id:`representation:${tag}`,revision:1,enrollment:ref('enrollment:mirror'),configuration:ref('configuration:mirror'),permission:ref('permission:mirror'),rights:ref('rights:mirror'),origin:ref(originId,revision),parser:ref('parser:mirror'),normalizer:ref('normalizer:mirror'),materialScope,originMemberId:member,actualEndpoint:endpoints[member as keyof typeof endpoints],capturedAt:BASE,byteKind:'captured-body-bytes' as const,format:'text' as const,bytes:bytes(body)};
    await store.appendRepresentation(evidenceContext(`capture:${tag}`),representation);
    await store.appendEvidence(evidenceContext(`evidence:${tag}`),{id:`evidence:${tag}`,revision:1,representation:ref(representation.id),selector:{kind:'text-span',start:0,end:body.length,quote:body}});
    return ref(`evidence:${tag}`);
  };
  const before=[await capture('original-before',members[0],'origin:original',1),await capture('mirror-before',members[1],'origin:mirror',1)];
  const beforeCount=await adapter.distinctReviewedOriginCount(before);assert.equal(beforeCount,2);
  await store.appendOrigin(evidenceContext('retire:mirror',1),origin('origin:mirror','work:mirror',[],2));
  await store.appendOrigin(evidenceContext('review:original',1),origin('origin:original','work:original',members,2));
  const after=[await capture('original-reviewed',members[0],'origin:original',2),await capture('mirror-reviewed',members[1],'origin:original',2)];
  const afterCount=await adapter.distinctReviewedOriginCount(after);assert.equal(afterCount,1);
  assert.equal((await store.readRevision('origin','origin:original',2))?.usable,true);
  retain('origin-ledger',{before,after,beforeCount,afterCount,review:await store.readRevision('origin','origin:original',2)});
});


test('guessed and off-origin endpoints fail the exact reviewed grammar', async () => {
  const {validateDiscoveryEndpoint} = await import('../src/ingest/discovery/endpoint');
  assert.equal(await validateDiscoveryEndpoint(institutionTemplate, 'https://profiles.example.org/people?page=1'), 'https://profiles.example.org/people?page=1');
  await assert.rejects(()=>validateDiscoveryEndpoint(institutionTemplate, 'https://profiles.example.org/feed'));
  await assert.rejects(()=>validateDiscoveryEndpoint(institutionTemplate, 'https://other.example.org/people?page=1'));
});
