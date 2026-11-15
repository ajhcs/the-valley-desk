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
          provider?: 'crossref';
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
          origin: 'https://api.crossref.org',
          path: options.path ?? '/works',
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
          provider: 'crossref',
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




test('AC05 reviewed Crossref/PubMed origin equivalence uses actual D1 evidence ledger', {timeout:600_000},async t=>{
  const f=await fixture(t),store=f.evidence;
  const artifactScope={kind:'artifact' as const,artifactId:'artifact:synthetic-paper',artifactVersion:'v1',material:'text' as const};
  for(const [kind,id,value] of [['enrollment','enrollment:ledger','active'],['configuration','configuration:ledger','v1'],['parser','parser:ledger','text-or-json-v1'],['normalizer','normalizer:ledger','utf8-nfc-lf-v1'],['policy','policy:ledger','v1']] as const)
    await store.appendControl(evidenceContext(`seed:${id}`),{id,revision:1,kind,value});
  await store.appendControl(evidenceContext('seed:permission'),{id:'permission:ledger',revision:1,kind:'permission',value:'allow',permission:{enrollment:ref('enrollment:ledger'),configuration:ref('configuration:ledger'),materialScope:artifactScope,fetch:true,retain:true,transform:true}});
  await store.appendControl(evidenceContext('seed:rights'),{id:'rights:ledger',revision:1,kind:'rights',value:'allow',rights:{materialScope:artifactScope,retain:true,transform:true}});
  const members=['member:crossref','member:pubmed'];
  const endpoints={'member:crossref':'https://example.test/crossref','member:pubmed':'https://example.test/pubmed'};
  const origin=(id:string,work:string,which:string[],revision=1)=>({id,revision,originalWorkId:work,members:which,memberEndpoints:Object.fromEntries(which.map(m=>[m,endpoints[m as keyof typeof endpoints]])),retentionRights:[ref('rights:ledger')],policy:ref('policy:ledger'),reason:'Synthetic explicitly reviewed origin equivalence',...(which.length?{}:{retired:true})});
  await store.appendOrigin(evidenceContext('origin:crossref'),origin('origin:crossref','work:crossref',[members[0]]));
  await store.appendOrigin(evidenceContext('origin:pubmed'),origin('origin:pubmed','work:pubmed',[members[1]]));
  const capture=async(tag:string,member:string,originId:string,originRevision:number)=>{
    const body=member==='member:crossref'?'Crossref synthetic DOI 10.1234/alpha':'PubMed synthetic PMID 12345 DOI 10.1234/alpha';const endpoint=endpoints[member as keyof typeof endpoints];
    const representation={id:`representation:${tag}`,revision:1,enrollment:ref('enrollment:ledger'),configuration:ref('configuration:ledger'),permission:ref('permission:ledger'),rights:ref('rights:ledger'),origin:ref(originId,originRevision),parser:ref('parser:ledger'),normalizer:ref('normalizer:ledger'),materialScope:artifactScope,originMemberId:member,actualEndpoint:endpoint,capturedAt:BASE,byteKind:'captured-body-bytes' as const,format:'text' as const,bytes:bytes(body)};
    await store.appendRepresentation(evidenceContext(`capture:${tag}`),representation);
    await store.appendEvidence(evidenceContext(`evidence:${tag}`),{id:`evidence:${tag}`,revision:1,representation:ref(representation.id),selector:{kind:'text-span',start:0,end:body.length,quote:body}});
    return ref(`evidence:${tag}`);
  };
  const before=[await capture('crossref-before',members[0],'origin:crossref',1),await capture('pubmed-before',members[1],'origin:pubmed',1)];
  assert.equal(await store.distinctOriginCount(before),2,'independent origins must not be inferred equivalent merely by DOI');
  await store.appendOrigin(evidenceContext('origin:pubmed-retire',1),origin('origin:pubmed','work:pubmed',[],2));
  await store.appendOrigin(evidenceContext('origin:crossref-reviewed',1),origin('origin:crossref','work:crossref',members,2));
  const after=[await capture('crossref-reviewed',members[0],'origin:crossref',2),await capture('pubmed-reviewed',members[1],'origin:crossref',2)];
  assert.equal(await store.distinctOriginCount(after),1);
  const ledger=await store.readRevision('origin','origin:crossref',2);assert.equal(ledger?.usable,true);
  // A provider page starts as provisional; identical metadata alone cannot
  // become independent-origin support until a reviewed work origin exists.
  const s=await f.source('provisional');f.advance(31000);const collection=f.makeStore();await f.makeRound(collection,'round:provisional','cohort:provisional',[s]);
  const captured=await f.makeCollector(collection,{transportOptions:{egress:{send:async()=>new Response(pageBody())}}}).step(f.stepInput('round:provisional'));
  assert.equal(captured.kind,'page',JSON.stringify(captured));if(captured.kind!=='page')throw Error('page');
  await store.appendEvidence(evidenceContext('provisional-evidence'),{id:'evidence:provisional',revision:1,representation:captured.receipt.representation,selector:{kind:'json-pointer',pointer:'/leads/0/displayName',value:'Synthetic independent creator'}});
  await assert.rejects(()=>store.distinctOriginCount([ref('evidence:provisional')]));
});

