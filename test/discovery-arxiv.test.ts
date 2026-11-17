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
          provider?: 'arxiv';
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
          provider: 'arxiv',
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





const arxivEntry=(id='2401.00001v1',extra='')=>`<entry><id>http://arxiv.org/abs/${id}</id><updated>${id.endsWith('v1')?'2024-01-01':'2024-02-01'}T00:00:00Z</updated><published>2024-01-01T00:00:00Z</published><title>Synthetic preprint</title><summary>Synthetic abstract, untrusted source text.</summary><author><name>Alex Smith</name></author><author><name>Alex Smith</name></author><category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/><arxiv:primary_category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>${extra}</entry>`;
const arxivFeed=(entries:string[],total:number,start:number,scope:{searchQuery:string},pageSize=2)=>{const query=new URLSearchParams({search_query:scope.searchQuery,start:String(start),max_results:String(pageSize),sortBy:'submittedDate',sortOrder:'ascending'}).toString().replaceAll('&','&amp;');return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><id>http://example.test/synthetic</id><link rel="self" href="https://export.arxiv.org/api/query?${query}"/><title>Synthetic bounded query</title><updated>2024-02-01T00:00:00Z</updated><opensearch:totalResults>${total}</opensearch:totalResults><opensearch:startIndex>${start}</opensearch:startIndex><opensearch:itemsPerPage>${entries.length}</opensearch:itemsPerPage>${entries.join('')}</feed>`;};

test('AC06 actual D1 rate limit and exhausted request budget preserve incomplete coverage', {timeout:600_000},async t=>{
  for(const mode of ['rate-limit','budget'] as const)await t.test(mode,async sub=>{
    const f=await fixture(sub),s=await f.source(`arxiv-${mode}`,mode==='budget'?{maxRequests:1}:{});f.advance(31000);const store=f.makeStore();await f.makeRound(store,`round:${mode}`,`cohort:${mode}`,[s]);let sends=0;
    const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>{sends++;return new Response(null,{status:429,headers:{'Retry-After':'120'}})}}}}).step(f.stepInput(`round:${mode}`));
    assert.notEqual(result.kind,'page',JSON.stringify(result));assert.equal(sends,mode==='rate-limit'?1:0);
    if(mode==='rate-limit'){assert.equal(result.kind,'failure');if(result.kind==='failure')assert.equal(result.ack.outcome,'rate-limited');const hold=await f.db.prepare('SELECT next_attempt_at FROM discovery_source_backoff WHERE source_id=?').bind(s.value.id).first<{next_attempt_at:string}>();assert.ok(hold);assert.ok(Date.parse(hold!.next_attempt_at)>=Date.parse(f.now())+120000);}
    assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt,null);
    const chain=await f.db.prepare('SELECT status,checkpoint FROM discovery_collection_chains WHERE source_id=?').bind(s.value.id).first<any>();assert.notEqual(chain.status,'complete');assert.equal(chain.checkpoint,null);
  });
});

const arxivScopeInput={declaredId:'scope:synthetic-arxiv',revision:1,categories:['cs.AI'],terms:['synthetic health'],startDay:'2024-01-01',endDay:'2024-12-31',pageSize:2,maxPages:3,maxItems:6,denominator:'Synthetic bounded arXiv query'};
const arxivTemplate=(scope:{searchQuery:string},id:string,pageSize=2):DiscoveryEndpointTemplate=>({id,origin:'https://export.arxiv.org',path:'/api/query',fixed:{search_query:scope.searchQuery,max_results:String(pageSize),sortBy:'submittedDate',sortOrder:'ascending'},parameters:{start:{kind:'integer',min:0,max:100}},required:['start'],pageParameter:'start'});

