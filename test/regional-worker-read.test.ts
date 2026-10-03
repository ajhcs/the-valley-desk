import {test,before,after} from 'node:test';
import {accessJwtFixture} from './helpers/ops-jwt-fixture.ts';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleOpsRequest,OPS_ALLOWED_EMAIL} from '../src/ingest/ops-access.ts';
import {createRegionalWorkerReadHandler} from '../src/ingest/regional-worker-read.ts';
import {RegionalAgentResult,RegionalDiscoveryResult,RegionalDiscoveryRecordResult} from '../src/agents/regional-agent-contract.ts';
const origin='https://thevalleydesk.org',trusted={access:{getIdentity:async()=>({email:OPS_ALLOWED_EMAIL})}};
const fixture=await accessJwtFixture();
const originalFetch=globalThis.fetch;
before(()=>{globalThis.fetch=fixture.fetcher;});
after(()=>{globalThis.fetch=originalFetch;});
const env={...fixture.config} as Parameters<typeof handleOpsRequest>[1];
const req=(key='regional-discovery-candidates',body:BodyInit='{}',headers:Record<string,string>={},method='POST',base=origin)=>new Request(base+'/ops/api/agent/'+key,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},...(method==='POST'?{body}:{})});
const ops=async(request:Request,ctx:Parameters<typeof handleOpsRequest>[2]=trusted)=>{request.headers.set('cf-access-jwt-assertion',await fixture.sign());return handleOpsRequest(request,env,ctx,origin,async()=>'<html>private shell</html>');};
const bundle=JSON.parse(await readFile(new URL('../fixtures/regional-discovery-read-snapshot-v1.json',import.meta.url),'utf8'));
const moment=Math.ceil(Date.parse(bundle.data.preparedAt)/900000)*900000+1000;
const a=await createRegionalWorkerReadHandler(bundle,()=>moment),b=await createRegionalWorkerReadHandler(bundle,()=>moment+500);
const get=async(handler:typeof a,key:string,args:unknown={})=>{const response=await handler(req(key,JSON.stringify(args)));assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();assert.equal(response.status,200);return result;};
test('private guard denies missing/forged/disallowed/throwing identity, workers.dev and foreign/missing Origin before reading body',async()=>{
 let reads=0;const trapped=()=>new Request(origin+'/ops/api/agent/regional-discovery-candidates',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-access-authenticated-user-email':OPS_ALLOWED_EMAIL},body:new ReadableStream({pull(){reads++;}},{highWaterMark:0}),duplex:'half'} as RequestInit);
 for(const ctx of [undefined,{}, {access:{getIdentity:async()=>({email:'someone@example.org'})}}, {access:{getIdentity:async()=>{throw new Error('PRIVATE_ERROR');}}}])assert.equal((await handleOpsRequest(trapped(),env,ctx,origin,async()=>'<html>private</html>')).status,404);
 assert.equal(reads,0);
 for(const request of [req('tools','',{},'GET','https://tvd.workers.dev'),req('tools','',{},'GET','https://workers.dev'),req('regional-discovery-candidates','{}',{Origin:'https://foreign.invalid'}),req('regional-discovery-candidates','{}',{Origin:''})])assert.equal((await ops(request)).status,404);
});
test('signature-authenticated Ops serves three read tools; fixed paths/methods/queries are bounded and private',async()=>{
 const response=await ops(req('tools','',{},'GET'));assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
 const {tools}=await response.json();assert.equal(tools.length,3);assert.ok(tools.every((row:any)=>row.inputSchema.additionalProperties===false&&!row.securitySchemes&&!row._meta));
 assert.equal((await ops(req('tools'))).status,405);
 assert.equal((await ops(req('regional-discovery-candidates','',{},'GET'))).status,405);
 for(const key of ['unknown','regional-discovery-candidates?url=private'])assert.equal((await ops(req(key))).status,404);
});
test('two isolated handlers share manifest/time-bucket cursor and return exactly 28 partial retained records',async()=>{
 let cursor:unknown,all:any[]=[];let use=a;
 do{const page=RegionalDiscoveryResult.parse(await get(use,'regional-discovery-candidates',{limit:3,...(cursor?{cursor}:{})}));all.push(...page.results);cursor=page.nextCursor;use=use===a?b:a;}while(cursor);
 assert.equal(all.length,28);assert.equal(new Set(all.map(row=>row.recordId)).size,28);
 assert.ok(all.every(row=>row.status==='review'&&!row.currentEmploymentConfirmed&&!row.publicationAuthorized&&!row.organizationOwnershipVerified));
 const w=RegionalDiscoveryResult.parse(await get(a,'regional-discovery-candidates',{institutionIds:['inst-regional-wistar'],limit:10}));assert.equal(w.results.length,5);assert.ok(w.results.every(row=>!row.provenance.upstreamWireBytesVerifiedByThisAdapter));
 for(const row of w.results){const detail=RegionalDiscoveryRecordResult.parse(await get(b,'regional-discovery-record',{snapshotId:w.snapshot.snapshotId,recordId:row.recordId,authorLimit:1}));assert.ok(detail.details.authors.length<=1);assert.ok(!JSON.stringify(detail).includes('@'));}
 const repo=all.find(row=>row.provider==='institution-linked-github');const detail=await get(b,'regional-discovery-record',{snapshotId:w.snapshot.snapshotId,recordId:repo.recordId});assert.equal(detail.details.repositoryNumericId,'128938343');
});
test('inventory filters and missing registrations match retained projection; no fresh/current-person claim',async()=>{
 const full=RegionalAgentResult.parse(await get(a,'regional-source-inventory',{limit:50}));assert.equal(full.counts.institutionsInFilter,33);assert.equal(full.results.length,49);assert.equal(full.counts.registrationGapsInInstitutionChannelFilter,127);assert.equal(full.counts.freshSourcesAtSnapshotInFilter,0);assert.equal(full.counts.acceptedPublications,null);
 let cursor:unknown,rows:any[]=[];do{const page=await get(b,'regional-source-inventory',{limit:4,...(cursor?{cursor}:{})});rows.push(...page.results);cursor=page.nextCursor;}while(cursor);assert.deepEqual(rows,full.results);
 const id=full.results[0].institutionId;const filtered=await get(a,'regional-source-inventory',{institutionIds:[id],channels:['people'],configurations:['configured']});assert.equal(filtered.counts.institutionsInFilter,1);assert.ok(filtered.results.every((row:any)=>row.institutionId===id&&row.channel==='people'&&row.configuration==='configured'));
 assert.ok(full.results.every(row=>!row.lastCheckedAt&&!row.lastSuccessAt));
});
test('expired/changed-manifest cursors restart; filter mismatch and caller-time/network knobs rejected',async()=>{
 const first=await get(a,'regional-discovery-candidates',{limit:2});
 const later=await createRegionalWorkerReadHandler(bundle,()=>moment+900000);
 assert.equal((await get(later,'regional-discovery-candidates',{cursor:first.nextCursor})).error.code,'snapshot-expired');
 for(const args of [{limit:11},{url:'https://private.invalid'},{serverNow:'2026-10-02'},{activate:true},{providers:['pubmed-metadata'],cursor:first.nextCursor},{institutionIds:['inst-unknown']}])assert.equal((await get(a,'regional-discovery-candidates',args)).error.code,'invalid-query');
 const tampered=structuredClone(bundle);tampered.data.records[0].record.title='TAMPER';await assert.rejects(createRegionalWorkerReadHandler(tampered),/invalid-regional-worker-manifest/);
});
test('request malformed UTF-8, JSON, oversized streamed bodies and content type have fixed safe errors',async()=>{
 for(const request of [req('regional-discovery-candidates','{'),req('regional-discovery-candidates',new Uint8Array([255])),req('regional-discovery-candidates','x'.repeat(16385)),req('regional-discovery-candidates','{}',{'Content-Type':'text/plain'})]){const result=await (await a(request)).json();assert.equal(result.error.code,'invalid-query');assert.ok(!JSON.stringify(result).includes('TAMPER'));}
});
test('server snapshot is not imported by browser and public Worker feeds/routes stay unchanged',async()=>{
 const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8'),page=await readFile(new URL('../src/ui/OpsPage.tsx',import.meta.url),'utf8'),browser=await readFile(new URL('../src/agents/regional-browser.ts',import.meta.url),'utf8');
 assert.ok(!worker.includes('regional-discovery-read-snapshot'));assert.ok(!page.includes('regional-worker-read'));assert.ok(!browser.includes('regional-worker-read'));assert.match(page,/registerRegionalBrowserTools\(document, "ops", lifecycle.signal\)/);
 const fixtureText=JSON.stringify(bundle);assert.equal(fixtureText.includes('@'),false);assert.ok(!fixtureText.includes('retainedMetadataRepresentation'));assert.ok(!fixtureText.includes('articleBody'));
});