const crossrefItem=(doi='10.1234/Alpha')=>({DOI:doi,title:['Synthetic study'],type:'journal-article',author:[{given:'Alex',family:'Smith'},{given:'Alex',family:'Smith'}],'published-online':{'date-parts':[[2020]]},'published-print':{'date-parts':[[2021,3]]},indexed:{'date-parts':[[2030,1,1]]},deposited:{'date-parts':[[2029,12,31]]}});
const crossrefBody=(items:unknown[],total=items.length,cursor?:unknown)=>JSON.stringify({status:'ok','message-type':'work-list',message:{'total-results':total,'items-per-page':2,items,...(cursor===undefined?{}:{'next-cursor':cursor})}});
const crossrefScopeInput={declaredId:'scope:synthetic-crossref',revision:1,queryKind:'work' as const,queryLiteral:'synthetic health technology',startDay:'2020-01-01',endDay:'2020-12-31',pageSize:2,maxPages:3,maxItems:6,denominator:'Synthetic bounded work query'};

test('AC02 bounded DOI spelling variants retain one identity without lossy URL decoding',async()=>{
  const {normalizeDiscoveryCrossrefDoi}=await import('../src/ingest/discovery/crossref');
  const variants=['10.1234/Alpha','doi:10.1234/ALPHA','https://doi.org/10.1234/alpha'];
  const values=variants.map(normalizeDiscoveryCrossrefDoi);
  assert.deepEqual(values.map(v=>v.originalDoi),variants);
  assert.deepEqual(values.map(v=>v.canonicalDoi),['10.1234/alpha','10.1234/alpha','10.1234/alpha']);
  assert.ok(values.every(v=>v.publicDoiUrl==='https://doi.org/10.1234/alpha'));
  for(const invalid of ['10.1234/alpha%2Fbeta','https://doi.org/10.1234/alpha?redirect=evil','https://doi.org/10.1234/alpha#frag','https://evil.invalid/10.1234/alpha','10.1234/../alpha','10.1234/é','10.1234/alpha beta','10.1234/x\u0000']) assert.throws(()=>normalizeDiscoveryCrossrefDoi(invalid));
});

