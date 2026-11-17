import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { validateRows, expand } from '../src/ingest/discovery/research-network-expansion.ts';
const base='docs/discovery/go-live/evidence/GL05/regional-expansion-20261117';
const d=JSON.parse(readFileSync(`${base}/drexel-v3/source-assertions.json`,'utf8'));
const v=JSON.parse(readFileSync(`${base}/villanova/source-assertions.json`,'utf8'));
test('source adapters reject missing or unexpected fields, source references and authority', () => {
 const a=v.projects[0]; assert.equal(validateRows('villanova','projects',[a]).length,1);
 assert.throws(()=>validateRows('villanova','projects',[{...a,url:null}]));
 const {url: _url,...missing}=a; assert.throws(()=>validateRows('villanova','projects',[missing]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,contact:'unsafe'}]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,sourceRefs:['README.md#L0']}]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,nativeId:'123'}]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,evidenceUrls:['https://user:pass@example.com/x']}]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,url:'https://user:pass@example.com/x'}]));
 assert.throws(()=>validateRows('villanova','projects',[{...a,publicationAuthorized:true}]));
 const r=d.repositories[0]; assert.throws(()=>validateRows('drexel','repositories',[{...r,created_at:'2026-02-30T00:00:00Z'}]));
 assert.throws(()=>validateRows('drexel','repositories',[{...r,fork:'unknown'}]));
 assert.throws(()=>validateRows('drexel','repositories',[{...r,sourceRef:{file:'../bad',row:2}}]));
});
test('federation deduplicates URLs, retains source contexts and rejects conflicting native IDs', () => {
 const observation=(id:string,batch:string,nativeId:string|null)=>({id,batch,kind:'repository',url:'https://github.com/X/Y',nativeId,observedDate:null,fields:{status:'reported'}});
 const old=observation('old:1','old','10'), newer=observation('new:1','new',null);
 const result=expand([old],[],[],[newer]); assert.equal(result.repositories.length,1); assert.deepEqual(result.repositories[0].observations,['old:1','new:1']);
 assert.throws(()=>expand([old],[],[],[{...newer,nativeId:'11'}]),/Conflicting/);
});
test('accepted observations and source-scoped graph are preserved; external resources are separate', () => {
 const old=JSON.parse(readFileSync('docs/discovery/go-live/evidence/GL05/regional-import-20261117/qualification-queue.json','utf8'));
 const graph=JSON.parse(readFileSync('docs/discovery/go-live/evidence/GL05/regional-import-20261117/research-network.json','utf8'));
 const q=JSON.parse(readFileSync(`${base}/qualification-queue.json`,'utf8'));
 const n=JSON.parse(readFileSync(`${base}/research-network.json`,'utf8'));
 assert.deepEqual(q.observations.slice(0,old.observations.length),old.observations);
 assert.deepEqual(n.nodes,graph.nodes); assert.deepEqual(n.edges,graph.edges);
 assert.equal(q.observations.filter((o:any)=>o.urlKind==='external-resource').length,2);
 assert.equal(n.counts.nativeRepositories,231); assert.equal(n.counts.drexelBroadRootChecks,2197);
});
