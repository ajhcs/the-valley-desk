import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalDirectoryJson,directorySha256,validateDirectorySelection} from '../src/ingest/discovery/directory-review';
import {readDirectoryList} from '../src/ingest/discovery-directory-search';

// Test trust exercises the proposed six-work input; it is not production approval.
async function input() {
  const selection=JSON.parse(await readFile('docs/discovery/go-live/evidence/GL05/selection.json','utf8'));
  const prior=JSON.parse(await readFile('docs/discovery/go-live/evidence/GL04/generation-report.json','utf8')).nextPriorState;
  const {snapshot}=await validateDirectorySelection(selection,{selectionSha256:await directorySha256(canonicalDirectoryJson(selection)),operator:'agent:root',reviewer:'agent:sol_gl04_review',priorState:prior},p=>readFile(p));
  const actual=JSON.parse(await readFile('src/content/discovery-directory-catalog.json','utf8'));
  assert.deepEqual(actual,snapshot,'generated public snapshot differs from the reviewed selection');
  const tasks=JSON.parse(await readFile('docs/discovery/go-live/evidence/GL05/query-tasks.json','utf8'));
  return {snapshot,tasks};
}
const native=(w:any)=>w.nativeIdentity ? `${w.nativeIdentity.provider}:${w.nativeIdentity.nativeId.toLowerCase()}` : '';
test('frozen GL05 tasks find every required reviewed work',async()=>{
  const {snapshot,tasks}=await input();assert.equal(snapshot.works.length,6);
  for(const task of tasks.tasks.filter((x:any)=>Array.isArray(x.require)))for(const q of task.queries){
    const result=await readDirectoryList(snapshot,{q});const ids=result.items.map(native);
    for(const key of task.require)assert.ok(ids.includes(tasks.identities[key].toLowerCase()),`${task.id} ${q} missing ${key}`);
  }
});
test('frozen kind journeys retain correct one-hop sources and distinct support counts',async()=>{
  const {snapshot,tasks}=await input();
  for(const id of ['camden-sleep','sleep-ai','camden-county','gloucester-county','rutgers-camden']){
    const task=tasks.tasks.find((x:any)=>x.id===id);
    for(const q of task.queries)for(const kind of ['repository','publication']){
      const result=await readDirectoryList(snapshot,{q,kind});const expected=task.require.map((k:string)=>tasks.identities[k].toLowerCase()).filter((v:string)=>v.startsWith(kind==='repository'?'github:':'crossref:'));
      for(const x of expected)assert.ok(result.items.map(native).includes(x),`${id} ${q} ${kind} missing ${x}`);
      assert.ok(result.items.every(w=>w.kind===kind));assert.equal(result.supportCount,result.supportItems.length);
    }
  }
  const result=await readDirectoryList(snapshot,{q:'Camden County',kind:'repository'});
  const hit=result.items.find(w=>native(w)===tasks.identities.sleepRepository);
  assert.ok(hit);const match=result.matches.find(m=>m.workId===hit.id);assert.equal(match?.predicate,'repository-cites-work');assert.equal(match?.relationFromId,hit.id);
  assert.ok(result.supportItems.some(w=>native(w)===tasks.identities.sleepPublication));
});
test('all six exact identities and original URLs resolve, unrelated conjunctions do not join',async()=>{
  const {snapshot}=await input();
  for(const work of snapshot.works){
    for(const q of [work.id,work.nativeIdentity!.nativeId,work.url.value])assert.ok((await readDirectoryList(snapshot,{q})).items.some(w=>w.id===work.id),`${work.id} missing exact ${q}`);
  }
  for(const q of ['ExerciseCESTv2 Mercer County','SleepBoost Gloucester County','OpenPBTA Camden County'])assert.equal((await readDirectoryList(snapshot,{q})).matchingWorks,0,q);
});
test('county, topic and institution facets use the same six-work generation and reset',async()=>{
  const {snapshot,tasks}=await input();
  const cases=[['Camden',['sleepRepository','sleepPublication']],['Mercer',['gastonPublication']],['Gloucester',['openPbtaRepository','openPbtaPublication']]] as const;
  for(const [county,keys] of cases){const result=await readDirectoryList(snapshot,{county});for(const key of keys)assert.ok(result.items.map(native).includes(tasks.identities[key].toLowerCase()),`${county} facet missing ${key}`);assert.equal(result.totalWorks,6);}
  for(const topic of ['sleep','machine-learning']){const result=await readDirectoryList(snapshot,{topic});for(const key of ['sleepRepository','sleepPublication'])assert.ok(result.items.map(native).includes(tasks.identities[key].toLowerCase()),`${topic} facet missing ${key}`);}
  for(const institution of ['Rutgers-Camden','Rutgers–Camden','Rutgers University–Camden']){const result=await readDirectoryList(snapshot,{institution});for(const key of ['sleepRepository','sleepPublication'])assert.ok(result.items.map(native).includes(tasks.identities[key].toLowerCase()),`${institution} facet missing ${key}`);}
  assert.equal((await readDirectoryList(snapshot,{q:'Mercer County',kind:'repository'})).matchingWorks,0);
  const reset=await readDirectoryList(snapshot,{});assert.equal(reset.matchingWorks,6);assert.equal(reset.supportCount,0);
  assert.deepEqual((await readDirectoryList(snapshot,{q:'sleep'})).items.map(w=>w.id),(await readDirectoryList(snapshot,{q:'sleep'})).items.map(w=>w.id));
});