test('AC01/03/04/06 Crossref-only actual D1 receipts, dates, holds and cursor replay', {timeout:600_000},async t=>{
  const {createDiscoveryCrossrefAdapter,qualifyDiscoveryCrossrefScope}=await import('../src/ingest/discovery/crossref');
  const scope=await qualifyDiscoveryCrossrefScope(crossrefScopeInput),f=await fixture(t);
  const template:DiscoveryEndpointTemplate={id:'endpoint:crossref-query',origin:'https://api.crossref.org',path:'/works',fixed:{query:scope.queryLiteral,filter:scope.filter,rows:'2'},parameters:{cursor:{kind:'token',maxLength:512}},required:['cursor'],pageParameter:'cursor'};
  const s=await f.source('crossref-query',{scopeId:scope.id,template,params:{cursor:'*'}});let store:ReturnType<typeof f.makeStore>,captured:any,issued:any,provisional:any,wrongQueryChecked=false;
  const resolvers={resolveSource:async(id:string)=>id===s.value.id?s.value:null,resolveScope:async(id:string)=>id===scope.id?scope:null,resolvePlan:(id:string)=>f.registry.resolvePlan(id),resolvePage:(id:string)=>store.resolvePage(id),resolveRepresentation:(r:{id:string;revision:number})=>f.registry.resolveRetainedRepresentation(r),resolveChainPage:(chainId:string,ordinal:number)=>store.resolveChainPage(chainId,ordinal),resolveClaim:(id:string)=>store.resolveClaim(id),now:f.now};
  const adapter=createDiscoveryCrossrefAdapter(resolvers);store=f.makeStore(f.db,async input=>{captured=structuredClone(input);issued=await f.registry.resolvePlan(input.request.budgetReservation.id);
    if(input.request.checkpoint && !wrongQueryChecked){const altered={...issued,continuation:{...issued.continuation,querySha256:'0'.repeat(64)}};await assert.rejects(()=>createDiscoveryCrossrefAdapter({...resolvers,resolvePlan:async()=>altered}).parse(input));wrongQueryChecked=true;}
    provisional=await adapter.inspect(input);return provisional.draft});f.advance(31000);
  assert.deepEqual((await adapter.plan(s.value.id)).parameters,{cursor:'*'});
  const firstBody=crossrefBody([crossrefItem(),{...crossrefItem('10.1234/ALPHA'),title:['Changed metadata']}],4,'cursor-page-2');
  await f.makeRound(store,'round:crossref:1','cohort:crossref',[s]);let sends=0;
  const first=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>{sends++;return new Response(firstBody)}}}}).step(f.stepInput('round:crossref:1'));
  assert.equal(first.kind,'page',JSON.stringify(first));if(first.kind!=='page')throw Error('first page');const firstInput=structuredClone(captured),firstPlan=structuredClone(issued);
  assert.equal(first.receipt.leadCount,2);assert.equal(first.receipt.chainComplete,false);assert.equal(first.receipt.nextCheckpoint,'cursor-page-2');
  const retained=await f.registry.resolveRetainedRepresentation(first.receipt.representation);assert.equal(new TextDecoder().decode(retained!.bytes),firstBody);
  const parsed=provisional, lead=parsed.draft.leads[0],metadata=parsed.metadata[0];
  // Detached parser challenges below use the exact plan captured while in flight.
  const replay=createDiscoveryCrossrefAdapter({...resolvers,resolvePlan:async id=>id===issued.id?issued:resolvers.resolvePlan(id)});
  assert.equal(lead.nativeId,'10.1234/alpha');assert.equal(lead.artifactKind,'publication');assert.equal(lead.publicationAuthorized,false);
  assert.deepEqual(lead.sourceDates.map((d:any)=>[d.field,d.date.precision]),[['published-online','year'],['published-print','month']]);
  assert.deepEqual(metadata.metadataDates.map((d:any)=>d.field),['deposited','indexed']);
  assert.equal(metadata.contributors.length,2);assert.ok(metadata.contributors.every((a:any)=>a.personId===null&&!a.currentEmploymentConfirmed&&a.affiliations.length===0));
  assert.equal(parsed.draft.leads[1].nativeId,lead.nativeId);assert.notEqual(parsed.draft.leads[1].sourceVersion,lead.sourceVersion);assert.ok(parsed.metadata[1].holds.includes('contradictory-metadata-review-required'));
  assert.ok(metadata.holds.includes('regional-attribution-unverified'));assert.ok(metadata.holds.includes('affiliation-unknown'));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<any>())?.n,0);
  await f.evidence.appendEvidence(evidenceContext('crossref-provisional'),{id:'evidence:crossref-provisional',revision:1,representation:first.receipt.representation,selector:{kind:'json-pointer',pointer:'/message/items/0/DOI',value:'10.1234/Alpha'}});
  await assert.rejects(()=>f.evidence.distinctOriginCount([ref('evidence:crossref-provisional')]));
  assert.deepEqual((await adapter.replay(first.receipt.id)).metadata,parsed.metadata);
  for(const clock of ['not-a-date','2029-01-01T00:00:00Z'])await assert.rejects(()=>createDiscoveryCrossrefAdapter({...resolvers,now:()=>clock}).nextPage(first.receipt.id));
  await assert.rejects(()=>createDiscoveryCrossrefAdapter({...resolvers,resolveClaim:async id=>({...await store.resolveClaim(id),expiresAt:'invalid'})}).nextPage(first.receipt.id));
  assert.equal(await adapter.nextPage(first.receipt.id),'cursor-page-2');assert.deepEqual((await adapter.plan(s.value.id,'cursor-page-2',first.receipt.id)).parameters,{cursor:'cursor-page-2'});
  await assert.rejects(()=>adapter.plan(s.value.id,'evil-token',first.receipt.id));await assert.rejects(()=>adapter.plan(s.value.id,'cursor-page-2','page:forged'));
  for(const bad of [
    {...resolvers,resolvePage:async()=>null},
    {...resolvers,resolveRepresentation:async()=>null},
    {...resolvers,resolveRepresentation:async(r:{id:string;revision:number})=>{const v=await f.registry.resolveRetainedRepresentation(r);return v?{...v,bytes:bytes('{}')}:null}},
    {...resolvers,resolvePage:async(id:string)=>{const p=await store.resolvePage(id);return p?{...p,nextCheckpoint:'attacker'}:null}},
  ])await assert.rejects(()=>createDiscoveryCrossrefAdapter(bad).nextPage(first.receipt.id));
  const bodyVariant=async(body:string)=>replay.inspect({...firstInput,bytes:bytes(body),representationSha256:sha(bytes(body))});
  const changed=await bodyVariant(crossrefBody([{...crossrefItem(),title:['Changed metadata']}],1));
  assert.equal(changed.draft.leads[0].nativeId,lead.nativeId);assert.notEqual(changed.draft.leads[0].sourceVersion,lead.sourceVersion);assert.ok(changed.metadata[0].holds.includes('editorial-review-required'));
  const related={...crossrefItem(),relation:{'is-correction-of':[{'id-type':'doi',id:'10.1234/target'}]}};
  const position0=await bodyVariant(crossrefBody([related],1));
  const position1=await bodyVariant(crossrefBody([crossrefItem('10.1234/other'),related],2,'cursor-test'));
  assert.equal(position0.metadata[0].sourceVersion,position1.metadata[1].sourceVersion);
  assert.notEqual(position0.metadata[0].relationProposals[0].jsonPointer,position1.metadata[1].relationProposals[0].jsonPointer);
  const preprint=await bodyVariant(crossrefBody([{...crossrefItem(),type:'posted-content',subtype:'preprint'}],1));
  const nonPreprint=await bodyVariant(crossrefBody([{...crossrefItem(),type:'posted-content',subtype:'other'}],1));
  assert.equal(preprint.draft.leads[0].sourceStage,'preprint');assert.equal(nonPreprint.draft.leads[0].sourceStage,'publication');assert.notEqual(preprint.draft.leads[0].sourceVersion,nonPreprint.draft.leads[0].sourceVersion);
  for(const url of ['http://127.0.0.1/license','https://localhost/license','https://license.example.org/path?token=secret','https://EXAMPLE.org/license']) {
    const invalid=await bodyVariant(crossrefBody([{...crossrefItem(),license:[{URL:url}]}],1));assert.equal(invalid.draft.rejectedCount,1,`unsafe license ${url}`);assert.equal(invalid.draft.terminal,false);
  }
  const missing=await bodyVariant(crossrefBody([{...crossrefItem(),relation:{'is-correction-of':[{ 'id-type':'doi'}]}}],1));
  assert.equal(missing.draft.terminal,false);assert.equal(missing.draft.providerLimited,true);assert.ok(missing.metadata[0].holds.includes('relation-endpoint-missing'));
  const malformed=await bodyVariant(crossrefBody([crossrefItem('10.1234/alpha%2Fbad')],1));assert.equal(malformed.draft.terminal,false);assert.equal(malformed.draft.rejectedCount,1);
  await assert.rejects(()=>bodyVariant(crossrefBody([crossrefItem(),crossrefItem('10.1234/Beta')],2,'https://evil.invalid/next')));
  await assert.rejects(()=>bodyVariant('x'.repeat(48001)));
  f.advance(1000);await f.makeRound(store,'round:crossref:2','cohort:crossref',[s]);
  const second=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>{sends++;return new Response(crossrefBody([crossrefItem('10.1234/Gamma'),crossrefItem('10.1234/Delta')],4,'cursor-page-3'))}}}}).step(f.stepInput('round:crossref:2'));
  assert.equal(second.kind,'page',JSON.stringify(second));if(second.kind!=='page')throw Error('second page');assert.equal(second.receipt.chainComplete,false);assert.equal(second.receipt.nextCheckpoint,'cursor-page-3');assert.equal(sends,2);
  assert.equal((await adapter.replay(second.receipt.id)).draft.leads.length,2);
  const secondPlan=structuredClone(issued),secondInput=structuredClone(captured),secondRetained=await f.registry.resolveRetainedRepresentation(second.receipt.representation);
  f.advance(1000);await f.makeRound(store,'round:crossref:3','cohort:crossref',[s]);
  const third=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>{sends++;return new Response(crossrefBody([],4))}}}}).step(f.stepInput('round:crossref:3'));
  assert.equal(third.kind,'page',JSON.stringify(third));if(third.kind!=='page')throw Error('third page');assert.equal(third.receipt.chainComplete,true);assert.equal(sends,3);assert.equal(wrongQueryChecked,true);
  assert.equal((await adapter.replay(third.receipt.id)).draft.leads.length,0);
  const noToken=(plan:any)=>{const copy=structuredClone(plan);delete copy.requestBindingToken;return copy;};
  const binary=(value:any)=>({...value,bytes:Array.from(value.bytes)});
  mkdirSync('.discovery-work/wp10-terra',{recursive:true});
  writeFileSync(`.discovery-work/wp10-terra/fixture-snapshot-${process.pid}.json`,JSON.stringify({scopeInput:crossrefScopeInput,source:s.value,firstPlan:noToken(firstPlan),secondPlan:noToken(secondPlan),firstInput:binary(firstInput),secondInput:binary(secondInput),firstReceipt:first.receipt,secondReceipt:second.receipt,thirdReceipt:third.receipt,firstRetained:binary(retained),secondRetained:binary(secondRetained),firstClaim:await store.resolveClaim(first.receipt.claimId),secondClaim:await store.resolveClaim(second.receipt.claimId),now:f.now()},null,2)+'\n');
  // Corrupt index mapping without changing its valid payload hash; readers must fail closed.
  const row=await f.db.prepare('SELECT chain_id,payload_json,payload_sha256 FROM discovery_collection_pages WHERE id=?').bind(first.receipt.id).first<{chain_id:string;payload_json:string;payload_sha256:string}>();assert.ok(row);
  await f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind('chain:forged',first.receipt.id).run();
  assert.equal(await store.resolveChainPage('chain:forged',1),null);assert.equal(await store.resolveChainPage(row!.chain_id,1),null);await assert.rejects(()=>adapter.replay(third.receipt.id));
  await f.db.prepare('UPDATE discovery_collection_pages SET chain_id=? WHERE id=?').bind(row!.chain_id,first.receipt.id).run();
  await f.db.prepare('UPDATE discovery_collection_pages SET payload_json=? WHERE id=?').bind('{}',first.receipt.id).run();assert.equal(await store.resolveChainPage(row!.chain_id,1),null);await assert.rejects(()=>adapter.replay(third.receipt.id));
  await f.db.prepare('UPDATE discovery_collection_pages SET payload_json=? WHERE id=?').bind(row!.payload_json,first.receipt.id).run();
  assert.equal((await store.resolveChainPage(row!.chain_id,1))?.id,first.receipt.id);
  f.advance(60000);await assert.rejects(()=>adapter.plan(s.value.id,'cursor-page-2',first.receipt.id));
  assert.deepEqual((await adapter.replay(first.receipt.id)).metadata,parsed.metadata);
  assert.equal((await adapter.replay(third.receipt.id)).draft.leads.length,0);
});

