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
          provider?: 'pubmed';
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
          origin: 'https://eutils.ncbi.nlm.nih.gov',
          path: options.path ?? '/entrez/eutils/esearch.fcgi',
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
            parameters: options.params ?? { q: 'synthetic' },
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
          provider: 'pubmed',
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



test('AC02 legacy Wistar qualification stays bounded and cannot authorize another institution',async()=>{
  const {qualifyPublicationScope,publicationSearchUrl}=await import('../src/ingest/regional-publications');
  const body='The Wistar Institute is in Philadelphia, PA.', observedAt='2026-10-02T04:00:00Z';
  const citation={id:'ev-wistar-location',url:'https://www.wistar.org/news/',observedAt,sourcePublishedAt:null,representationSha256:sha(body),quote:body,representation:'normalized-text'};
  const inventory={schemaVersion:1,preparedAt:observedAt,collectionAuthorized:false,publicationAuthorized:false,institutions:[{id:'inst-regional-wistar',name:'The Wistar Institute',kind:'research-institute',existingInstitutionId:null,officialHosts:['www.wistar.org'],regionalScope:'core',evidenceIds:[citation.id],owner:'fixture'}],sources:[],evidence:[citation]};
  const scope=await qualifyPublicationScope(inventory,new Map([[citation.id,{url:citation.url,observedAt,body}]]));
  const plan={institutionId:'inst-regional-wistar' as const,startDay:'2026-09-01',endDay:'2026-10-02',limit:5};
  assert.ok(publicationSearchUrl(scope,plan).url.includes('esearch.fcgi'));
  for(const invalid of [{...plan,institutionId:'inst-other'},{...plan,limit:6},{...plan,offset:101},{...plan,startDay:'2025-01-01'}])assert.throws(()=>publicationSearchUrl(scope,invalid as typeof plan));
  assert.throws(()=>publicationSearchUrl(JSON.parse(JSON.stringify(scope)),plan));
});

const syntheticArticle=(id='12345',date='<Year>2021</Year>',title='Synthetic publication',affiliation='Example Institute, Philadelphia, PA',author='<LastName>Smith</LastName><ForeName>Alex</ForeName>')=>`<PubmedArticle><MedlineCitation><PMID Version="1">${id}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Journal><Title>Fixture Journal</Title><JournalIssue><PubDate>${date}</PubDate></JournalIssue></Journal><AuthorList><Author>${author}<AffiliationInfo><Affiliation>${affiliation}</Affiliation></AffiliationInfo></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1234/synthetic</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`;
const syntheticXml=(article=syntheticArticle())=>`<PubmedArticleSet>${article}</PubmedArticleSet>`;
const syntheticScopeInput=()=>{
  const body='Example Institute is located in Philadelphia, Pennsylvania.',observedAt='2026-10-02T04:00:00Z';
  const evidence={id:'ev-example-location',url:'https://example.edu/location',observedAt,sourcePublishedAt:null,representationSha256:sha(body),quote:body,representation:'normalized-text' as const};
  return {id:'scope-example',revision:1,institutionLiteral:'Example Institute',locationLiteral:'Philadelphia',county:'PA:Philadelphia' as const,searchLiteral:'Example Institute',startDay:'2020-01-01',endDay:'2020-03-01',pageSize:2,maxOffset:100,denominator:'Synthetic scoped publication query',institution:{id:'inst-example',name:'Example Institute',kind:'research-institute' as const,existingInstitutionId:null,officialHosts:['example.edu'],regionalScope:'core' as const,evidenceIds:[evidence.id],owner:'fixture'},evidence,retained:{url:evidence.url,observedAt,body}};
};

const pubmedTemplates=(term:string)=>({
  search:{id:'endpoint:pubmed-search',origin:'https://eutils.ncbi.nlm.nih.gov',path:'/entrez/eutils/esearch.fcgi',fixed:{db:'pubmed',retmode:'json',term,retmax:'2',sort:'pub date'},parameters:{retstart:{kind:'integer' as const,min:0,max:100}},required:['retstart']},
  fetch:{id:'endpoint:pubmed-fetch',origin:'https://eutils.ncbi.nlm.nih.gov',path:'/entrez/eutils/efetch.fcgi',fixed:{db:'pubmed',retmode:'xml'},parameters:{id:{kind:'text' as const,maxLength:100}},required:['id']},
});

