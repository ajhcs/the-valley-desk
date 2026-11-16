import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'parse5';
import {handleDiscoveryDirectory} from '../src/ingest/discovery-directory-http';
import {handleDiscoveryDirectoryPage} from '../src/ingest/discovery-directory-page';

const source=()=>JSON.parse(readFileSync('src/content/discovery-directory-catalog.json','utf8'));
const removed=(snapshot:ReturnType<typeof source>,ids:string[]=[])=>({schemaVersion:'discovery-directory-removals-v1',snapshotVersion:snapshot.version,removedIds:ids});
const request=(path:string,method='GET')=>new Request('https://directory.example'+path,{method});
const enabled={DISCOVERY_DIRECTORY_ENABLED:'true'};
function elements(html:string,tag:string):any[]{
 const found:any[]=[];const walk=(n:any)=>{if(n.tagName===tag)found.push(n);for(const child of n.childNodes??[])walk(child);};walk(parse(html));return found;
}
test('versioned API is off by default, GET/HEAD only, and rejects malformed queries',async()=>{
 const snapshot=source(),meta=removed(snapshot);
 for(const flag of [undefined,true,'TRUE','false'])assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'),{DISCOVERY_DIRECTORY_ENABLED:flag},snapshot,meta)).status,404);
 const post=await handleDiscoveryDirectory(request('/api/discovery/v1/works','POST'),enabled,snapshot,meta);assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
 for(const query of ['?limit=0','?limit=51','?q=x&q=y','?private=true','?kind=organization'])assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'+query),enabled,snapshot,meta)).status,400);
 const get=await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,meta),head=await handleDiscoveryDirectory(request('/api/discovery/v1/works','HEAD'),enabled,snapshot,meta);
 assert.equal(get.status,200);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(get.headers.get('content-type'),head.headers.get('content-type'));assert.equal(get.headers.get('cache-control'),'no-store');
 const data=await get.json() as any;assert.equal(data.totalWorks,2);assert.equal(data.items.length,2);assert.ok(!('projectCount' in data));assert.ok(!('peopleCount' in data));assert.ok(!('evidence' in data));
 assert.ok(!JSON.stringify(data).includes('candidateId'));assert.ok(!JSON.stringify(data).includes('bindingsSha256'));assert.ok(!JSON.stringify(data).includes('source-observations.json'));
});
test('real admitted identities, date precision and author context are identical in API and HTML',async()=>{
 const snapshot=source(),meta=removed(snapshot),pub=snapshot.works.find((w:any)=>w.kind==='publication'),repo=snapshot.works.find((w:any)=>w.kind==='repository');
 for(const work of [pub,repo]){
  const api=await handleDiscoveryDirectory(request('/api/discovery/v1/works/'+encodeURIComponent(work.id)),enabled,snapshot,meta);
  assert.equal(api.status,200);assert.deepEqual((await api.json() as any).work,work);
  const page=await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(work.id)),enabled,snapshot,meta);assert.equal(page.status,200);
  const html=await page.text();assert.ok(html.includes(work.title.value));assert.ok(elements(html,'a').some(a=>a.attrs.some((v:any)=>v.name==='href'&&v.value===work.url.value)));
  assert.ok(html.includes(work.checkedAt));
  if(work.sourceDate){assert.ok(html.includes(work.sourceDate.value.value));assert.ok(html.includes(work.sourceDate.value.precision));}
  else assert.ok(!html.includes('Source date:'));
 }
 const pubHtml=await (await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(pub.id)),enabled,snapshot,meta)).text();
 assert.ok(pubHtml.includes('Publication author Uthsav Chitra'));assert.ok(pubHtml.includes('2025'));assert.ok(pubHtml.includes('Mercer County'));
 const repoHtml=await (await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(repo.id)),enabled,snapshot,meta)).text();
 assert.ok(repoHtml.includes('Project connection'));assert.ok(repoHtml.includes('Philadelphia'));assert.ok(!repoHtml.includes('Philadelphia County'));assert.ok(repoHtml.includes('original response not retained'));
 assert.ok(!repoHtml.includes('Source account:'));
});
test('changed/removal state invalidates cursors, returns 410 and fails mismatched release metadata',async()=>{
 const snapshot=source(),meta=removed(snapshot);
 const first=await (await handleDiscoveryDirectory(request('/api/discovery/v1/works?limit=1'),enabled,snapshot,meta)).json() as any;
 assert.ok(first.nextAfter);
 const gone=snapshot.works[0].id;snapshot.works=snapshot.works.slice(1);snapshot.version='test:removed';const nextMeta=removed(snapshot,[gone]);
 const cursor='?limit=1&after='+encodeURIComponent(first.nextAfter);
 assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'+cursor),enabled,snapshot,nextMeta)).status,409);
 assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works/'+encodeURIComponent(gone)),enabled,snapshot,nextMeta)).status,410);
 assert.equal((await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(gone)),enabled,snapshot,nextMeta)).status,410);
 const list=await (await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,nextMeta)).json() as any;assert.equal(list.totalWorks,1);assert.ok(!list.items.some((w:any)=>w.id===gone));
 assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,meta)).status,503);
 assert.equal((await handleDiscoveryDirectoryPage(request('/discover/works'),enabled,snapshot,meta)).status,503);
});
test('HTML escapes source strings and preserves synthetic directed relations and year precision',async()=>{
 // Deliberately synthetic renderer challenge; it does not assert a real citation.
 const snapshot=source(),repo=snapshot.works.find((w:any)=>w.kind==='repository'),pub=snapshot.works.find((w:any)=>w.kind==='publication');
 repo.title.value='<script>alert(1)</script>';repo.claims[0].text='<img src=x onerror=alert(1)>';
 repo.relations=[{id:'test:relation',fromId:repo.id,toId:pub.id,predicate:'repository-cites-work',evidenceIds:[repo.evidence[0].id],reviewId:repo.reviewRefs[0].id}];
 pub.sourceDate.value={precision:'year',value:'2025'};
 const html=await (await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(repo.id)),enabled,snapshot,removed(snapshot))).text();
 assert.equal(elements(html,'script').length,0);assert.equal(elements(html,'img').length,0);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Repository cites publication'));
 const year=await (await handleDiscoveryDirectoryPage(request('/discover/work/'+encodeURIComponent(pub.id)),enabled,snapshot,removed(snapshot))).text();assert.ok(year.includes('<time>2025</time> (year)'));assert.ok(!year.includes('2025-01-01'));
 repo.relations[0].predicate='work-links-repository';assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,removed(snapshot))).status,503);
});
test('oversized responses and private or support-only extra fields fail closed',async()=>{
 const snapshot=source(),meta=removed(snapshot);
 snapshot.works[0].privateNotes='must never appear';assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,meta)).status,503);
 delete snapshot.works[0].privateNotes;snapshot.works[0].kind='organization';assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works'),enabled,snapshot,meta)).status,503);
 const large=source(),original=large.works[0];large.works=Array.from({length:40},(_,i)=>{
  const w=structuredClone(original);w.id='test:large:'+i;w.nativeIdentity=null;w.title.value='<'.repeat(1000);w.claims=w.claims.map((c:any)=>({...c,id:c.id+':'+i,subjectId:w.id}));return w;
 });
 assert.equal((await handleDiscoveryDirectory(request('/api/discovery/v1/works?limit=50'),enabled,large,removed(large))).status,503);
 const html=await handleDiscoveryDirectoryPage(request('/discover/works?limit=50'),enabled,large,removed(large));assert.equal(html.status,503);assert.ok(new TextEncoder().encode(await html.text()).byteLength<=128000);
});