test('AC06 actual D1 records oversized, malformed cursor and missing relation as incomplete', {timeout:600_000},async t=>{
  const {createDiscoveryCrossrefAdapter,qualifyDiscoveryCrossrefScope}=await import('../src/ingest/discovery/crossref');
  for(const mode of ['oversized','bad-cursor','missing-relation'] as const)await t.test(mode,async sub=>{
    const scope=await qualifyDiscoveryCrossrefScope(crossrefScopeInput),f=await fixture(sub);
    const template:DiscoveryEndpointTemplate={id:`endpoint:crossref-${mode}`,origin:'https://api.crossref.org',path:'/works',fixed:{query:scope.queryLiteral,filter:scope.filter,rows:'2'},parameters:{cursor:{kind:'token',maxLength:512}},required:['cursor'],pageParameter:'cursor'};
    const s=await f.source(`crossref-${mode}`,{scopeId:scope.id,template,params:{cursor:'*'}});let store:ReturnType<typeof f.makeStore>;
    const adapter=createDiscoveryCrossrefAdapter({resolveSource:async id=>id===s.value.id?s.value:null,resolveScope:async id=>id===scope.id?scope:null,resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),resolveClaim:id=>store.resolveClaim(id),now:f.now});
    store=f.makeStore(f.db,adapter.parser);f.advance(31000);await f.makeRound(store,`round:${mode}`,`cohort:${mode}`,[s]);
    const payload=mode==='oversized'?'x'.repeat(4097):mode==='bad-cursor'?crossrefBody([crossrefItem(),crossrefItem('10.1234/Beta')],2,'https://evil.invalid/next'):crossrefBody([{...crossrefItem(),relation:{'is-correction-of':[{'id-type':'doi'}]}}],1);
    const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(payload)}}}).step(f.stepInput(`round:${mode}`));
    if(mode==='missing-relation'){assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');assert.equal(result.receipt.providerLimited,true);assert.equal(result.receipt.chainComplete,false);assert.equal((await adapter.replay(result.receipt.id)).metadata[0].holds.includes('relation-endpoint-missing'),true);}
    else assert.equal(result.kind,'failure',JSON.stringify(result));
    assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt,null);
  });
});

