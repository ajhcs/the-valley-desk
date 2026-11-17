import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, chmodSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { canonical } from '../src/ingest/discovery/directory-acquisition';
import { DirectoryAcquisitionStore } from '../scripts/discovery-directory-acquire.mjs';
const base='/workspace/build/builderbob/tvd-gl03-20261116/terra/engineering'; mkdirSync(base,{recursive:true,mode:0o700});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const page=(id='page:1',route='account',county='Camden',parentPageId:string|null=null,pageNum=1)=>{
 const request={method:'GET',url:`https://api.example.org/${id}`,accept:'application/json',encoding:'identity',userAgent:'Test agent',githubApiVersion:null,maxBytes:48000,timeoutMs:25000,redirects:0};
 return {id,chainId:parentPageId?'chain:1':`chain:${id}`,page:pageNum,parentPageId,provider:'github',route,county,sourceId:'source:1',scopeId:'scope:1',installation:'installation:1',reason:'bounded test route',qualificationSha256:'a'.repeat(64),parserRevision:'parser:1',parserSha256:'b'.repeat(64),...request,requestSha256:hash(canonical(request))};
};
const plan=(pages=[page()])=>({schemaVersion:'directory-acquisition-plan-v1',id:'plan:1',gl02ManifestSha256:hash(readFileSync('docs/discovery/go-live/execution/GL02-exploration-manifest.json','utf8')),approvedScopeSha256:'d'.repeat(64),limits:{totalRequests:10,perProviderRequests:10,queue:20,perCountyLeads:10,totalLeads:20,concurrentAttempts:3,resultsPerPage:5,activeMsTotal:16200000,activeMsPerCounty:1800000},pages});
const folder=()=>{const p=mkdtempSync(join(base,'test-'));chmodSync(p,0o700);return p};
const open=(p:string,input=plan())=>new DirectoryAcquisitionStore(p,input);
const utc='2026-11-16T20:00:00.000Z';
function packet(s:DirectoryAcquisitionStore, p:ReturnType<typeof page>, continuation='none', nativeId='123456789012') {
 const receiptId=`receipt:${p.id}`, body='e'.repeat(64);
 const lead={nativeId,kind:'artifact',artifactKind:'repository',displayName:'Quiet project',sourceStage:'baseline',sourceDates:[],relatedAccounts:[],unresolvedPeople:[],publicationAuthorized:false};
 const frontier={schemaVersion:'discovery-directory-private-frontier-v1',id:`candidate:${nativeId}`,revision:1,source:{kind:'collection-lead',provider:p.provider,sourceId:p.sourceId,scopeId:p.scopeId,pageReceiptId:receiptId,requestSha256:p.requestSha256,representationSha256:body,leadIndex:0,lead},disposition:'pending',duplicateOf:null,reason:null,publicationAuthorized:false};
 const facts=[{nativeId,kind:'repository',title:'Quiet project',url:'https://github.com/example/quiet',pointers:{nativeId:'/0/id',title:'/0/full_name',url:'/0/html_url',ownerType:'/0/owner/type',archived:'/0/archived',fork:'/0/fork',sourceVersion:null,sourceDates:[]},ownerType:'User',archived:false,fork:false,frontier}];
 const projectionSha256=hash(canonical(facts));
 const data={schemaVersion:'directory-factual-page-v1',publicationAuthorized:false,receiptId,pageId:p.id,manifestSha256:s.manifestSha256,qualificationSha256:p.qualificationSha256,requestSha256:p.requestSha256,nativeBodySha256:body,parserSha256:p.parserSha256,parserRevision:p.parserRevision,observedDate:'2026-11-16',continuation,nextRequestSha256:continuation==='more'?'f'.repeat(64):null,providerIncomplete:false,facts,projectionSha256};
 const receipt={schemaVersion:'directory-native-receipt-v1',id:receiptId,pageId:p.id,manifestSha256:s.manifestSha256,sourceId:p.sourceId,scopeId:p.scopeId,installation:p.installation,qualificationSha256:p.qualificationSha256,requestSha256:p.requestSha256,issuedAt:utc,completedAt:'2026-11-16T20:00:01.000Z',status:'received',httpStatus:200,responseBytes:100,contentEncoding:'identity',contentType:'application/json',utf8:'valid',redirects:0,nativeBodySha256:body,projectionSha256,packetSha256:hash(canonical(data)),parserSha256:p.parserSha256,parserRevision:p.parserRevision};
 return {data,receipt};
}
function withStore(fn:(s:DirectoryAcquisitionStore,p:string)=>void,input=plan()) {const p=folder();try {const s=open(p,input);try {fn(s,p)} finally {s.close()}}finally{rmSync(p,{recursive:true,force:true})}}