test('AC01/03/04/05/06 arXiv-only three-page actual D1 chain and scoped removal', {timeout:600_000},async t=>{
  const {qualifyDiscoveryArxivScope,createDiscoveryArxivAdapter}=await import('../src/ingest/discovery/arxiv');
  const scope=await qualifyDiscoveryArxivScope(arxivScopeInput),f=await fixture(t),template=arxivTemplate(scope,'endpoint:arxiv-query');
  const s=await f.source('arxiv-query',{scopeId:scope.id,template,params:{start:'0'}});let store:ReturnType<typeof f.makeStore>,captured:any,provisional:any,issued:any,wrongQueryChecked=false;
  const resolvers={resolveSource:async(id:string)=>id===s.value.id?s.value:null,resolveScope:async(id:string)=>id===scope.id?scope:null,resolvePlan:(id:string)=>f.registry.resolvePlan(id),resolvePage:(id:string)=>store.resolvePage(id),resolveRepresentation:(r:{id:string;revision:number})=>f.registry.resolveRetainedRepresentation(r),resolveClaim:(id:string)=>store.resolveClaim(id),resolveChainPage:(id:string,n:number)=>store.resolveChainPage(id,n),now:f.now};
  const adapter=createDiscoveryArxivAdapter(resolvers);store=f.makeStore(f.db,async input=>{captured=structuredClone(input);issued=await f.registry.resolvePlan(input.request.budgetReservation.id);
    if(input.request.checkpoint&&!wrongQueryChecked){const bad={...issued,continuation:{...issued.continuation,querySha256:'0'.repeat(64)}};await assert.rejects(()=>createDiscoveryArxivAdapter({...resolvers,resolvePlan:async()=>bad}).parse(input));const expired={...issued,continuation:{...issued.continuation,expiresAt:at(f.now(),-1)}};await assert.rejects(()=>createDiscoveryArxivAdapter({...resolvers,resolvePlan:async()=>expired}).parse(input));wrongQueryChecked=true;}
    provisional=await adapter.inspect(input);return provisional.draft});f.advance(31000);
  assert.deepEqual((await adapter.plan(s.value.id)).parameters,{start:'0'});
  const extra='<arxiv:doi>10.1234/alpha</arxiv:doi><arxiv:journal_ref>Journal reference only</arxiv:journal_ref><rights>Unknown license</rights>';
  const bodies=[arxivFeed([arxivEntry('2401.00001',extra+'<link rel="alternate" href="http://arxiv.org/abs/2401.00001v2"/>'),arxivEntry('2401.00002v1')],5,0,scope),arxivFeed([arxivEntry('2401.00003v1'),arxivEntry('2401.00004v1')],5,2,scope),arxivFeed([arxivEntry('2401.00005v1')],5,4,scope)];
  const receipts:any[]=[],inputs:any[]=[],plans:any[]=[];let firstInput:any,firstPlan:any,firstProjection:any,sends=0;
  for(let page=0;page<3;page++){
    await f.makeRound(store,`round:arxiv:${page}`, 'cohort:arxiv',[s]);
    const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>{sends++;return new Response(bodies[page])}}}}).step(f.stepInput(`round:arxiv:${page}`));
    assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');receipts.push(result.receipt);inputs.push(structuredClone(captured));plans.push(structuredClone(issued));
    if(page===0){firstInput=structuredClone(captured);firstPlan=structuredClone(issued);firstProjection=structuredClone(provisional);}
    if(page<2){assert.equal(result.receipt.chainComplete,false);assert.equal(result.receipt.nextCheckpoint,String((page+1)*2));f.advance(1000);}else assert.equal(result.receipt.chainComplete,true);
  }
  assert.equal(sends,3);assert.equal(wrongQueryChecked,true);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<any>())?.n,0);
  const first=firstProjection.draft.leads[0],meta=firstProjection.metadata[0];assert.equal(first.nativeId,'2401.00001');assert.equal(first.sourceStage,'preprint');assert.equal(first.publicationAuthorized,false);
  assert.equal(meta.authors.length,2);assert.ok(meta.authors.every((a:any)=>a.personId===null&&a.currentEmploymentConfirmed===false&&a.affiliations.length===0));
  assert.ok(meta.holds.some((h:string)=>/regional|affiliation/.test(h)));assert.equal(meta.doiProposal.canonical,'10.1234/alpha');assert.equal(meta.publicationAuthorized,false);
  for(const hold of ['doi-target-unverified','cross-provider-equivalence-unverified','journal-reference-not-peer-review-evidence','license-not-admitted','preprint-stage-only'])assert.ok(meta.holds.includes(hold));
  assert.equal(meta.rightsStatement,'Unknown license');assert.ok(meta.licenseProposals.every((license:any)=>license.admitted===false));
  assert.deepEqual(first.sourceDates.map((d:any)=>d.field),['published','updated']);
  const sourceDates=structuredClone(first.sourceDates);assert.deepEqual((await adapter.replay(receipts[0].id)).draft.leads[0].sourceDates,sourceDates);
  const retained=await f.registry.resolveRetainedRepresentation(receipts[0].representation);assert.equal(new TextDecoder().decode(retained!.bytes),bodies[0]);
  assert.equal((await store.resolveChainPage(receipts[0].chainId,1))?.id,receipts[0].id);
  await assert.rejects(()=>adapter.plan(s.value.id,2,'page:forged'));
  const orig=await f.db.prepare('SELECT chain_id,payload_json FROM discovery_collection_pages WHERE id=?').bind(receipts[0].id).first<{chain_id:string;payload_json:string}>();assert.ok(orig);
  await f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind('chain:forged',receipts[0].id).run();assert.equal(await store.resolveChainPage('chain:forged',1),null);await assert.rejects(()=>adapter.replay(receipts[2].id));
  await f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind(orig!.chain_id,receipts[0].id).run();
  await f.db.prepare('UPDATE discovery_collection_pages SET payload_json=? WHERE id=?').bind('{}',receipts[0].id).run();await assert.rejects(()=>adapter.replay(receipts[2].id));
  await f.db.prepare('UPDATE discovery_collection_pages SET payload_json=? WHERE id=?').bind(orig!.payload_json,receipts[0].id).run();
  f.advance(60000);assert.deepEqual((await adapter.replay(receipts[0].id)).draft.leads[0].sourceDates,sourceDates);
  assert.deepEqual((await adapter.plan(s.value.id,2,receipts[0].id)).parameters,{start:'2'}); // Proposal only; no provider send.
  const noToken=(plan:any)=>{const copy=structuredClone(plan);delete copy.requestBindingToken;return copy;};
  const binary=(value:any)=>({...value,bytes:Array.from(value.bytes)});
  const representations=await Promise.all(receipts.map(r=>f.registry.resolveRetainedRepresentation(r.representation)));
  const claims=await Promise.all(receipts.map(r=>store.resolveClaim(r.claimId)));
  mkdirSync('.discovery-work/wp11-terra',{recursive:true});
  writeFileSync(`.discovery-work/wp11-terra/fixture-snapshot-${process.pid}.json`,JSON.stringify({scopeInput:arxivScopeInput,source:s.value,plans:plans.map(noToken),inputs:inputs.map(binary),receipts,representations:representations.map(binary),claims,now:f.now()},null,2)+'\n');
  const dumpBefore=JSON.stringify(await f.dump());assert.ok(dumpBefore.includes('2401.00001'));
  await f.evidence.revokeRetention(evidenceContext('revoke:arxiv'),{id:'revoke:arxiv',revision:1,rights:s.value.rights,policy:ref(s.ids.policy),reason:'Synthetic source withdrawal'});
  for(const r of receipts)assert.equal(await store.resolvePage(r.id),null);assert.equal(JSON.stringify(await f.dump()).includes('2401.00001'),false);await assert.rejects(()=>adapter.replay(receipts[0].id));
  void firstInput;void firstPlan;
});

