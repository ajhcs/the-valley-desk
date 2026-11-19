import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'parse5';
import {handleDiscoveryDirectoryPage} from '../src/ingest/discovery-directory-page';
import {handleDiscoveryDirectory} from '../src/ingest/discovery-directory-http';

const snapshot=()=>JSON.parse(readFileSync('src/content/discovery-directory-catalog.json','utf8'));
const env={DISCOVERY_DIRECTORY_ENABLED:'true'};
const req=(path:string)=>new Request('https://directory.example'+path);
const removed=(s:any)=>({schemaVersion:'discovery-directory-removals-v1',snapshotVersion:s.version,removedIds:[]});
function nodes(html:string,tag:string):any[]{
 const out:any[]=[];function walk(n:any){if(n.tagName===tag)out.push(n);for(const c of n.childNodes??[])walk(c);}walk(parse(html));return out;
}
const attr=(n:any,name:string)=>n.attrs.find((a:any)=>a.name===name)?.value;
test('search GET form preserves every filter, omits cursor and offers an unfiltered reset',async()=>{
 const s=snapshot();const params=new URLSearchParams({q:'Camden sleep',kind:'repository',county:'Camden',topic:'machine-learning',institution:'Rutgers University–Camden',sort:'source-date-desc',limit:'1'});
 const page=await handleDiscoveryDirectoryPage(req('/discover/works?'+params),env,s,removed(s));assert.equal(page.status,200);
 const html=await page.text();const forms=nodes(html,'form');assert.equal(forms.length,1);assert.equal(attr(forms[0],'method'),'get');
 for(const name of ['kind','county','topic','institution','sort']){
  const select=nodes(html,'select').find(n=>attr(n,'name')===name);assert.ok(select,name);
  const selected=select.childNodes.find((n:any)=>n.tagName==='option'&&n.attrs.some((a:any)=>a.name==='selected'));assert.equal(attr(selected,'value'),params.get(name));
 }
 assert.equal(attr(nodes(html,'input').find(n=>attr(n,'name')==='q'),'value'),'Camden sleep');
 assert.equal(nodes(html,'input').filter(n=>attr(n,'name')==='after').length,0);
 assert.ok(nodes(html,'a').some(n=>attr(n,'href')==='/discover/works'));
 assert.equal(nodes(html,'script').length,0);
 assert.match(html,/directly linked work|Match in this work/);assert.match(html,/facet counts works after the other selected filters/);
 const api=await handleDiscoveryDirectory(req('/api/discovery/v1/works?'+params),env,s,removed(s));assert.equal(api.status,200);const data:any=await api.json();
 assert.ok(html.includes(`${data.matchingWorks} matching works`));assert.equal(data.supportCount,data.supportItems.length);
});
test('default form submission, empty results, invalid controls and stale cursors have usable states',async()=>{
 const s=snapshot(),meta=removed(s);
 const all=await handleDiscoveryDirectoryPage(req('/discover/works?q=&kind=&topic=&county=&institution=&sort=relevance&limit=25'),env,s,meta);assert.equal(all.status,200);
 const empty=await handleDiscoveryDirectoryPage(req('/discover/works?q=doesnotexist&county=Camden'),env,s,meta);assert.equal(empty.status,200);const html=await empty.text();assert.match(html,/No matching works/);assert.match(html,/value="Camden" selected/);
 for(const q of ['county=unknown','topic=AI','kind=&kind=repository','sort=random'])assert.equal((await handleDiscoveryDirectoryPage(req('/discover/works?'+q),env,s,meta)).status,400);
 const data:any=await (await handleDiscoveryDirectory(req('/api/discovery/v1/works?limit=1'),env,s,meta)).json();assert.ok(data.nextAfter);
 const cursor=new URLSearchParams({q:'sleep',limit:'1',after:data.nextAfter});const stale=await handleDiscoveryDirectoryPage(req('/discover/works?'+cursor),env,s,meta);assert.equal(stale.status,409);assert.match(await stale.text(),/Restart search/);
});
test('pagination links preserve filters and escaped input remains text',async()=>{
 const s=snapshot(),meta=removed(s);
 const page=await handleDiscoveryDirectoryPage(req('/discover/works?county=Camden&limit=1&sort=title-asc'),env,s,meta);assert.equal(page.status,200);const html=await page.text();
 const next=nodes(html,'a').map(n=>attr(n,'href')).find(h=>h?.includes('after='));assert.ok(next);const url=new URL(next,'https://directory.example');assert.equal(url.searchParams.get('county'),'Camden');assert.equal(url.searchParams.get('sort'),'title-asc');assert.equal(url.searchParams.get('limit'),'1');
 const attack=new URLSearchParams({q:'<img src=x onerror=alert(1)>'});const safe=await (await handleDiscoveryDirectoryPage(req('/discover/works?'+attack),env,s,meta)).text();assert.equal(nodes(safe,'img').length,0);assert.equal(attr(nodes(safe,'input').find(n=>attr(n,'name')==='q'),'value'),attack.get('q'));
});

test('compact cards and details preserve source dates, optional fields, and issue-draft scope', async () => {
  const s = snapshot(), meta = removed(s);
  const repo = s.works.find((work: any) => work.kind === 'repository' && work.sourceDate === null);
  assert.ok(repo);
  const list = await handleDiscoveryDirectoryPage(req('/discover/works'), env, s, meta);
  const html = await list.text();
  const card = nodes(html, 'article').find(node => attr(node, 'data-work-id') === repo.id);
  assert.ok(card);
  const readText = (node: any): string => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(readText).join('');
  assert.match(readText(card), /Project connection/);
  assert.match(readText(card), new RegExp(repo.checkedAt));
  assert.doesNotMatch(readText(card), /Source date:|Review references|Source account:/);
  assert.ok(nodes(html, 'a').some(a => attr(a, 'href') === repo.url.value && readText(a) === 'Open repository'));
  const page = await handleDiscoveryDirectoryPage(req('/discover/work/' + encodeURIComponent(repo.id)), env, s, meta);
  const detail = await page.text();
  assert.equal(nodes(detail, 'h1').length, 1);
  assert.equal(nodes(detail, 'summary').map(readText).join(''), 'Sources and review');
  const issueLink = nodes(detail, 'a').find(a => readText(a) === 'Report an issue');
  const draft = new URL(attr(issueLink, 'href'));
  assert.equal(draft.protocol, 'mailto:');
  assert.equal(draft.pathname, 'leads@thevalleydesk.org');
  assert.deepEqual([...draft.searchParams], [['subject', 'Research listing correction'], ['body', 'Work ID: ' + repo.id]]);
});

test('an empty catalog is distinct from zero matches', async () => {
  const s = snapshot();
  s.works = [];
  const page = await handleDiscoveryDirectoryPage(req('/discover/works'), env, s, removed(s));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /No works are listed yet/);
});