test('one durable permit, uncertain issued request never resent after restart',()=>withStore((s,p)=>{
 assert.equal(s.reserve('page:1'),'reserved'); const permit=s.markAttempt('page:1',utc);assert.equal(permit.manifestSha256,s.manifestSha256);
 assert.throws(()=>s.markAttempt('page:1',utc),/attempt-not-reserved/);
 const second=open(p);try{assert.equal(second.reserve('page:1'),'already-reserved');assert.throws(()=>second.markAttempt('page:1',utc),/attempt-not-reserved/);assert.equal(second.progress().attempts[0].status,'issued')}finally{second.close()}
}));

test('fact-only import preserves source binding, quiet User and no public authority',()=>withStore(s=>{
 s.reserve('page:1');s.markAttempt('page:1',utc);const {data,receipt}=packet(s,page());
 assert.deepEqual(s.finish(receipt,data),{outcome:'complete',inserted:1,pending:0});assert.equal(s.progress().candidates.count,1);
 assert.deepEqual(s.finish(receipt,data),{outcome:'complete',inserted:0,pending:0,replay:true});
 assert.throws(()=>s.finish(receipt,{...data,providerIncomplete:true}),/replay-mismatch/);
}));

test('changing receipt or projected facts cannot bypass exact identity and digest bindings',()=>withStore(s=>{
 s.reserve('page:1');s.markAttempt('page:1',utc);const {data,receipt}=packet(s,page());
 assert.throws(()=>s.finish({...receipt,scopeId:'scope:wrong'},data),/receipt-binding-mismatch/);
 assert.throws(()=>s.finish(receipt,{...data,facts:[{...data.facts[0],title:'Different'}]}),/packet-binding-mismatch/);
 assert.throws(()=>s.finish(receipt,{...data,continuation:'more',nextRequestSha256:'f'.repeat(64)}),/packet-binding-mismatch/);
 assert.throws(()=>s.finish({...receipt,parserSha256:'f'.repeat(64)},data),/receipt-binding-mismatch/);
 assert.equal(s.finish(receipt,data).outcome,'complete');
}));

test('refused or rate-limited provider holds other requests after restart',()=>withStore((s,p)=>{
 s.reserve('page:1');s.markAttempt('page:1',utc);const {receipt}=packet(s,page());
 const failure={...receipt,status:'rate-limited',httpStatus:429,nativeBodySha256:null,projectionSha256:null,packetSha256:null,parserSha256:null,parserRevision:null,responseBytes:0,contentEncoding:'unknown',contentType:'unknown',utf8:'unknown'};
 assert.equal(s.finish(failure).outcome,'rate-limited');const second=open(p,plan([page(),page('page:2','topic','Mercer')]));
 try{assert.throws(()=>second.reserve('page:2'),/source-scope-held/)}finally{second.close()}
},plan([page(),page('page:2','topic','Mercer')])));

test('queue capacity is reserved before send across concurrent pages',()=>withStore(s=>{
 assert.equal(s.reserve('page:1'),'reserved');assert.equal(s.reserve('page:2'),'reserved');assert.throws(()=>s.reserve('page:3'),/frontier-capacity-reservation/);
},plan([page(),page('page:2','topic','Camden'),page('page:3','topic','Camden')])));

test('unknown continuation never allows next page and capped response never says complete',()=>{
 const a=page();const b={...page('page:2','account','Camden','page:1',2),chainId:a.chainId};
 withStore(s=>{s.reserve(a.id);s.markAttempt(a.id,utc);const {data,receipt}=packet(s,a,'unknown');assert.equal(s.finish(receipt,data).outcome,'unknown');assert.throws(()=>s.reserve(b.id),/parent-not-continuable/)},plan([a,b]));
 withStore(s=>{s.reserve(a.id);s.markAttempt(a.id,utc);const {data,receipt}=packet(s,a,'more');assert.equal(s.finish(receipt,data).outcome,'capped')},plan([a]));
});