test('EX16 identifier truth table preserves base, explicit version and bounded aliases',async()=>{
  const {normalizeDiscoveryArxivIdentifier:parse}=await import('../src/ingest/discovery/arxiv');
  const one=parse('http://arxiv.org/abs/2401.00001v1'),two=parse('https://arxiv.org/abs/2401.00001v2'),unversioned=parse('arXiv:2401.00001');
  assert.equal(one.baseId,'2401.00001');assert.equal(two.baseId,one.baseId);assert.equal(one.version,1);assert.equal(two.version,2);assert.equal(unversioned.version,null);
  for(const [variant,canonical] of [['math.CA/0611800v2','math/0611800'],['cs.AI/0611001v1','cs/0611001'],['nlin.CD/0611001v1','nlin/0611001'],['q-bio.CB/0611001v1','q-bio/0611001']] as const){const a=parse(variant);assert.equal(a.baseId,canonical);assert.ok(a.suppliedSubjectClass);}
  for(const invalid of ['2400.00001v1','2413.00001v1','1412.00001v1','1501.0001v1','0703.0001v1','1501.00000v1','2401.00001v0','astro-ph.GA/0611001v1','math.CA/0713001v1','math.CA/0611000v1','https://evil.invalid/abs/2401.00001v1','https://arxiv.org/abs/arxiv:2401.00001v1'])assert.throws(()=>parse(invalid),invalid);
});

