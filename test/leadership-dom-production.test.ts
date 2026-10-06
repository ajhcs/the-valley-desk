import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coveragePack,CoveragePackDocument} from '../src/ingest/coverage-pack';
import {monitorLeadershipSources,type ScheduledLeadershipState} from '../src/ingest/leadership-monitor';
const source=coveragePack.sources.find(s=>s.id==='src-chop-leadership')!;
const pack=CoveragePackDocument.parse({...coveragePack,people:[],sources:[{...source,alternateUrls:[]}]});
const good='<main id="main-content"><h1>CHOP Executive Leadership</h1><chop-basic-card><div><p>Chief Information Officer</p></div><div><h2>Jordan Example, MBA</h2></div></chop-basic-card></main>';
const prior:ScheduledLeadershipState={sourceId:source.id,state:'healthy',lastHash:'previous-qualified-hash',lastExtracted:[{name:'Previous Example',title:'Chief Information Officer',normalizedName:'previous example',normalizedTitle:'chief information officer'}],lastSuccessAt:'2026-10-05T00:00:00Z',lastAttemptedAt:'2026-10-05T00:00:00Z',nextAttemptAt:'2026-10-05T00:00:00Z',consecutiveFailures:0,lastError:null};
async function collect(html:string,state=prior,now=new Date('2026-10-06T18:00:00Z')){
 return monitorLeadershipSources({pack,states:new Map([[source.id,state]]),now,fetchImpl:async input=>{
 const url=input instanceof Request?input.url:String(input);return new Response(new URL(url).pathname==='/robots.txt'?'User-agent: *\nAllow: /\n':html,{headers:{'content-type':new URL(url).pathname==='/robots.txt'?'text/plain':'text/html'}});
 }});
}
test('production monitor retains DOM review candidates without freshness, role change or departure authority',async()=>{
 const first=await collect(good);assert.equal(first.snapshots.length,1);const snapshot=first.snapshots[0];assert.equal(snapshot.extracted.length,1);assert.equal(snapshot.extracted[0].name,'Jordan Example');assert.equal((snapshot.extracted[0] as any).currentAffiliationVerified,false);
 assert.equal(snapshot.extractionStatus,'partial');assert.equal(snapshot.state,'failed');assert.match(snapshot.error!,/DOM parser candidates retained for review/);assert.equal(snapshot.markupCapture,undefined);
 assert.equal(first.schedule[0].lastSuccessAt,prior.lastSuccessAt);assert.deepEqual(first.schedule[0].lastExtracted,prior.lastExtracted);
 assert.deepEqual(first.observations,[]);
 const next={...first.schedule[0],nextAttemptAt:'2026-10-06T00:00:00Z'};const second=await collect(good,next,new Date('2026-10-07T18:00:00Z'));
 assert.equal(second.snapshots[0].state,'failed');assert.equal(second.snapshots[0].extractionStatus,'partial');assert.equal(second.schedule[0].lastSuccessAt,prior.lastSuccessAt);assert.ok(second.observations.every(o=>!['person-appeared','person-departed','title-changed'].includes(o.kind)));
});
test('scoped production DOM source cannot fall back to legacy field borrowing or article claims',async()=>{
 for(const html of ['<main id="main-content"><h1>CHOP Executive Leadership</h1><h2>Jordan Example</h2><p>Chief Information Officer</p></main>','<meta property="og:type" content="article">'+good,good.replace('Jordan Example, MBA','Jordan Example, &lt;section&gt;fragment&lt;/section&gt;')]){
 const r=await collect(html);assert.equal(r.snapshots[0].extracted.length,0);assert.equal(r.snapshots[0].extractionStatus,'unrecognized');assert.equal(r.schedule[0].lastSuccessAt,prior.lastSuccessAt);
 }
});

test('configured alternate path cannot inherit primary source DOM identity',async()=>{
 const alternate=source.url+'/alternate';const r=await monitorLeadershipSources({pack:{...pack,sources:[{...source,alternateUrls:[alternate]}]},now:new Date('2026-10-06T18:00:00Z'),fetchImpl:async input=>new Response(String(input).endsWith('/alternate')?good:'<main>unrecognized</main>',{headers:{'content-type':'text/html'}})});
 assert.equal(r.snapshots[0].extracted.length,0);assert.equal(r.snapshots[0].extractionStatus,'unrecognized');assert.equal(r.snapshots[0].state,'failed');
});

test('DOM scope preserves explicit challenge and empty response safety classification',async()=>{
 const challenge=await collect('<html><head><script src="/_Incapsula_Resource?synthetic"></script></head><body></body></html>');
 assert.equal(challenge.snapshots[0].extractionStatus,'challenge');assert.equal(challenge.snapshots[0].state,'hostile');assert.equal(challenge.snapshots[0].instructionLike,true);assert.deepEqual(challenge.observations.map(o=>o.kind),['hostile-content']);assert.equal(challenge.schedule[0].lastSuccessAt,prior.lastSuccessAt);
 const empty=await collect('<html><body></body></html>');assert.equal(empty.snapshots[0].extractionStatus,'empty-unverified');assert.equal(empty.snapshots[0].state,'failed');assert.deepEqual(empty.observations,[]);assert.equal(empty.schedule[0].lastSuccessAt,prior.lastSuccessAt);
});
test('a true transport failure still emits the existing fetch-failed observation',async()=>{
 const r=await monitorLeadershipSources({pack,states:new Map([[source.id,prior]]),now:new Date('2026-10-06T18:00:00Z'),fetchImpl:async()=>{throw new Error('synthetic network failure');}});assert.equal(r.snapshots[0].extractionStatus,'partial');assert.equal(r.snapshots[0].state,'failed');assert.equal(r.snapshots[0].extracted.length,0);assert.deepEqual(r.observations.map(o=>o.kind),['fetch-failed']);assert.equal(r.schedule[0].lastSuccessAt,prior.lastSuccessAt);
});