test('deadline, content type, source hash and unissued import fail closed',()=>withStore(s=>{
 const {data,receipt}=packet(s,page());assert.throws(()=>s.finish(receipt,data),/attempt-not-issued/);
 s.reserve('page:1');s.markAttempt('page:1',utc);
 assert.throws(()=>s.finish({...receipt,completedAt:'2026-11-16T20:00:26.000Z'},data));
 assert.throws(()=>s.finish({...receipt,contentType:'unknown'},data));
 assert.throws(()=>s.finish({...receipt,nativeBodySha256:'f'.repeat(64)},data),/packet-binding-mismatch/);
}));

test('rejects unsafe private path modes and symlink database',()=>{
 const p=folder();try{chmodSync(p,0o755);assert.throws(()=>open(p),/private-directory-required/);chmodSync(p,0o700);const x=join(p,'foreign');writeFileSync(x,'');symlinkSync(x,join(p,'frontier.sqlite'));assert.throws(()=>open(p),/private-database-required/)}finally{rmSync(p,{recursive:true,force:true})}
});


test('private packet rejects nested contacts and credentials even with recomputed digest',()=>withStore(s=>{
 s.reserve('page:1'); s.markAttempt('page:1',utc); const {data,receipt}=packet(s,page());
 for (const unsafe of ['person%40example.org','ghp_'+'ABCDEFGHIJKLMNOPQRST','phone: 215-555-1234']) {
  const altered=structuredClone(data); altered.facts[0].frontier.source.lead.sourceVersion=unsafe; altered.facts[0].pointers.sourceVersion='/0/version'; altered.projectionSha256=hash(canonical(altered.facts));
  assert.throws(()=>s.finish({...receipt,projectionSha256:altered.projectionSha256,packetSha256:hash(canonical(altered))},altered),/private-or-credential-fact/);
 }
 const altered=structuredClone(data); altered.facts[0].url='https://github.com/example/quiet?access_token=secret'; altered.projectionSha256=hash(canonical(altered.facts));
 assert.throws(()=>s.finish({...receipt,projectionSha256:altered.projectionSha256,packetSha256:hash(canonical(altered))},altered),/private-or-credential-fact/);
 assert.equal(s.progress().candidates.count,0); assert.equal(s.finish(receipt,data).outcome,'complete');
}));

test('provider incomplete cannot become completed coverage and plan cannot mutate after open',()=>withStore(s=>{
 assert.throws(()=>{s.plan.limits.totalRequests=99});
 s.reserve('page:1');s.markAttempt('page:1',utc);const {data,receipt}=packet(s,page());
 data.providerIncomplete=true; assert.throws(()=>s.finish(receipt,data),/packet-binding-mismatch/); receipt.packetSha256=hash(canonical(data)); assert.equal(s.finish(receipt,data).outcome,'capped');
}));

test('empty projection is unknown even if continuation says terminal',()=>withStore(s=>{
 s.reserve('page:1');s.markAttempt('page:1',utc);const {data,receipt}=packet(s,page());
 data.facts=[];data.projectionSha256=hash(canonical(data.facts));receipt.projectionSha256=data.projectionSha256;receipt.packetSha256=hash(canonical(data));
 assert.equal(s.finish(receipt,data).outcome,'unknown');
}));

test('account and topical observations deduplicate one native repository without losing origin',()=>{
 const a=page(), b=page('page:2','topic','Camden');
 withStore(s=>{
  s.reserve(a.id);s.markAttempt(a.id,utc);let x=packet(s,a);assert.equal(s.finish(x.receipt,x.data).inserted,1);
  s.reserve(b.id);s.markAttempt(b.id,utc);x=packet(s,b);assert.equal(s.finish(x.receipt,x.data).inserted,0);
  const candidates=s.listCandidates();assert.equal(candidates.length,1);assert.equal(candidates[0].explorationCounty,'Camden');assert.equal(candidates[0].observations.length,2);
 },plan([a,b]));
});

