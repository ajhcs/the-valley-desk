import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {primaryNoscript} from '../src/lib/crawler-html';
import {publicFeaturesFromEnv} from '../src/lib/public-features';
import {readFileSync} from 'node:fs';
const current=JSON.parse(readFileSync('src/content/discovery-directory-catalog.json','utf8'));

const env=(flag:unknown=undefined)=>({PUBLIC_ORIGIN:'https://thevalleydesk.org',DISCOVERY_DIRECTORY_ENABLED:flag,ASSETS:{fetch:async()=>{throw Error('Directory must not load assets');}},VALLEY_DESK_DB:new Proxy({},{get(){throw Error('Directory must not query a database');}})});
const invoke=(path:string,flag:unknown=undefined,method='GET')=>worker.fetch(new Request('https://thevalleydesk.org'+path,{method}),env(flag),{});
test('actual Worker directory routes close by default without database/assets/source access',async()=>{
 for(const flag of [undefined,false,true,'false','TRUE',' true '])for(const path of ['/api/discovery/v1/works','/api/discovery/v1/works?view=compact','/api/discovery/v1/works/unknown','/discover/works','/discover/work/unknown']){
  for(const method of ['GET','HEAD','POST']){const response=await invoke(path,flag,method);assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.text();assert.ok(!body.includes('ExerciseCEST'));assert.ok(!body.includes('snapshotVersion'));if(method==='HEAD')assert.equal(body,'');}
 }
});

test('actual Worker serves smaller compact cards with detail links for the same reviewed snapshot',async()=>{
 const full=await invoke('/api/discovery/v1/works','true');
 const compact=await invoke('/api/discovery/v1/works?view=compact','true');
 assert.equal(full.status,200);assert.equal(compact.status,200);
 const fullText=await full.text(),compactText=await compact.text();
 assert.ok(Buffer.byteLength(compactText)<Buffer.byteLength(fullText));
 const list=JSON.parse(compactText), original=JSON.parse(fullText);
 assert.equal(list.schemaVersion,'discovery-directory-list-compact-v1');
 assert.equal(list.snapshotVersion,original.snapshotVersion);
 assert.deepEqual(list.items.map((work:any)=>work.id),original.items.map((work:any)=>work.id));
 for(const item of list.items){
  const detail=await invoke(item.detailHref,'true');
  assert.equal(detail.status,200);
  assert.deepEqual((await detail.json() as any).work,current.works.find((work:any)=>work.id===item.id));
 }
});
test('enabled actual Worker serves the reviewed API and script-free detail HTML',async()=>{
 const response=await invoke('/api/discovery/v1/works','true');assert.equal(response.status,200);assert.match(response.headers.get('x-content-type-options')??'',/nosniff/);
 const result=await response.json() as any;assert.equal(result.totalWorks,current.works.length);
 for(const work of result.items){
  const detail=await invoke('/api/discovery/v1/works/'+encodeURIComponent(work.id),'true');assert.equal(detail.status,200);assert.deepEqual((await detail.json() as any).work,work);
  const html=await invoke('/discover/work/'+encodeURIComponent(work.id),'true');assert.equal(html.status,200);const body=await html.text();assert.ok(body.includes(work.title.value));assert.ok(!body.includes('source-observations.json'));assert.ok(!body.includes('candidateId'));assert.ok(!body.includes('<script'));assert.ok(html.headers.get('content-security-policy'));
  const head=await invoke('/discover/work/'+encodeURIComponent(work.id),'true','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
 const list=await invoke('/discover/works','true');assert.equal(list.status,200);assert.ok((await list.text()).includes(`${current.works.length} matching works`));
 assert.equal((await invoke('/api/discovery/v1/works','true','POST')).status,405);
 assert.equal((await invoke('/api/discovery/v1/works?q=a&q=b','true')).status,400);
 assert.equal((await invoke('/api/discovery/v1/creators/unknown','true')).status,404);
 assert.equal((await invoke('/api/discovery/v1/works/%ZZ','true')).status,400);
});

test('homepage search points to the directory only with the exact Worker setting', () => {
  const copy = (flag: unknown) => primaryNoscript('/', 'https://thevalleydesk.org', [], undefined, undefined,
    publicFeaturesFromEnv({DISCOVERY_DIRECTORY_ENABLED: flag}));
  for (const flag of [undefined, 'false', true]) assert.doesNotMatch(copy(flag), /\/discover\/works/);
  const html = copy('true');
  assert.match(html, /<form role="search" action="\/discover\/works" method="get">/);
  assert.match(html, /name="q" type="search"/);
  assert.match(html, /feed\.json/);
});
