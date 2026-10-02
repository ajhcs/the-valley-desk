import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishPaPacketFile } from '../scripts/lib/pa-browser-packet-storage.mjs';
import { assertCollectedPolicySourceRule } from '../src/ingest/policy-source-rule';
import { readPolicyWatchCapture } from '../src/ingest/policy-watch-workflow';
import { runWatchCollection } from '../src/ingest/watch/collector';
import { snapshotPageDigest } from '../src/ingest/watch/source-enrollment';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy,unstable_splitSqlQuery } from 'wrangler';
import { intakePaBrowserOriginal,type RetainedPaBrowserPacket } from '../src/ingest/watch/pa-browser-intake';
import { parsePennsylvaniaExportSnapshot } from '../src/ingest/watch/pennsylvania-export-adapter';
import { derivePaExport } from '../src/ingest/watch/pennsylvania-export';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { syntheticZip,syntheticXml,records } from './fixtures/pa-export/synthetic';
import { sha256 } from '../src/content/watch-schema';
import { qualifyCapturedWatchSource } from '../scripts/lib/watch-source-qualification';
import { configureWatchCollectionSource,retainedGoodRepresentation,resolveEnrolledCollectionSource } from '../src/ingest/watch/collection-storage';
import { readPaSourceHealth } from '../src/ingest/watch/pa-source-health';
import { syntheticFixture } from './fixtures/watch-contracts/synthetic';
import { projectPolicyDossier } from '../src/content/watch-projection';
import type { D1DatabaseLike } from '../src/ingest/persistence';
const source={...launchCandidate('candidate-pa-export').source,paExport:{...launchCandidate('candidate-pa-export').source.paExport!,freshnessPolicy:{weekdayMaxAgeMs:7200000,weekendMaxAgeMs:259200000,reviewMaxAgeMs:7200000,evidenceReceiptId:'synthetic-policy'}}};
const at='2026-09-30T20:30:00.000Z',now='2026-09-30T20:35:00.000Z';
async function packet(bytes=syntheticZip(),completedAt='2026-09-30T20:00:00.000Z'){
 const startedAt=new Date(Date.parse(completedAt)-1000).toISOString(),hash=await sha256(bytes);
 const receiptBytes=new TextEncoder().encode(JSON.stringify({publisher:'Pennsylvania General Assembly',session_label:'2025-2026 Regular Session',requested_download_url_observed:source.endpoints[0],download_started_at_utc:startedAt,download_completed_at_utc:completedAt,download_success:true,size_bytes:bytes.length,sha256:hash,http_status:null,response_headers:null,final_download_response_url:null,download_redirect_chain:null,original_tool_extra:'Synthetic first-hand receipt test only'}));
 const acquisition={schemaVersion:'pa-browser-original-1',origin:'browser-original',publisher:'Pennsylvania General Assembly',session:'2025_0',requestedUrl:source.endpoints[0],finalResponseUrl:null,startedAt,completedAt,downloadSucceeded:true,tool:'SYNTHETIC browser test',toolSession:'synthetic-session',downloadObservation:'synthetic-download',representationSha256:hash,representationBytes:bytes.length,downloadReceiptSha256:await sha256(receiptBytes),downloadReceiptBytes:receiptBytes.length,httpStatus:null,responseHeaders:null,redirectChain:null};
 return {bytes,receiptBytes,acquisitionBytes:new TextEncoder().encode(JSON.stringify(acquisition,null,2)),acquisition};
}
function retention(){const packets=new Map<string,RetainedPaBrowserPacket>();return {packets,async retain(p:RetainedPaBrowserPacket){packets.set(p.packetSha256,p);return {packetSha256:p.packetSha256};},clock:()=>new Date(now),onDiagnostic(error:unknown){console.error('PRIVATE SYNTHETIC INTAKE TEST',error);}};}
async function database(t:any){
 const proxy=await getPlatformProxy<{WATCH_TEST_DB:D1DatabaseLike}>({configPath:fileURLToPath(new URL('./fixtures/watch-d1/wrangler.jsonc',import.meta.url)),envFiles:[],persist:false,remoteBindings:false});t.after(()=>proxy.dispose());const db=proxy.env.WATCH_TEST_DB;
 const migrations=new URL('../migrations/',import.meta.url);for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name,migrations),'utf8')).map(sql=>db.prepare(sql)));
 return db;
}
async function activate(db:D1DatabaseLike){
 // Accepted permissions/activation are explicitly synthetic local test authority.
 const samples=await Promise.all([syntheticZip(),syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT'))].map(async(bytes,i)=>({bytes,endpoint:source.endpoints[0],capturedAt:i?'2026-09-30T20:05:00.000Z':'2026-09-30T20:00:00.000Z',upstreamReceipt:{id:'synthetic-original-'+i,origin:'upstream-original',endpoint:source.endpoints[0],capturedAt:i?'2026-09-30T20:05:00.000Z':'2026-09-30T20:00:00.000Z',representationSha256:await sha256(bytes),httpStatus:200,accessReceiptId:'synthetic-access'}})));
 const q=await qualifyCapturedWatchSource(source,samples,{engineeringOwnerId:'synthetic-eng',editorialOwnerId:'synthetic-ed',statement:'Fabricated source permissions only for offline tests; never real source rights.',reviewedAt:at,expiresAt:'2026-10-01T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read',receipts:{engineering:'synthetic-eng-review',editorial:'synthetic-ed-review',rights:'synthetic-rights',access:'synthetic-access'}});
 await db.prepare('INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)').bind(q.review.id,q.review.engineeringOwnerId,q.review.editorialOwnerId,q.review.evidenceSha256,q.review.qualificationSha256,q.review.acceptedAt).run();
 await configureWatchCollectionSource(db,{source:q.source,qualification:q.qualification,activationId:'synthetic-active',cadenceSeconds:60,expectedRevision:0},at);return q;
}
async function count(db:D1DatabaseLike,table:string){return (await db.prepare(`SELECT count(*) n FROM ${table}`).first<{n:number}>())!.n;}
test('browser snapshot keeps unknown status unknown and rejects a fabricated 200',async()=>{
 const p=await packet(),derived=await derivePaExport(source,p.bytes),input={source,body:derived.normalizedText,representationBytes:p.bytes,representationKind:'pa-zip-xml' as const,finalUrl:source.endpoints[0],fetchedAt:p.acquisition.completedAt,browserOriginal:{acquisition:p.acquisition,receiptBytes:p.receiptBytes}};
 const result=await parsePennsylvaniaExportSnapshot(input);assert.equal(result.health.state,'healthy');assert.equal(result.health.httpStatus,undefined);assert.equal(result.health.origin,'browser-original');assert.equal(result.observations.length,4);
 assert.equal((await parsePennsylvaniaExportSnapshot({...input,status:200})).health.state,'parser-failed');
});
test('candidate retains exact originals without activation; active pipeline replay stages review only and leaves failure/success clocks intact',{timeout:120000},async t=>{
 const db=await database(t),p=await packet(),store=retention();
 const pending=await intakePaBrowserOriginal(db,source,p,store);assert.equal(pending.outcome,'pending-review');assert.equal(pending.reason,'qualification-or-activation-held');assert.equal(store.packets.size,1);assert.equal(await count(db,'watch_raw_representations'),0);assert.equal(await count(db,'watch_collection_sources'),0);
 const q=await activate(db);await db.prepare("UPDATE watch_collection_state SET last_checked_at=?,last_success_at=?,last_state='upstream-failed' WHERE source_id=?").bind(at,'2026-09-30T20:00:00.000Z',source.id).run();
 const before=await db.prepare('SELECT * FROM watch_collection_state').first();
 const first=await intakePaBrowserOriginal(db,q.source,p,store);assert.equal(first.outcome,'staged-review',JSON.stringify(first));assert.equal(first.publicationAuthorized,false);assert.equal(first.successfulUpstreamCheckRenewed,false);
 const after=await db.prepare('SELECT * FROM watch_collection_state').first();assert.deepEqual(after,before);
 for(const row of (await db.prepare('SELECT id FROM policy_watch_captures').all<{id:string}>()).results!){
   const capture=(await readPolicyWatchCapture(db,row.id)).material.parsed;
   const proof=await assertCollectedPolicySourceRule(db,capture,new Date(now));assert.ok(proof.permissions.has(source.id));
   await db.batch(proof.acceptanceGuards('synthetic-browser-source-rule-proof'));
   // Rehash tampered page metadata too: valid JSON/digest alone is not original-byte identity.
   for(const field of ['packetSha256','receiptBase64','acquisitionBase64']){
     const tampered:D1DatabaseLike={batch:statements=>db.batch(statements),prepare(sql){
       const statement=db.prepare(sql);
       if(!sql.includes('p.id AS page_id'))return statement;
       return {bind(...values:any[]){const bound=statement.bind(...values);return {...bound,async all(){const result=await bound.all<any>();for(const r of result.results??[]){const page=JSON.parse(r.page_json);if(field==='packetSha256')page.browserOriginal.packetSha256='0'.repeat(64);else page.browserOriginal[field]=Buffer.from(Buffer.from(page.browserOriginal[field],'base64').toString()+'\n').toString('base64');r.page_json=JSON.stringify(page);r.page_sha256=await snapshotPageDigest(page);}return result;}};} } as any;
     }};
     await assert.rejects(assertCollectedPolicySourceRule(tampered,capture,new Date(now)),/collector-required/);
   }
 }

 const page=await db.prepare('SELECT page_json FROM watch_collection_pages').first<{page_json:string}>(),metadata=JSON.parse(page!.page_json).browserOriginal;
 assert.deepEqual(Buffer.from(metadata.receiptBase64,'base64'),Buffer.from(p.receiptBytes));assert.deepEqual(Buffer.from(metadata.acquisitionBase64,'base64'),Buffer.from(p.acquisitionBytes));
 const raw=await db.prepare('SELECT representation FROM watch_raw_representations').first<{representation:ArrayBuffer}>();assert.deepEqual(new Uint8Array(raw!.representation),p.bytes);
 const snapshots=[await count(db,'watch_collection_pages'),await count(db,'watch_raw_observations'),await count(db,'watch_editorial_drafts')];assert.deepEqual(snapshots,[1,4,4]);
 assert.equal((await intakePaBrowserOriginal(db,q.source,p,store)).outcome,'staged-review');assert.deepEqual([await count(db,'watch_collection_pages'),await count(db,'watch_raw_observations'),await count(db,'watch_editorial_drafts')],snapshots);
 assert.equal(await count(db,'watch_public_revisions'),0);
 const enrolled=await resolveEnrolledCollectionSource(db,source.id,now);assert.equal(await retainedGoodRepresentation(db,enrolled!,source.endpoints[0]),null);
 const f=await syntheticFixture('policy'),item=await projectPolicyDossier(f.draft,f.context);item.identity.value.sourceInstrumentId='HB 1925';item.sources=item.sources.map(s=>({...s,sourceId:source.id}));
 const health=await readPaSourceHealth(db,[item],now);assert.equal(health[0].health.origin,'browser-original');assert.equal(health[0].health.lastSuccessfulUpstreamCheckAt,null);assert.equal(health[0].health.currentFailure,'upstream-failed');
 const newer=await packet(syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT')));
 assert.equal((await intakePaBrowserOriginal(db,q.source,newer,store)).outcome,'staged-review');
 assert.equal(await count(db,'watch_editorial_drafts'),4,'export-only refresh is not another bill development');
 assert.equal((await intakePaBrowserOriginal(db,q.source,p,store)).reason,'retained-export-order-conflict');
 assert.equal((await intakePaBrowserOriginal(db,q.source,p,{...store,clock:()=>new Date('2026-10-01T01:00:00.000Z')})).reason,'qualification-or-activation-held');
 const late=await intakePaBrowserOriginal(db,q.source,p,{...store,clock:()=>new Date('2026-09-30T23:30:00.000Z')});assert.equal(late.reason,'export-age-policy-stale');
 const corrupt=await intakePaBrowserOriginal(db,q.source,{...p,receiptBytes:new Uint8Array(p.receiptBytes.length)},store);assert.equal(corrupt.outcome,'rejected');
});
test('live lease and transactional revocation prevent native writes while private originals remain retained',{timeout:120000},async t=>{
 const db=await database(t),q=await activate(db),p=await packet(),store=retention();
 await db.prepare("INSERT INTO watch_collection_leases VALUES('watch-collector','synthetic-other',?)").bind('2026-10-01T00:00:00.000Z').run();assert.equal((await intakePaBrowserOriginal(db,q.source,p,store)).reason,'collector-lease-held');assert.equal(await count(db,'watch_raw_representations'),0);
 await db.prepare('DELETE FROM watch_collection_leases').run();let raced=false;
 const racedDb:D1DatabaseLike={prepare:sql=>db.prepare(sql),async batch(statements){if(!raced){raced=true;await db.prepare('UPDATE watch_collection_reviews SET revoked_at=?').bind(now).run();}return db.batch(statements);}};
 const result=await intakePaBrowserOriginal(racedDb,q.source,p,store);assert.equal(result.outcome,'degraded');assert.equal(store.packets.size,1);assert.equal(await count(db,'watch_raw_representations'),0);assert.equal(await count(db,'watch_editorial_drafts'),0);
 assert.equal((await intakePaBrowserOriginal(db,q.source,p,store)).reason,'qualification-or-activation-held');
});

test('Buffer callers and retention callbacks cannot alias validated original bytes',async t=>{
 const db=await database(t),q=await activate(db),original=await packet();
 const input={bytes:Buffer.from(original.bytes),receiptBytes:Buffer.from(original.receiptBytes),acquisitionBytes:Buffer.from(original.acquisitionBytes)};
 const promise=intakePaBrowserOriginal(db,q.source,input,{clock:()=>new Date(now),async retain(p){
   assert.deepEqual(p.bytes,original.bytes);assert.deepEqual(p.receiptBytes,original.receiptBytes);assert.deepEqual(p.acquisitionBytes,original.acquisitionBytes);
   p.bytes.fill(0);p.receiptBytes.fill(0);p.acquisitionBytes.fill(0);return {packetSha256:p.packetSha256};
 }});
 input.bytes.fill(0);input.receiptBytes.fill(0);input.acquisitionBytes.fill(0);
 assert.equal((await promise).outcome,'staged-review');
 const row=await db.prepare('SELECT representation FROM watch_raw_representations').first<{representation:ArrayBuffer}>();assert.deepEqual(new Uint8Array(row!.representation),original.bytes);
 const page=JSON.parse((await db.prepare('SELECT page_json FROM watch_collection_pages').first<{page_json:string}>())!.page_json);
 assert.deepEqual(Buffer.from(page.browserOriginal.acquisitionBase64,'base64'),Buffer.from(original.acquisitionBytes));
 assert.deepEqual(Buffer.from(page.browserOriginal.receiptBase64,'base64'),Buffer.from(original.receiptBytes));
});
test('HTTP 200 and conditional 304 cannot regress a newer browser export or renew source success',async t=>{
 const db=await database(t),q=await activate(db),store=retention(),old=syntheticZip();
 const run=async(time:string,bytes:Uint8Array|null,status:number)=>{await db.prepare('UPDATE watch_collection_state SET next_due_at=?').bind(time).run();return runWatchCollection(db,{enabled:true,clock:()=>new Date(time),fetchImpl:async()=>new Response(bytes,{status,headers:{etag:'synthetic-old-export'}})});};
 assert.equal((await run(now,old,200)).sources[0].state,'healthy');
 const prior=await db.prepare('SELECT last_success_at FROM watch_collection_state').first();
 const newer=await packet(syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT')));
 assert.equal((await intakePaBrowserOriginal(db,q.source,newer,store)).outcome,'staged-review');
 const pages=await count(db,'watch_collection_pages');
 for(const [status,bytes,time] of [[200,old,'2026-09-30T20:36:00.000Z'],[304,null,'2026-09-30T20:37:00.000Z']] as const){
   const result=await run(time,bytes,status);assert.equal(result.sources[0].state,'parser-failed');assert.match(result.sources[0].detail,/regression/);
   assert.deepEqual(await db.prepare('SELECT last_success_at FROM watch_collection_state').first(),prior);assert.equal(await count(db,'watch_collection_pages'),pages);
   const f=await syntheticFixture('policy'),item=await projectPolicyDossier(f.draft,f.context);item.identity.value.sourceInstrumentId='HB 1925';item.sources=item.sources.map(s=>({...s,sourceId:source.id}));
   const health=(await readPaSourceHealth(db,[item],time))[0].health;assert.equal(health.exportAt,'2026-09-30T19:35:06.000Z');assert.equal(health.origin,'browser-original');assert.equal(health.lastSuccessfulUpstreamCheckAt,null);
 }
});
test('failed private temporary write retries without replacing originals or deleting unrelated temps',t=>{
 const directory=mkdtempSync(join(tmpdir(),'pa-atomic-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const target=join(directory,'original.zip'),unrelated=target+'.tmp-unrelated',bytes=Buffer.from('complete original');writeFileSync(unrelated,'keep');
 assert.throws(()=>publishPaPacketFile(target,bytes,100,(fd:number,data:Uint8Array)=>{writeFileSync(fd,data.subarray(0,3));throw Error('synthetic interrupted write');}),/interrupted/);
 assert.equal(existsSync(target),false);assert.deepEqual(readdirSync(directory),['original.zip.tmp-unrelated']);
 publishPaPacketFile(target,bytes,100);publishPaPacketFile(target,bytes,100);assert.deepEqual(readFileSync(target),bytes);
 assert.throws(()=>publishPaPacketFile(target,Buffer.from('other'),100),/conflict/);assert.deepEqual(readFileSync(target),bytes);assert.equal(readFileSync(unrelated,'utf8'),'keep');assert.equal(readdirSync(directory).length,2);
});

test('identical-byte reacquisition retains first observation proof for browser and HTTP origins',async t=>{
 for(const firstOrigin of ['browser','http'])await t.test(firstOrigin,async t=>{
   const db=await database(t),q=await activate(db),bytes=syntheticZip(),store=retention();
   if(firstOrigin==='browser')assert.equal((await intakePaBrowserOriginal(db,q.source,await packet(bytes),store)).outcome,'staged-review');
   else assert.equal((await runWatchCollection(db,{enabled:true,clock:()=>new Date(now),fetchImpl:async()=>new Response(bytes,{headers:{etag:'synthetic-identical-export'}})})).sources[0].state,'healthy');
   const observations=(await db.prepare('SELECT id,observation_json,first_seen_at FROM watch_raw_observations ORDER BY id').all()).results;
   const state=await db.prepare('SELECT * FROM watch_collection_state').first();
   const reacquired=await packet(bytes,firstOrigin==='browser'?'2026-09-30T20:10:00.000Z':'2026-09-30T20:36:00.000Z');
   // Browser samples share a persistence clock: association must still select
   // the first acknowledgment, while HTTP->browser preserves real later times.
   const laterStore={...store,clock:()=>new Date(firstOrigin==='browser'?now:'2026-09-30T20:37:00.000Z')};
   assert.equal((await intakePaBrowserOriginal(db,q.source,reacquired,laterStore)).outcome,'staged-review');
   assert.equal((await intakePaBrowserOriginal(db,q.source,reacquired,laterStore)).outcome,'staged-review');
   assert.equal(await count(db,'watch_collection_pages'),2);assert.equal(await count(db,'watch_raw_representations'),1);
   assert.deepEqual((await db.prepare('SELECT id,observation_json,first_seen_at FROM watch_raw_observations ORDER BY id').all()).results,observations);
   assert.deepEqual(await db.prepare('SELECT * FROM watch_collection_state').first(),state);assert.equal(await count(db,'watch_public_revisions'),0);
   const pages=(await db.prepare('SELECT page_json FROM watch_collection_pages ORDER BY rowid').all<{page_json:string}>()).results!;
   const metadata=JSON.parse(pages[1].page_json).browserOriginal;
   assert.deepEqual(Buffer.from(metadata.receiptBase64,'base64'),Buffer.from(reacquired.receiptBytes));
   assert.deepEqual(Buffer.from(metadata.acquisitionBase64,'base64'),Buffer.from(reacquired.acquisitionBytes));
   assert.equal(JSON.parse(Buffer.from(metadata.acquisitionBase64,'base64').toString()).httpStatus,null);
   for(const row of (await db.prepare('SELECT id FROM policy_watch_captures').all<{id:string}>()).results!){
     const capture=(await readPolicyWatchCapture(db,row.id)).material.parsed;
     const proof=await assertCollectedPolicySourceRule(db,capture,new Date('2026-09-30T20:37:00.000Z'));
     await db.batch(proof.acceptanceGuards('synthetic-reacquisition-proof'));
   }
 });
});