test('AC02 actual D1 distinct v1/v2 and repeated v2 preserve one base without inferred person', {timeout:600_000},async t=>{
  const {qualifyDiscoveryArxivScope,createDiscoveryArxivAdapter}=await import('../src/ingest/discovery/arxiv');
  const scope=await qualifyDiscoveryArxivScope(arxivScopeInput),f=await fixture(t),template=arxivTemplate(scope,'endpoint:arxiv-versions');
  const s=await f.source('arxiv-versions',{scopeId:scope.id,template,params:{start:'0'}});let store:ReturnType<typeof f.makeStore>;
  const adapter=createDiscoveryArxivAdapter({resolveSource:async id=>id===s.value.id?s.value:null,resolveScope:async id=>id===scope.id?scope:null,resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),resolveClaim:id=>store.resolveClaim(id),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),now:f.now});
  store=f.makeStore(f.db,adapter.parser);const captures:any[]=[];
  for(const [i,id] of ['2401.00001v1','2401.00001v2','2401.00001v2','2401.00001'].entries()){
    f.advance(i?61000:31000);await f.makeRound(store,`round:version:${i}`,`cohort:version:${i}`,[s]);
    const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(arxivFeed([arxivEntry(id,i===3?'<link rel="alternate" href="http://arxiv.org/abs/2401.00001v2"/>':'')],1,0,scope))}}}).step(f.stepInput(`round:version:${i}`));
    assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('version page');captures.push(await adapter.replay(result.receipt.id));
  }
  const leads=captures.map(x=>x.draft.leads[0]);assert.deepEqual(leads.map(x=>x.nativeId),['2401.00001','2401.00001','2401.00001','2401.00001']);
  assert.notEqual(leads[0].sourceVersion,leads[1].sourceVersion);assert.equal(leads[1].sourceVersion,leads[2].sourceVersion);
  assert.equal(captures[3].metadata[0].version,2);assert.equal(captures[3].metadata[0].originalId,'http://arxiv.org/abs/2401.00001');assert.equal(captures[3].metadata[0].publicUrl,'https://arxiv.org/abs/2401.00001v2');
  assert.equal(captures[1].metadata[0].predecessorProposal.version,1);assert.equal(captures[1].metadata[0].predecessorProposal.verified,false);
  assert.ok(captures.every(x=>x.metadata[0].authors.every((a:any)=>a.personId===null)));assert.deepEqual(leads[1].sourceDates,leads[2].sourceDates);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<any>())?.n,0);
});

