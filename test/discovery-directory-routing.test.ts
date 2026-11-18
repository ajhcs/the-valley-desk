import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {primaryNoscript} from '../src/lib/crawler-html';
import {publicFeaturesFromEnv} from '../src/lib/public-features';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
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

test('the directory uses the same durable removal for listings, details, and historical aliases', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const table = readFileSync('ops/directory-removals.sql', 'utf8');
    database.exec(table);
    const environment = {
      PUBLIC_ORIGIN: 'https://thevalleydesk.org',
      DIRECTORY_PUBLIC_ENABLED: 'true',
      VALLEY_DESK_DB: {
        prepare: (query: string) => ({ all: async () => ({ results: database.prepare(query).all() }) }),
      },
    };
    const request = (path: string) =>
      worker.fetch(new Request('https://thevalleydesk.org' + path), environment, {});
    const home = await request('/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /action="\/discover\/works"/);
    const before = await request('/discover/work/617168725');
    assert.equal(before.status, 200);
    assert.match(await before.text(), /10\.1007\/s11517-024-03096-x/);
    const alias = '/discover/work/GL05%3Awork%3Acrossref%3Asleepboost';
    assert.equal((await request(alias)).headers.get('location'), '/discover/work/617168725');
    database.exec("INSERT INTO public_directory_removals (github_id) VALUES ('617168725')");
    database.exec(table);
    const search = await request('/discover/works?q=SleepBoost');
    assert.equal(search.status, 200);
    assert.doesNotMatch(await search.text(), /href="\/discover\/work\/617168725"/);
    assert.equal((await request('/discover/work/617168725')).status, 410);
    assert.equal((await request(alias)).status, 410);
    const missing = await worker.fetch(new Request('https://thevalleydesk.org/discover/work/617168725'),
      { ...environment, VALLEY_DESK_DB: undefined }, {});
    assert.equal(missing.status, 503);
    assert.doesNotMatch(await missing.text(), /github\.com\/akibzaman/);
  } finally {
    database.close();
  }
});
