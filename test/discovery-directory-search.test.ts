import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectoryQuery, readDirectoryList } from '../src/ingest/discovery-directory-search';

// Synthetic fixtures exercise search rules, not real-world review or attribution.
function work(id:string, kind:'repository'|'publication', title:string, nativeId:string) {
  const ev=`ev:${id}`, review=`review:${id}`;
  return {schemaVersion:'discovery-directory-work-v1',id,revision:1,kind,nativeIdentity:{provider:kind==='repository'?'github':'crossref',namespace:null,nativeId,evidenceId:ev},title:{value:title,evidenceId:ev},url:{value:`https://example.org/${id}`,evidenceId:ev},description:null,owner:null,sourceDate:null,checkedAt:'2026-11-16',evidence:[{id:ev,sourceUrl:`https://example.org/source/${id}`,observedDate:'2026-11-16',observationSha256:'a'.repeat(64),pointer:'/title',method:'provider-metadata'}],reviewRefs:[{id:review,receiptSha256:'b'.repeat(64)}],claims:[{id:`${id}:health`,subjectId:id,evidenceIds:[ev],reviewId:review,kind:'health-purpose',text:'Research on sleep signals'},{id:`${id}:region`,subjectId:id,evidenceIds:[ev],reviewId:review,kind:'regional-connection',institution:'Rutgers University–Camden',campus:null,municipality:'Camden',state:'NJ',regionalBasis:'municipality',county:'Camden',asOf:{precision:'year',value:'2024'},subjectRole:'work',subjectLabel:'Historical project',sourceAuthorIndex:null,affiliationEvidenceIds:[ev],geographyEvidenceIds:[ev],scope:'historical',qualification:'Dated association'}] as any[],relations:[] as any[]};
}
function topic(w:ReturnType<typeof work>) {w.claims.push({id:`${w.id}:ml`,subjectId:w.id,evidenceIds:[w.evidence[0].id],reviewId:w.reviewRefs[0].id,kind:'topic',topic:'machine-learning',vocabularyRevision:'directory-topics-v1'});}
function edge(a:ReturnType<typeof work>,b:ReturnType<typeof work>,id:string){a.relations.push({id,fromId:a.id,toId:b.id,predicate:'repository-cites-work',evidenceIds:[a.evidence[0].id],reviewId:a.reviewRefs[0].id});}
const snap=(...works:ReturnType<typeof work>[])=>({schemaVersion:'discovery-directory-snapshot-v1',version:'synthetic-v1',works});

test('AI requires a reviewed topic, whole-token matching and same-source explanations',async()=>{
  const a=work('repo-a','repository','Sleep toolkit','101');topic(a);
  const b=work('repo-b','repository','Brain study','102');b.claims[0].text='Neuro research';
  const result=await readDirectoryList(snap(a,b),{q:'sleep AI'});
  assert.deepEqual(result.items.map(w=>w.id),['repo-a']);
  assert.ok(result.matches[0].claimIds.includes('repo-a:ml'));
  assert.deepEqual((await readDirectoryList(snap(b),{q:'AI'})).items,[]);
  assert.deepEqual((await readDirectoryList(snap(a,b),{q:'!!!'})).items,[]);
  assert.deepEqual((await readDirectoryList(snap(a,b),{q:'machine learning'})).items.map(w=>w.id),['repo-a']);
});

test('one related work can supply a dated county without reversing the citation',async()=>{
  const repo=work('repo','repository','Sleep toolkit','101'); topic(repo); repo.claims[1].institution='Example Lab';repo.claims[1].county=null;repo.claims[1].municipality='Trenton';
  const paper=work('paper','publication','Sleep research','10.1000/sleep');edge(repo,paper,'edge:repo-paper');
  const result=await readDirectoryList(snap(repo,paper),{q:'Camden sleep',kind:'repository'});
  assert.deepEqual(result.items.map(w=>w.id),['repo']);assert.deepEqual(result.supportItems.map(w=>w.id),['paper']);
  assert.equal(result.matchingWorks,1);assert.equal(result.matches[0].predicate,'repository-cites-work');assert.equal(result.matches[0].relationFromId,'repo');assert.equal(result.matches[0].relationToId,'paper');assert.ok(result.matches[0].claimIds.includes('paper:region'));
  assert.deepEqual((await readDirectoryList(snap(repo,paper),{q:'Rutgers–Camden',kind:'repository'})).items.map(w=>w.id),['repo']);
  assert.deepEqual((await readDirectoryList(snap(repo,paper),{q:'Camden County',kind:'repository'})).items.map(w=>w.id),['repo']);
});

