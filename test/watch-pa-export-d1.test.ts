import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy,unstable_splitSqlQuery } from 'wrangler';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { syntheticZip,syntheticXml,records } from './fixtures/pa-export/synthetic';
import { qualifyCapturedWatchSource } from '../scripts/lib/watch-source-qualification';
import { configureWatchCollectionSource,resolveWatchCollectionEvidence,revokeWatchCollectionReview } from '../src/ingest/watch/collection-storage';
import { runWatchCollection } from '../src/ingest/watch/collector';
import { readWatchDirectory } from '../src/ingest/watch-persistence';
import { assertCollectedPolicySourceRule } from '../src/ingest/policy-source-rule';
import { readPolicyWatchCapture } from '../src/ingest/policy-watch-workflow';
import { sha256 } from '../src/content/watch-schema';
import type { D1DatabaseLike } from '../src/ingest/persistence';

test('synthetic qualified binary source traverses local D1 raw ack/native replay/acceptance; receipts refresh without duplicate facts',{timeout:120000},async t=>{
 const proxy=await getPlatformProxy<{WATCH_TEST_DB:D1DatabaseLike}>({configPath:fileURLToPath(new URL('./fixtures/watch-d1/wrangler.jsonc',import.meta.url)),envFiles:[],persist:false,remoteBindings:false});
 t.after(()=>proxy.dispose());const db=proxy.env.WATCH_TEST_DB,migrations=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name,migrations),'utf8')).map(sql=>db.prepare(sql)));
 const candidate={...launchCandidate('candidate-pa-export').source,id:'synthetic-pa-export-d1',name:'Synthetic PA binary test only'};
 const bytes=syntheticZip(),at='2026-09-30T20:30:00.000Z';
 // All original-capture and rights/access receipts below are fabricated test state only.
 const samples=await Promise.all(['2026-09-30T20:00:00.000Z','2026-09-30T20:05:00.000Z'].map(async(capturedAt,index)=>({endpoint:candidate.endpoints[0],capturedAt,bytes:index ? syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT')) : bytes,upstreamReceipt:{id:`synthetic-capture-${index}`,origin:'upstream-original',endpoint:candidate.endpoints[0],capturedAt,representationSha256:await sha256(index ? syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT')) : bytes),httpStatus:200,accessReceiptId:'synthetic-access'}})));
 const q=await qualifyCapturedWatchSource(candidate,samples,{engineeringOwnerId:'synthetic-engineer',editorialOwnerId:'synthetic-editor',statement:'Fabricated qualification and original-capture receipts for ephemeral local D1 tests only, never source rights.',reviewedAt:at,expiresAt:'2026-10-01T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read',receipts:{engineering:'synthetic-engineering',editorial:'synthetic-editorial',rights:'synthetic-rights',access:'synthetic-access'}});
 await db.prepare('INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)').bind(q.review.id,q.review.engineeringOwnerId,q.review.editorialOwnerId,q.review.evidenceSha256,q.review.qualificationSha256,q.review.acceptedAt).run();
 await configureWatchCollectionSource(db,{source:q.source,qualification:q.qualification,activationId:'synthetic-activation',cadenceSeconds:60,expectedRevision:0},at);
 const run=async(now:string,fetchImpl:typeof fetch,sourceDatabase?:D1DatabaseLike)=>{await db.prepare('UPDATE watch_collection_state SET next_due_at=?').bind(now).run();return runWatchCollection(db,{enabled:true,publishVerified:true,clock:()=>new Date(now),fetchImpl,sourceDatabase});};
 let result=await run(at,async()=>new Response(bytes,{headers:{etag:'"synthetic-zip"','content-type':'application/zip'}}));
 assert.equal(result.sources[0].state,'healthy',JSON.stringify(result));
 assert.equal(result.sources[0].health.httpStatus,200);
 let page=await readWatchDirectory(db,{kind:'policy',jurisdiction:'PA'},new Date(at));
 assert.equal(page.items.length,4,JSON.stringify(page));
 for(const item of page.items){assert.equal(item.kind,'policy');if(item.kind==='policy'){assert.equal(item.legalEffect,'unknown');assert.equal(item.lifecycle,'unknown');}}
 const base=await db.prepare('SELECT count(*) n FROM watch_public_revisions').first<{n:number}>();
 const ids=(await db.prepare('SELECT id FROM watch_raw_observations').all<{id:string}>()).results.map(r=>r.id);
 assert.equal((await resolveWatchCollectionEvidence(db,ids,at)).observations.size,4);
 const changed=syntheticZip(syntheticXml(records.join('\n').replace('3:05:00 PM EDT','4:05:00 PM EDT'),'September 30, 2026 4:30:06 PM EDT'));
 result=await run('2026-09-30T21:00:00.000Z',async()=>new Response(changed,{headers:{etag:'"synthetic-new-zip"'}}));
 assert.equal(result.sources[0].state,'healthy',JSON.stringify(result));
 for(const table of ['policy_watch_captures','watch_editorial_drafts','watch_editorial_decisions'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first<{n:number}>())!.n,4,table);
 assert.equal((await db.prepare('SELECT count(*) n FROM watch_public_revisions').first<{n:number}>())!.n,base!.n);
 assert.equal((await db.prepare('SELECT count(*) n FROM watch_raw_representations').first<{n:number}>())!.n,2);
 result=await run('2026-09-30T21:02:00.000Z',async()=>new Response(null,{status:304}));assert.equal(result.sources[0].state,'healthy');
 assert.equal(result.sources[0].health.httpStatus,304);
 const lastSuccess=result.sources[0].health.lastSuccessAt;
 result=await run('2026-09-30T21:04:00.000Z',async()=>new Response(null,{status:403}));
 assert.equal(result.sources[0].state,'upstream-blocked');assert.equal(result.sources[0].health.httpStatus,403);assert.equal(result.sources[0].health.lastSuccessAt,lastSuccess);
 // Every rejected check must preserve acknowledged evidence and the last success.
 const counts=async()=>Promise.all(['watch_raw_representations','watch_collection_pages','watch_raw_observations',
   'policy_watch_captures','watch_editorial_drafts','watch_editorial_decisions','watch_public_revisions'].map(async table=>
   (await db.prepare(`SELECT count(*) n FROM ${table}`).first<{n:number}>())!.n));
 const beforeFailureCounts=await counts();
 async function failedCheck(now:string,fetchImpl:typeof fetch,state:string,status:number|undefined,reason:RegExp,sourceDatabase?:D1DatabaseLike){
   const check=await run(now,fetchImpl,sourceDatabase),outcome=check.sources[0];
   assert.equal(outcome.state,state,JSON.stringify(check));assert.equal(outcome.health.state,state);
   assert.equal(outcome.health.httpStatus,status);assert.match(outcome.detail,reason);
   assert.equal(outcome.itemCount,0);assert.equal(outcome.checkpointAdvanced,false);
   assert.equal(outcome.health.lastSuccessAt,lastSuccess);assert.deepEqual(await counts(),beforeFailureCounts);
   const stored=await db.prepare('SELECT last_state,last_success_at,last_checked_at,failures FROM watch_collection_state').first<{last_state:string;last_success_at:string;last_checked_at:string;failures:number}>();
   assert.equal(stored!.last_state,state);assert.equal(stored!.last_success_at,lastSuccess);assert.equal(stored!.last_checked_at,now);assert.ok(stored!.failures>0);
   assert.equal((await db.prepare('SELECT state FROM watch_collection_runs ORDER BY finished_at DESC LIMIT 1').first<{state:string}>())!.state,state);
 }
 await t.test('regressed export HTTP200 is parser-failed, not an upstream outage',async()=>{
   await failedCheck('2026-09-30T21:06:00.000Z',async()=>new Response(bytes),'parser-failed',200,/pa-export-clock-regression/);
 });
 await t.test('malformed ZIP HTTP200 is parser-failed without replacing retained evidence',async()=>{
   await failedCheck('2026-09-30T21:08:00.000Z',async()=>new Response(new Uint8Array([1,2,3])),'parser-failed',200,/zip/);
 });
 await t.test('malformed XML in a valid ZIP HTTP200 is parser-failed',async()=>{
   await failedCheck('2026-09-30T21:10:00.000Z',async()=>new Response(syntheticZip('<invalid>')),'parser-failed',200,/pa-export/);
 });
 await t.test('changed bill content with unchanged bill clock HTTP200 is parser-failed',async()=>{
   const conflict=syntheticZip(syntheticXml(records.join('\n').replace('3:05:00 PM EDT','4:05:00 PM EDT').replace('An Act amending Titles','A changed Act amending Titles'),'September 30, 2026 4:35:06 PM EDT'));
   await failedCheck('2026-09-30T21:12:00.000Z',async()=>new Response(conflict),'parser-failed',200,/pa-export-bill-clock-or-content-conflict/);
 });
 // Simulate corrupted storage reads without altering immutable D1 rows/triggers.
 // A matching checksum exercises normalization rather than the earlier hash guard.
 const invalidRetained=syntheticZip('<invalid>'),invalidRetainedHash=await sha256(invalidRetained);
 function corruptRetainedRead(hash:string):D1DatabaseLike {
   return {batch:statements=>db.batch(statements),prepare(sql){
     const statement=db.prepare(sql);
     if(!sql.includes('SELECT r.* FROM watch_raw_representations')) return statement;
     function wrap(bound:typeof statement):typeof statement {
       return {bind:(...values)=>wrap(bound.bind(...values)),run:()=>bound.run(),all:()=>bound.all(),async first<T>(){
         const retained=await bound.first<Record<string,unknown>>();
         return retained?{...retained,representation:invalidRetained,representation_sha256:hash} as T:null;
       }};
     }
     return wrap(statement);
   }};
 }
 const notModified:typeof fetch=async(_url,init)=>{
   assert.equal(new Headers(init?.headers).get('if-none-match'),'"synthetic-new-zip"');return new Response(null,{status:304});
 };
 await t.test('retained HTTP304 normalization failure is parser-failed with actual status304',async()=>{
   await failedCheck('2026-09-30T21:14:00.000Z',notModified,'parser-failed',304,/pa-export/,corruptRetainedRead(invalidRetainedHash));
 });
 await t.test('retained HTTP304 checksum failure keeps parser-failed and status304',async()=>{
   await failedCheck('2026-09-30T21:16:00.000Z',notModified,'parser-failed',304,/retained-representation-corrupt/,corruptRetainedRead('0'.repeat(64)));
 });
 await t.test('HTTP503 remains a true upstream failure with last success preserved',async()=>{
   await failedCheck('2026-09-30T21:18:00.000Z',async()=>new Response(null,{status:503}),'upstream-failed',503,/upstream-http-503/);
 });
 await t.test('network failure remains upstream-failed without inventing HTTP status',async()=>{
   await failedCheck('2026-09-30T21:20:00.000Z',async()=>{throw new TypeError('synthetic network failure');},'upstream-failed',undefined,/synthetic network failure/);
 });
 page=await readWatchDirectory(db,{kind:'policy',jurisdiction:'PA'},new Date('2026-09-30T21:06:00.000Z'));assert.equal(page.items.length,4);assert.equal(page.asOf,at);
 const head=await db.prepare('SELECT id FROM policy_watch_captures LIMIT 1').first<{id:string}>();
 const capture=(await readPolicyWatchCapture(db,head!.id)).material.parsed;
 const proof=await assertCollectedPolicySourceRule(db,capture,new Date('2026-09-30T21:06:00.000Z'));
 await assert.rejects(db.prepare("UPDATE watch_raw_representations SET normalizer_version='synthetic-tamper'").run(),/watch-raw-immutable/);
 await db.batch(proof.acceptanceGuards('synthetic-valid-byte-guard'));
 await assert.rejects(db.prepare("UPDATE watch_collection_pages SET page_json='{}'").run(),/watch-page-immutable/);
 await revokeWatchCollectionReview(db,q.qualification.reviewEvidenceId,'2026-09-30T21:07:00.000Z');
 await assert.rejects(assertCollectedPolicySourceRule(db,capture,new Date('2026-09-30T21:08:00.000Z')),/permission-conflict/);
 assert.equal((await readWatchDirectory(db,{kind:'policy'},new Date('2026-09-30T21:08:00.000Z'))).items.length,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