test('AC06 actual D1 rejects hostile Atom and leaves truncated results incomplete', {timeout:600_000},async t=>{
  const {qualifyDiscoveryArxivScope,createDiscoveryArxivAdapter}=await import('../src/ingest/discovery/arxiv');
  for(const mode of ['foreign-namespace','entity','mixed-title','truncated','wrong-start','missing-count','wrong-self','items-mismatch','conflicting-alternate','wrong-entry-namespace'] as const)await t.test(mode,async sub=>{
    const scope=await qualifyDiscoveryArxivScope(arxivScopeInput),f=await fixture(sub),template=arxivTemplate(scope,`endpoint:${mode}`);
    const s=await f.source(`arxiv-${mode}`,{scopeId:scope.id,template,params:{start:'0'}});let store:ReturnType<typeof f.makeStore>;
    const adapter=createDiscoveryArxivAdapter({resolveSource:async id=>id===s.value.id?s.value:null,resolveScope:async id=>id===scope.id?scope:null,resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),resolveClaim:id=>store.resolveClaim(id),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),now:f.now});
    store=f.makeStore(f.db,adapter.parser);f.advance(31000);await f.makeRound(store,`round:xml:${mode}`,`cohort:xml:${mode}`,[s]);
    let body=arxivFeed([arxivEntry()],mode==='truncated'?3:1,0,scope);
    if(mode==='wrong-entry-namespace')body=body.replace('<entry>','<opensearch:entry>').replace('</entry>','</opensearch:entry>');
    if(mode==='foreign-namespace')body=body.replace('xmlns="http://www.w3.org/2005/Atom"','xmlns="urn:foreign"');
    if(mode==='entity')body='<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+body;
    if(mode==='mixed-title')body=body.replace('Synthetic preprint','Synthetic <b>injected</b> title');
    if(mode==='conflicting-alternate')body=body.replace('</entry>','<link rel="alternate" href="http://arxiv.org/abs/2401.00001v2"/></entry>');
    if(mode==='items-mismatch')body=body.replace('<opensearch:itemsPerPage>1</opensearch:itemsPerPage>','<opensearch:itemsPerPage>2</opensearch:itemsPerPage>');
    if(mode==='wrong-start')body=body.replace('<opensearch:startIndex>0</opensearch:startIndex>','<opensearch:startIndex>2</opensearch:startIndex>');
    if(mode==='missing-count')body=body.replace(/<opensearch:totalResults>.*?<\/opensearch:totalResults>/,'');
    if(mode==='wrong-self')body=body.replace('export.arxiv.org/api/query?','evil.invalid/api/query?');
    const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(body)}}}).step(f.stepInput(`round:xml:${mode}`));
    if(mode==='mixed-title'||mode==='truncated'||mode==='conflicting-alternate'){assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');assert.equal(result.receipt.chainComplete,false);assert.ok(result.receipt.providerLimited||result.receipt.rejectedCount>0);}
    else assert.equal(result.kind,'failure',JSON.stringify(result));
    assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt,null);
  });
});

test('actual D1 changed totals and ancestry page/item caps stay incomplete', {timeout:600_000},async t=>{
  const {qualifyDiscoveryArxivScope,createDiscoveryArxivAdapter}=await import('../src/ingest/discovery/arxiv');
  for(const mode of ['changed-total','page-cap','item-cap'] as const)await t.test(mode,async sub=>{
    const scope=await qualifyDiscoveryArxivScope({...arxivScopeInput,...(mode==='page-cap'?{maxPages:1}:mode==='item-cap'?{maxItems:3}:{})}),f=await fixture(sub),template=arxivTemplate(scope,`endpoint:cap-${mode}`);
    const s=await f.source(`cap-${mode}`,{scopeId:scope.id,template,params:{start:'0'}});let store:ReturnType<typeof f.makeStore>;
    const adapter=createDiscoveryArxivAdapter({resolveSource:async id=>id===s.value.id?s.value:null,resolveScope:async id=>id===scope.id?scope:null,resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),resolveClaim:id=>store.resolveClaim(id),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),now:f.now});
    store=f.makeStore(f.db,adapter.parser);f.advance(31000);
    for(let page=0;page<(mode==='page-cap'?1:2);page++){
      await f.makeRound(store,`round:${mode}:${page}`,`cohort:${mode}`,[s]);
      const body=arxivFeed([arxivEntry(`2401.0000${page*2+1}v1`),arxivEntry(`2401.0000${page*2+2}v1`)],mode==='changed-total'&&page===1?6:5,page*2,scope);
      const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(body)}}}).step(f.stepInput(`round:${mode}:${page}`));
      assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');
      if(page===0&&mode!=='page-cap'){assert.equal(result.receipt.nextCheckpoint,'2');f.advance(1000);}else {assert.equal(result.receipt.chainComplete,false);assert.ok(result.receipt.providerLimited||result.receipt.rejectedCount>0);assert.equal(result.receipt.nextCheckpoint,null);assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt,null);}
    }
  });
});