test('unrelated neighbors cannot be combined and county facets do not infer city',async()=>{
  const a=work('repo','repository','Other work','101');a.claims[0].text='Research toolkit';a.claims[1].institution='Example';a.claims[1].municipality='Trenton';a.claims[1].county=null;
  const b=work('camden','publication','Regional project','10.1000/camden');b.claims[0].text='Research toolkit';
  const c=work('sleep','publication','Sleep research','10.1000/sleep');c.claims[1].institution='Princeton University';c.claims[1].municipality='Princeton';c.claims[1].county='Mercer';
  edge(a,b,'edge:a');edge(a,c,'edge:b');
  const result=await readDirectoryList(snap(a,b,c),{q:'Camden sleep',kind:'repository'});assert.equal(result.matchingWorks,0);
  const solo=work('solo','repository','Other work','103');solo.claims[1].county=null;solo.claims[1].municipality='Trenton';
  assert.equal((await readDirectoryList(snap(solo),{county:'Camden'})).matchingWorks,0);
});

test('facets count distinct works in one generation; cursors bind all filters and content',async()=>{
  const a=work('repo-a','repository','Sleep toolkit','101');topic(a);const b=work('repo-b','repository','Sleep device','102');
  const data=snap(a,b),first=await readDirectoryList(data,{q:'sleep',limit:1});
  assert.equal(first.matchingWorks,2);assert.deepEqual(first.facets.kind,[{value:'repository',count:2}]);assert.deepEqual(first.facets.topic,[{value:'machine-learning',count:1}]);
  assert.equal((await readDirectoryList(data,{q:'sleep',limit:1,after:first.nextAfter})).items.length,1);
  await assert.rejects(readDirectoryList(data,{q:'sleep',limit:1,after:first.nextAfter,county:'Camden'}),/restart/);
  b.title.value='Changed';await assert.rejects(readDirectoryList(data,{q:'sleep',limit:1,after:first.nextAfter}),/restart/);
  assert.throws(()=>parseDirectoryQuery(new URLSearchParams('topic=sleep&topic=sleep')));
});

test('empty All facets are omitted while repeated or whitespace facet values fail',()=>{
  const q=parseDirectoryQuery(new URLSearchParams('q=sleep&kind=&topic=&county=&institution='));
  assert.equal(q.q,'sleep');assert.equal(q.kind,undefined);assert.equal(q.topic,undefined);assert.equal(q.county,undefined);assert.equal(q.institution,undefined);
  assert.throws(()=>parseDirectoryQuery(new URLSearchParams('county=&county=')));
  assert.throws(()=>parseDirectoryQuery(new URLSearchParams('county=%20')));
  assert.throws(()=>parseDirectoryQuery(new URLSearchParams('institution=%20')));
});
test('facet options cannot borrow a topic from a different related work',async()=>{
  const a=work('repo','repository','Sleep toolkit','101');a.claims[1].institution='Example';a.claims[1].municipality='Trenton';a.claims[1].county=null;
  const camden=work('camden','publication','Camden research','10.1000/camden');
  const mercer=work('mercer','publication','Other research','10.1000/mercer');mercer.claims[1].institution='Princeton University';mercer.claims[1].municipality='Princeton';mercer.claims[1].county='Mercer';topic(mercer);
  edge(a,camden,'edge:camden');edge(a,mercer,'edge:mercer');
  const r=await readDirectoryList(snap(a,camden,mercer),{q:'Camden sleep',kind:'repository'});
  assert.deepEqual(r.items.map(w=>w.id),['repo']);assert.equal(r.facets.topic.some(f=>f.value==='machine-learning'),false);
  assert.equal((await readDirectoryList(snap(a,camden,mercer),{q:'Camden sleep',kind:'repository',topic:'machine-learning'})).matchingWorks,0);
});
test('nonempty relevance orders dated own matches before unknown dates and stable ties',async()=>{
  const a=work('a','repository','Sleep toolkit','101'), b=work('b','repository','Sleep toolkit','102'), c=work('c','repository','Sleep toolkit','103');
  (b as any).sourceDate={value:{precision:'year',value:'2023'},evidenceId:b.evidence[0].id};
  (c as any).sourceDate={value:{precision:'year',value:'2024'},evidenceId:c.evidence[0].id};
  assert.deepEqual((await readDirectoryList(snap(a,b,c),{q:'sleep'})).items.map(w=>w.id),['c','b','a']);
  assert.deepEqual((await readDirectoryList(snap(a,b,c),{})).items.map(w=>w.id),['a','b','c']);
});