test('independent publication enters a private frontier without a repository or owner',()=>{
 const pub={...page('page:pub','publication','Mercer'),provider:'pubmed'};
 withStore(s=>{
  s.reserve(pub.id);s.markAttempt(pub.id,utc);const {data,receipt}=packet(s,pub,'none','87654321');const fact=data.facts[0];
  fact.kind='publication';fact.url='https://pubmed.ncbi.nlm.nih.gov/87654321/';fact.ownerType=null as never;fact.archived=null as never;fact.fork=null as never;
  fact.pointers.ownerType=null as never;fact.pointers.archived=null as never;fact.pointers.fork=null as never;
  fact.frontier.source.lead.artifactKind='publication'; fact.frontier.source.lead.sourceStage='publication';
  data.projectionSha256=hash(canonical(data.facts));receipt.projectionSha256=data.projectionSha256;receipt.packetSha256=hash(canonical(data));
  assert.equal(s.finish(receipt,data).outcome,'complete');assert.equal(s.listCandidates()[0].fact.kind,'publication');
 },plan([pub]));
});

test('a pre-reserved page cannot be sent after a provider refusal',()=>{
 const a=page(),b=page('page:2','topic','Mercer');
 withStore(s=>{
  s.reserve(a.id);s.reserve(b.id);s.markAttempt(a.id,utc);const {receipt}=packet(s,a);
  const refused={...receipt,status:'refused',httpStatus:403,nativeBodySha256:null,projectionSha256:null,packetSha256:null,parserSha256:null,parserRevision:null,responseBytes:0,contentEncoding:'unknown',contentType:'unknown',utf8:'unknown'};
  s.finish(refused);assert.throws(()=>s.markAttempt(b.id,utc),/source-scope-held/);
 },plan([a,b]));
});


test('active-time capacity remains charged across restart and manual work is recorded',()=>withStore((s,p)=>{
 assert.equal(s.recordActivity('activity:1','Camden',1790000),'recorded');
 assert.equal(s.recordActivity('activity:1','Camden',1790000),'already-recorded');
 assert.throws(()=>s.recordActivity('activity:1','Camden',1),/activity-replay-mismatch/);
 assert.throws(()=>s.reserve('page:1'),/active-time-budget-exhausted/);
 const reopened=open(p);try{assert.throws(()=>reopened.reserve('page:1'),/active-time-budget-exhausted/)}finally{reopened.close()}
}));


test('concurrent processes issue at most one permit for a page',async()=>{
 const dir=folder(), data=plan(); const s=open(dir,data);s.close();
 const planPath=join(dir,'plan.json');writeFileSync(planPath,JSON.stringify(data),{mode:0o600});
 const script=`import {readFileSync} from 'node:fs'; import {DirectoryAcquisitionStore} from './scripts/discovery-directory-acquire.mjs'; const [dir,path]=process.argv.slice(1); const s=new DirectoryAcquisitionStore(dir,JSON.parse(readFileSync(path,'utf8'))); try {const r=s.reserve('page:1'); if(r==='reserved'){s.markAttempt('page:1','2026-11-16T20:00:00.000Z');console.log('permit')}else console.log('duplicate')} finally {s.close()}`;
 const run=()=>new Promise<string>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx/esm','--input-type=module','-e',script,dir,planPath],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));});
 try {const result=await Promise.all([run(),run()]);assert.deepEqual(result.sort(),['duplicate','permit']);}finally{rmSync(dir,{recursive:true,force:true})}
});


test('duplicate exact request cannot be planned under a different page identity',()=>{
 const a=page(); const b={...a,id:'page:alias',chainId:'chain:other'}; const dir=folder();
 try {assert.throws(()=>open(dir,plan([a,b])))} finally {rmSync(dir,{recursive:true,force:true})}
});


test('activity entered after reservation blocks an over-budget send permit',()=>{
 const input=plan();input.limits.activeMsTotal=100000;input.limits.activeMsPerCounty=100000;
 withStore(s=>{s.reserve('page:1');s.recordActivity('activity:1','Camden',100000);assert.throws(()=>s.markAttempt('page:1',utc),/active-time-budget-exhausted/)},input);
});