test('actual D1 ancestry enforces page and total-item caps without completing', {timeout:600_000},async t=>{
  const {createDiscoveryCrossrefAdapter,qualifyDiscoveryCrossrefScope}=await import('../src/ingest/discovery/crossref');
  for(const mode of ['page-cap','item-cap'] as const)await t.test(mode,async sub=>{
    const scope=await qualifyDiscoveryCrossrefScope({...crossrefScopeInput,...(mode==='page-cap'?{maxPages:2}:{maxItems:3})}),f=await fixture(sub);
    const template:DiscoveryEndpointTemplate={id:`endpoint:${mode}`,origin:'https://api.crossref.org',path:'/works',fixed:{query:scope.queryLiteral,filter:scope.filter,rows:'2'},parameters:{cursor:{kind:'token',maxLength:512}},required:['cursor'],pageParameter:'cursor'};
    const s=await f.source(`cap-${mode}`,{scopeId:scope.id,template,params:{cursor:'*'}});let store:ReturnType<typeof f.makeStore>;
    const adapter=createDiscoveryCrossrefAdapter({resolveSource:async id=>id===s.value.id?s.value:null,resolveScope:async id=>id===scope.id?scope:null,resolvePlan:id=>f.registry.resolvePlan(id),resolvePage:id=>store.resolvePage(id),resolveRepresentation:r=>f.registry.resolveRetainedRepresentation(r),resolveChainPage:(id,n)=>store.resolveChainPage(id,n),resolveClaim:id=>store.resolveClaim(id),now:f.now});
    store=f.makeStore(f.db,adapter.parser);f.advance(31000);
    for(let page=1;page<=2;page++){
      await f.makeRound(store,`round:${mode}:${page}`,`cohort:${mode}`,[s]);
      const result=await f.makeCollector(store,{transportOptions:{clock:()=>Date.parse(f.now()),egress:{send:async()=>new Response(crossrefBody([crossrefItem(`10.1234/${page}a`),crossrefItem(`10.1234/${page}b`)],10,`cursor-${page+1}`))}}}).step(f.stepInput(`round:${mode}:${page}`));
      assert.equal(result.kind,'page',JSON.stringify(result));if(result.kind!=='page')throw Error('page');
      if(page===1){assert.equal(result.receipt.nextCheckpoint,'cursor-2');f.advance(1000);}else{assert.equal(result.receipt.chainComplete,false);assert.equal(result.receipt.providerLimited,true);assert.equal(result.receipt.nextCheckpoint,null);assert.equal((await store.readHealth(s.value.id))?.lastCompleteAt,null);}
    }
  });
});