test('long Unicode query paginates through the public query parser',async()=>{
  const text='界'.repeat(200), a=work('repo-a','repository',text,'101'), b=work('repo-b','repository',text,'102');
  const initial=parseDirectoryQuery(new URLSearchParams({q:text,limit:'1'}));
  const first=await readDirectoryList(snap(a,b),initial);assert.ok(first.nextAfter);
  const nextParams=new URLSearchParams({q:text,limit:'1',after:first.nextAfter!});
  assert.ok(nextParams.toString().length<=4096);
  const second=await readDirectoryList(snap(a,b),parseDirectoryQuery(nextParams));
  assert.equal(second.items[0].id,'repo-b');
});
test('full governed Rutgers name in search agrees with its institution facet',async()=>{
  const a=work('repo-a','repository','Sleep toolkit','101');
  const input=snap(a), q='Rutgers, The State University of New Jersey, Camden';
  const searched=await readDirectoryList(input,{q});const filtered=await readDirectoryList(input,{institution:q});
  assert.deepEqual(searched.items.map(w=>w.id),['repo-a']);
  assert.deepEqual(searched.items.map(w=>w.id),filtered.items.map(w=>w.id));
});
test('200-character Unicode query paginates through API and HTML next links',async()=>{
  const {handleDiscoveryDirectory}=await import('../src/ingest/discovery-directory-http');
  const {handleDiscoveryDirectoryPage}=await import('../src/ingest/discovery-directory-page');
  const q='界'.repeat(200), a=work('repo-a','repository',q,'101'), b=work('repo-b','repository',q,'102');
  const data=snap(a,b), removals={schemaVersion:'discovery-directory-removals-v1',snapshotVersion:data.version,removedIds:[]},env={DISCOVERY_DIRECTORY_ENABLED:'true'};
  const params=new URLSearchParams({q,limit:'1'});
  const first=await handleDiscoveryDirectory(new Request(`https://example.org/api/discovery/v1/works?${params}`),env,data,removals);
  assert.equal(first.status,200);const body=await first.json() as {nextAfter:string};assert.ok(body.nextAfter);
  params.set('after',body.nextAfter);
  const second=await handleDiscoveryDirectory(new Request(`https://example.org/api/discovery/v1/works?${params}`),env,data,removals);assert.equal(second.status,200);
  const page=await handleDiscoveryDirectoryPage(new Request(`https://example.org/discover/works?${new URLSearchParams({q,limit:'1'})}`),env,data,removals);
  assert.equal(page.status,200);const html=await page.text(), href=html.match(/href="([^"]+)"[^>]*>Next page<\/a>/)?.[1];assert.ok(href);
  const next=await handleDiscoveryDirectoryPage(new Request(new URL(href.replaceAll('&amp;','&'),'https://example.org')),env,data,removals);assert.equal(next.status,200);
});

test('maximum Unicode query and institution retain their cursor budget',async()=>{
  const {handleDiscoveryDirectory}=await import('../src/ingest/discovery-directory-http');
  const {handleDiscoveryDirectoryPage}=await import('../src/ingest/discovery-directory-page');
  const q='界'.repeat(200), institution='學'.repeat(200), a=work('repo-a','repository',q,'101'), b=work('repo-b','repository',q,'102');
  a.claims[1].institution=institution;b.claims[1].institution=institution;
  const data=snap(a,b), removals={schemaVersion:'discovery-directory-removals-v1',snapshotVersion:data.version,removedIds:[]}, env={DISCOVERY_DIRECTORY_ENABLED:'true'};
  const params=new URLSearchParams({q,institution,limit:'1',kind:'repository',sort:'relevance'});assert.ok(params.toString().length<=4096);
  const first=await handleDiscoveryDirectory(new Request(`https://example.org/api/discovery/v1/works?${params}`),env,data,removals);assert.equal(first.status,200);
  const body=await first.json() as {nextAfter:string};assert.ok(body.nextAfter);params.set('after',body.nextAfter);
  assert.ok(params.toString().length<=8192);
  const next=await handleDiscoveryDirectory(new Request(`https://example.org/api/discovery/v1/works?${params}`),env,data,removals);assert.equal(next.status,200);
  params.delete('after');const page=await handleDiscoveryDirectoryPage(new Request(`https://example.org/discover/works?${params}`),env,data,removals);assert.equal(page.status,200);
  const href=(await page.text()).match(/href="([^"]+)"[^>]*>Next page<\/a>/)?.[1];assert.ok(href);
  const pageNext=await handleDiscoveryDirectoryPage(new Request(new URL(href.replaceAll('&amp;','&'),'https://example.org')),env,data,removals);assert.equal(pageNext.status,200);
});