test('AC02 generalized scope requires retained first-party region evidence and binds the institution and search literal',async()=>{
  const {qualifyDiscoveryPubmedScope}=await import('../src/ingest/discovery/pubmed');
  const input=syntheticScopeInput();const scope=await qualifyDiscoveryPubmedScope(input);
  assert.equal(scope.institution.id,'inst-example');assert.equal(scope.county,'PA:Philadelphia');
  await assert.rejects(()=>qualifyDiscoveryPubmedScope({...input,retained:{...input.retained,body:input.retained.body+'changed'}}));
  await assert.rejects(()=>qualifyDiscoveryPubmedScope({...input,institutionLiteral:'Other University'}));
  await assert.rejects(()=>qualifyDiscoveryPubmedScope({...input,searchLiteral:'Unrelated University'}));
  await assert.rejects(()=>qualifyDiscoveryPubmedScope({...input,institution:{...input.institution,name:'Different University'}}));
  await assert.rejects(()=>qualifyDiscoveryPubmedScope({...input,county:'PA:Bucks'}));
});

test('AC01/03/04/05/06 real D1 two-stage PubMed capture, quarantine and resume', {timeout:600_000},async t=>{
  const {createDiscoveryPubmedAdapter,qualifyDiscoveryPubmedScope}=await import('../src/ingest/discovery/pubmed');
  let scope=await qualifyDiscoveryPubmedScope(syntheticScopeInput()); const templates=pubmedTemplates(scope.term),f=await fixture(t);
  const search=await f.source('pubmed-search',{scopeId:scope.id,template:templates.search,params:{retstart:'0'}});
  const sources=new Map([[search.value.id,search.value]]);let store:ReturnType<typeof f.makeStore>,searchReceipt:string|null=null,captured:any;
  const resolvers={resolveSource:async(id:string)=>sources.get(id)??null,resolvePage:(id:string)=>store.resolvePage(id),resolveRepresentation:(r:{id:string;revision:number})=>f.registry.resolveRetainedRepresentation(r),resolveScope:async(id:string)=>id===scope.id?scope:null,searchReceiptForFetchSource:async()=>searchReceipt};
  let adapter=createDiscoveryPubmedAdapter(resolvers);store=f.makeStore(f.db,async input=>{captured=structuredClone(input);return adapter.parse(input)});
  let successfulSends=0;
  const collect=async(s:typeof search,tag:string,body:string)=>{f.advance(31000);await f.makeRound(store,`round:${tag}`,`cohort:${tag}`,[s]);return f.makeCollector(store,{transportOptions:{egress:{send:async()=>{successfulSends++;return new Response(body);}}}}).step(f.stepInput(`round:${tag}`));};
  assert.deepEqual((await adapter.searchPlan(search.value.id,0)).parameters,{retstart:'0'});
  const searchBody=JSON.stringify({esearchresult:{count:'1',retstart:'0',retmax:'2',idlist:['12345']}});
  const sr=await collect(search,'pubmed-search',searchBody);assert.equal(sr.kind,'page',JSON.stringify(sr));if(sr.kind!=='page')throw Error('search');
  const searchInput=structuredClone(captured);
  searchReceipt=sr.receipt.id;assert.equal(sr.receipt.chainComplete,false);assert.equal((await store.readHealth(search.value.id))?.lastCompleteAt,null);
  assert.deepEqual((await adapter.searchBinding(searchReceipt)).ids,['12345']);
  for(const bad of [
    {count:'2',retstart:'0',retmax:'2',idlist:['12345','12345']},
    {count:'5',retstart:'0',retmax:'2',idlist:['12345']},
    {count:'1',retstart:'2',retmax:'2',idlist:['12345']},
    {count:'1',retstart:'0',retmax:'2',idlist:['0001']},
  ]) {const body=bytes(JSON.stringify({esearchresult:bad}));await assert.rejects(()=>adapter.parse({...searchInput,bytes:body,representationSha256:sha(body)}));}
  const emptySearch={count:'0',retstart:'0',retmax:'2',idlist:[]};
  const searchDraft=async(result:unknown)=>{const body=bytes(JSON.stringify({esearchresult:result}));return adapter.parse({...searchInput,bytes:body,representationSha256:sha(body)});};
  const cleanEmpty=await searchDraft(emptySearch);assert.equal(cleanEmpty.terminal,true);assert.equal(cleanEmpty.leads.length,0);
  assert.equal((await searchDraft({...emptySearch,warninglist:{}})).terminal,true);
  for(const warninglist of [{quotedphrasesnotfound:['Example Institute']},'unknown-warning',[],{unknown:['provider diagnostic']}])
    await assert.rejects(()=>searchDraft({...emptySearch,warninglist}));
  for(const key of ['error','ERROR','ErrorList','warning','WarningList']) {
    const body=bytes(JSON.stringify({[key]:key.toLowerCase()==='warninglist'?{quotedphrasesnotfound:['Example Institute']}:'provider diagnostic',esearchresult:emptySearch}));
    await assert.rejects(()=>adapter.parse({...searchInput,bytes:body,representationSha256:sha(body)}));
    await assert.rejects(()=>searchDraft({...emptySearch,[key]:key.toLowerCase()==='warninglist'?{quotedphrasesnotfound:['Example Institute']}:'provider diagnostic'}));
  }
  const rootEmpty=bytes(JSON.stringify({WarningList:{},esearchresult:emptySearch}));assert.equal((await adapter.parse({...searchInput,bytes:rootEmpty,representationSha256:sha(rootEmpty)})).terminal,true);
  const badQuery={...searchInput.request,parameters:{...searchInput.request.parameters,term:'Unrelated'}};
  await assert.rejects(()=>adapter.parse({...searchInput,request:badQuery,requestSha256:sha(canonicalDiscoveryEvidenceJson(badQuery))}));
  // Qualification consumes the only request; collection must not send, and the
  // persisted search receipt remains available for a separately budgeted resume.
  const fetchId=await adapter.fetchSourceId(searchReceipt);
  const limited=await f.source('pubmed-fetch-limited',{sourceId:fetchId,scopeId:scope.id,template:templates.fetch,params:{id:'12345'},maxRequests:1});sources.set(limited.value.id,limited.value);
  f.advance(31000);await f.makeRound(store,'round:budget','cohort:budget',[limited]);let forbiddenSends=0;
  const exhausted=await f.makeCollector(store,{transportOptions:{egress:{send:async()=>{forbiddenSends++;return new Response(syntheticXml());}}}}).step(f.stepInput('round:budget'));
  assert.notEqual(exhausted.kind,'page',JSON.stringify(exhausted));assert.equal(forbiddenSends,0);assert.equal((await store.readHealth(limited.value.id))?.lastCompleteAt,null);
  const exhaustedBudget=await f.registry.readBudget(limited.value.budget.id);assert.equal(exhaustedBudget.requests,1);
  const priorScopeId=scope.id;scope=await qualifyDiscoveryPubmedScope(syntheticScopeInput());assert.equal(scope.id,priorScopeId);
  adapter=createDiscoveryPubmedAdapter(resolvers); // Restart from retained D1 and requalified evidence.
  assert.deepEqual((await adapter.searchBinding(searchReceipt)).ids,['12345']);
  f.advance(31000);
  const fetch=await f.source('pubmed-fetch',{sourceId:fetchId,revision:2,budgetWindowStart:BASE,scopeId:scope.id,template:templates.fetch,params:{id:'12345'}});sources.set(fetch.value.id,fetch.value);
  assert.deepEqual((await adapter.fetchPlan(searchReceipt,fetch.value.id)).requestedPmids,['12345']);
  assert.equal(fetch.value.id,limited.value.id);assert.notEqual(fetch.value.budget.id,limited.value.budget.id);assert.notEqual(fetch.value.budget.windowStart,limited.value.budget.windowStart);
  const sendsBeforeResume=successfulSends;
  const fr=await collect(fetch,'pubmed-fetch',syntheticXml());assert.equal(successfulSends-sendsBeforeResume,1);assert.deepEqual(await f.registry.readBudget(limited.value.budget.id),exhaustedBudget);assert.equal(fr.kind,'page',JSON.stringify(fr));if(fr.kind!=='page')throw Error('fetch');
  const rows=await f.db.prepare('SELECT payload_json FROM discovery_collection_leads WHERE page_id=?').bind(fr.receipt.id).all<{payload_json:string}>();const lead=JSON.parse(rows.results![0].payload_json);
  assert.equal(lead.nativeId,'12345');assert.equal(lead.kind,'artifact');assert.equal(lead.artifactKind,'publication');assert.equal(lead.publicationAuthorized,false);
  assert.equal(lead.sourceDates[0].date.precision,'year'); assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<any>())?.n,0);
  const fetchInput=structuredClone(captured);
  const changedIds={...captured.request,parameters:{id:'99999'}};
  await assert.rejects(()=>adapter.parse({...captured,request:changedIds,requestSha256:sha(canonicalDiscoveryEvidenceJson(changedIds))}));
  const parsed=await adapter.inspect(captured);assert.equal(parsed.metadata[0].authors[0].personId,null);assert.equal(parsed.metadata[0].currentEmploymentConfirmed,false);assert.equal(parsed.metadata[0].authors[0].affiliations[0].historicalRegionalCandidate,true);
  assert.equal(parsed.inventoryComplete,false);
  const withBody=async(body:string)=>adapter.inspect({...captured,bytes:bytes(body),representationSha256:sha(bytes(body))});
  for(const bad of [syntheticXml(syntheticArticle('99999')),syntheticXml(syntheticArticle()+syntheticArticle()),'<!DOCTYPE PubmedArticleSet [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+syntheticXml(),syntheticXml().replace('<PubmedArticleSet>','<PubmedArticleSet xmlns="urn:foreign">')]) await assert.rejects(()=>withBody(bad));
  const sensitive=await withBody(syntheticXml(syntheticArticle('12345','<Year>2021</Year><Month>02</Month>','Reach title@example.org','Example Institute, Philadelphia, PA contact@example.org','<LastName>name@example.org</LastName><ForeName>Alex</ForeName>')));
  assert.equal(sensitive.draft.leads[0].sourceDates[0].date.precision,'month');assert.doesNotMatch(JSON.stringify(sensitive),/title@example\.org|contact@example\.org|name@example\.org/);
  const duplicate=await withBody(syntheticXml(syntheticArticle().replace('</AuthorList>','<Author><LastName>Smith</LastName><ForeName>Alex</ForeName></Author></AuthorList>')));
  assert.equal(duplicate.metadata[0].authors.length,2);assert.ok(duplicate.metadata[0].authors.every((a:any)=>a.personId===null));
  for(const corrupt of [{...resolvers,resolvePage:async()=>null},{...resolvers,resolveRepresentation:async()=>null},{...resolvers,resolveRepresentation:async(r:{id:string;revision:number})=>{const v=await f.registry.resolveRetainedRepresentation(r);return v?{...v,bytes:bytes('{}')}:null}}])await assert.rejects(()=>createDiscoveryPubmedAdapter(corrupt).parse(captured));
  const changed=await withBody(syntheticXml(syntheticArticle().replace('</MedlineCitation>','<CommentsCorrectionsList><CommentsCorrections RefType="RetractionIn"><PMID>555</PMID></CommentsCorrections></CommentsCorrectionsList></MedlineCitation>')));
  assert.notEqual(changed.metadata[0].sourceVersion,parsed.metadata[0].sourceVersion);assert.equal(changed.metadata[0].correctionRelations[0].type,'RetractionIn');
  const missing=await withBody(syntheticXml(''));assert.equal(missing.fetchBatchComplete,false);assert.ok(missing.gaps.some((g:any)=>g.code==='missing-pmid'));assert.equal(missing.draft.terminal,false);
  const alternate=await f.source('pubmed-search-offset',{scopeId:scope.id,template:templates.search,params:{retstart:'2'}});sources.set(alternate.value.id,alternate.value);
  const alt=await collect(alternate,'pubmed-search-offset',JSON.stringify({esearchresult:{count:'3',retstart:'2',retmax:'2',idlist:['12345']}}));
  assert.equal(alt.kind,'page',JSON.stringify(alt));if(alt.kind!=='page')throw Error('alternate search');
  const originalReceipt=searchReceipt;searchReceipt=alt.receipt.id;
  assert.notEqual(await adapter.fetchSourceId(searchReceipt),fetchId);
  await assert.rejects(()=>adapter.parse(fetchInput));searchReceipt=originalReceipt;
  const retained=await f.registry.resolveRetainedRepresentation(sr.receipt.representation);
  mkdirSync('.discovery-work/wp09-terra',{recursive:true});
  writeFileSync('.discovery-work/wp09-terra/fixture-snapshot.json',JSON.stringify({scopeInput:syntheticScopeInput(),searchSource:search.value,fetchSource:fetch.value,searchReceipt:sr.receipt,searchRepresentation:{...retained,bytes:Array.from(retained!.bytes)},searchInput:{...searchInput,bytes:Array.from(searchInput.bytes)},fetchInput:{...fetchInput,bytes:Array.from(fetchInput.bytes)}},null,2)+'\n');
});
