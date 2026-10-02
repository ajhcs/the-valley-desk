import { parseWatchResponse as parseBaseWatchResponse } from "./fixtures/watch-contracts/base-v1-response";
import { collectionReadiness, sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,appendFileSync,renameSync,openSync,closeSync,fstatSync,readSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy,unstable_splitSqlQuery } from 'wrangler';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { boundedWatchFile,watchOutputDirectory,validateWatchOutputPaths } from '../scripts/lib/watch-local-files.mjs';
import { syntheticFixture } from './fixtures/watch-contracts/synthetic';
import { projectPolicyDossier } from '../src/content/watch-projection';
import { readPaSourceHealth } from '../src/ingest/watch/pa-source-health';
import { readPaHealth } from '../src/ui/watch/watch-api';
import { PaSourceHealth } from '../src/ui/watch/WatchShared';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { derivePaExport } from '../src/ingest/watch/pennsylvania-export';
import { syntheticZip,syntheticXml,records } from './fixtures/pa-export/synthetic';
import { qualifyCapturedWatchSource } from '../scripts/lib/watch-source-qualification';
import { configureWatchCollectionSource } from '../src/ingest/watch/collection-storage';
import { runWatchCollection } from '../src/ingest/watch/collector';
import { readWatchDirectory,readWatchSubjectRevision,applyReviewedWatchProjection } from '../src/ingest/watch-persistence';
import { syntheticDeliveryForRecord,stageSyntheticDelivery } from './fixtures/watch-delivery/synthetic';
import { canonicalJson,sha256,WatchPublicRecord } from '../src/content/watch-schema';
import { handleWatchRead } from '../src/ingest/watch-api';
import type { D1DatabaseLike } from '../src/ingest/persistence';
const policy={weekdayMaxAgeMs:7200000,weekendMaxAgeMs:259200000,reviewMaxAgeMs:7200000,evidenceReceiptId:'synthetic-policy-review'};
const candidate=launchCandidate('candidate-pa-export').source;
async function acceptedItem(){const f=await syntheticFixture('policy');return projectPolicyDossier(f.draft,f.context);}

test('R5 canonical private root boundary is portable and preserves legacy capture only',()=>{
 const root='/workspace/build/builderbob',task=root+'/controlled-task',out=task+'/originals';
 assert.equal(validateWatchOutputPaths(out,root,true),out);
 assert.equal(validateWatchOutputPaths(out,task,true),out);
 assert.equal(validateWatchOutputPaths(task,task,true),task);
 for(const [directory,narrowing] of [['/tmp/originals',root],[root+'-other/originals',root],[out,'/tmp'],[root+'/other',task],[out,root+'-other']])assert.throws(()=>validateWatchOutputPaths(directory,narrowing,true));
 const legacy=fileURLToPath(new URL('./fixtures/watch-launch/',import.meta.url)).replace(/\/$/,'');
 assert.equal(watchOutputDirectory(legacy,undefined,false),legacy);
 assert.throws(()=>watchOutputDirectory(legacy,undefined,true));
 assert.throws(()=>watchOutputDirectory(legacy,'/tmp',false));
 assert.throws(()=>watchOutputDirectory('relative',undefined,true));
});

test('R6 real descriptors reject symlinks/FIFO/growth/replacement in standard temporary storage',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pa-files-')),path=join(dir,'original');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(path,'1234');
 // Ordinary temporary storage is not an authorized CLI output root.
 if(!dir.startsWith('/workspace/build/builderbob/'))assert.throws(()=>watchOutputDirectory(dir,undefined,true));
 assert.throws(()=>watchOutputDirectory(dir,'/tmp',true));
 const link=join(dir,'symlink');symlinkSync(path,link);assert.throws(()=>boundedWatchFile(link,4));
 const fifo=join(dir,'fifo');execFileSync('mkfifo',[fifo]);assert.throws(()=>boundedWatchFile(fifo,4));
 assert.equal(new TextDecoder().decode(boundedWatchFile(path,4)),'1234');assert.throws(()=>boundedWatchFile(path,3));
 for(const mutation of ['growth','replacement']){
   writeFileSync(path,'1234');let touched=false,closed=false;
   const io={openSync,fstatSync,lstatSync,closeSync(fd:number){closed=true;closeSync(fd);},readSync(...args:any[]){if(!touched){touched=true;if(mutation==='growth')appendFileSync(path,'5');else{renameSync(path,path+'.old');writeFileSync(path,'5678');}}return (readSync as any)(...args);}};
   assert.throws(()=>boundedWatchFile(path,4,io),/changed/);assert.equal(closed,true);
 }
});

test('R3/R4 health fails atomically to unknown on query/config/partial derivation corruption',async()=>{
 const item=await acceptedItem();item.identity.value.sourceInstrumentId='HB 1925';
 const source={...candidate,id:item.sources[0].sourceId,paExport:{...candidate.paExport!,freshnessPolicy:policy}};
 const derived=await derivePaExport(source,syntheticZip());
 const base={configuration_json:JSON.stringify(source),normalized_text:derived.normalizedText,last_checked_at:'2026-09-30T20:00:00.000Z',last_success_at:'2026-09-30T20:00:00.000Z',last_state:'healthy'};
 const dbFor=(row:any):D1DatabaseLike=>({prepare:()=>({bind(){return this;},async first(){if(row instanceof Error)throw row;return row;}} as any),async batch(){return [];}});
 for(const row of [new Error('PRIVATE database diagnostic'),{...base,configuration_json:'{'},...[
   {exportDate:derived.receipt.exportDate}, {...derived.receipt,records:null}, {...derived.receipt,records:derived.receipt.records.map(r=>({...r,lastUpdate:null}))},
   {...derived.receipt,normalizerVersion:'unknown'}, {...derived.receipt,records:derived.receipt.records.slice(1)},
 ].map(value=>({...base,normalized_text:JSON.stringify(value)}))]){
   const health=await readPaSourceHealth(dbFor(row),[item],'2026-09-30T20:30:00.000Z');
   assert.ok(health.every(entry=>entry.health.exportAt===null&&entry.health.lastSuccessfulUpstreamCheckAt===null&&entry.health.origin==='unknown'&&entry.health.freshness==='unknown'));
   assert.ok(!JSON.stringify(health).includes('PRIVATE'));
 }
 assert.equal((await readPaSourceHealth(dbFor(base),[item],'2026-09-30T20:30:00.000Z'))[0].health.freshness,'fresh');
});

test('R7/R8 optional health supports old servers/failure and visibly binds multiple accepted bills/sources',async()=>{
 const first=await acceptedItem(),second=structuredClone(first);second.id='synthetic-second-pa';second.slug='second-pa';second.title='HB 1993';
 first.sources.push({...first.sources[0],id:'second-citation',sourceId:'second-source',label:'Second official source'});
 const unknown={exportAt:null,exportAgeMs:null,billLastUpdateAt:null,lastCheckedAt:null,lastSuccessfulUpstreamCheckAt:null,currentFailure:null,origin:'unknown',freshness:'unknown',boundMs:null,latestStatusVerified:false} as const;
 const entries=[{subjectId:first.id,sourceId:first.sources[0].sourceId,health:unknown},{subjectId:first.id,sourceId:'second-source',health:{...unknown,currentFailure:'upstream-blocked'}},{subjectId:second.id,sourceId:second.sources[0].sourceId,health:unknown}];
 const abort=new AbortController();
 for(const fetcher of [async()=>new Response('',{status:404}),async()=>new Response('',{status:503}),async()=>{throw Error('network');},async()=>Response.json({version:'pa-source-health-1',entries:[{...entries[0],subjectId:'unaccepted'}]})])assert.deepEqual(await readPaHealth([first,second],abort.signal,fetcher),[]);
 assert.equal((await readPaHealth([first,second],abort.signal,async()=>Response.json({version:'pa-source-health-1',entries}))).length,3);
 const html=renderToStaticMarkup(createElement(PaSourceHealth,{items:[first,second],entries}));
 for(const text of [first.title,second.title,first.sources[0].label,'Second official source',`/policy-watch/${first.slug}`,`/policy-watch/${second.slug}`,'upstream-blocked'])assert.ok(html.includes(text),text);
});

test('R1/R2 actual D1 source-rule refresh preserves live independent status while PN/synopsis/history advance; stale checks retain success',{timeout:120000},async t=>{
 const proxy=await getPlatformProxy<{WATCH_TEST_DB:D1DatabaseLike}>({configPath:fileURLToPath(new URL('./fixtures/watch-d1/wrangler.jsonc',import.meta.url)),envFiles:[],persist:false,remoteBindings:false});t.after(()=>proxy.dispose());
 const db=proxy.env.WATCH_TEST_DB,migrations=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name,migrations),'utf8')).map(sql=>db.prepare(sql)));
 const source={...candidate,paExport:{...candidate.paExport!,freshnessPolicy:policy}},at='2026-09-30T20:00:00.000Z';
 const samples=await Promise.all([syntheticZip(),syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT'))].map(async(bytes,i)=>({bytes,endpoint:source.endpoints[0],capturedAt:i?'2026-09-30T19:40:00.000Z':'2026-09-30T19:35:00.000Z',upstreamReceipt:{id:'synthetic-original-'+i,origin:'upstream-original',endpoint:source.endpoints[0],capturedAt:i?'2026-09-30T19:40:00.000Z':'2026-09-30T19:35:00.000Z',representationSha256:await sha256(bytes),httpStatus:200,accessReceiptId:'synthetic-access'}})));
 const q=await qualifyCapturedWatchSource(source,samples,{engineeringOwnerId:'synthetic-engineer',editorialOwnerId:'synthetic-editor',statement:'Synthetic authority for offline regression only; never real source rights or named human reviews.',reviewedAt:at,expiresAt:'2026-10-10T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read',receipts:{engineering:'synthetic-eng',editorial:'synthetic-ed',rights:'synthetic-rights',access:'synthetic-access'}});
 await db.prepare('INSERT INTO watch_collection_reviews VALUES(?,?,?,?,?,?,NULL)').bind(q.review.id,q.review.engineeringOwnerId,q.review.editorialOwnerId,q.review.evidenceSha256,q.review.qualificationSha256,q.review.acceptedAt).run();
 await configureWatchCollectionSource(db,{source:q.source,qualification:q.qualification,activationId:'synthetic-activation',cadenceSeconds:60,expectedRevision:0},at);
 const run=async(now:string,bytes:Uint8Array|null,status=200,database?:D1DatabaseLike)=>{await db.prepare('UPDATE watch_collection_state SET next_due_at=?').bind(now).run();return runWatchCollection(database??db,{enabled:true,publishVerified:true,clock:()=>new Date(now),fetchImpl:async()=>new Response(bytes,{status,headers:{etag:'synthetic-zip'}})});};
 assert.equal((await run(at,syntheticZip())).sources[0].state,'healthy');
 let page=await readWatchDirectory(db,{kind:'policy'},new Date(at));const native=page.items.find(item=>item.title==='HB 1925')!;
 // Real acceptance/delivery transactions, with independent status authority
 // explicitly synthesized ONLY for this test. Preserve values and original proofs.
 const f=await acceptedItem(),reviewed=WatchPublicRecord.parse({...f,id:native.id,slug:native.slug,title:native.title,identity:{...f.identity,value:native.kind==='policy'?native.identity.value:f.identity.value}});
 const subject=await db.prepare('SELECT input_revision,input_sha256,public_revision FROM watch_subjects WHERE id=?').bind(native.id).first<{input_revision:number;input_sha256:string;public_revision:number}>();
 const payload=canonicalJson(reviewed),decision='synthetic-independent-status';
 await db.prepare('INSERT INTO watch_reviewed_projections VALUES(?,?,?,?,?,?,?,?,?,?)').bind(decision,native.id,subject!.input_revision,subject!.input_sha256,subject!.public_revision,await sha256(payload),payload,'synthetic-reviewer','synthetic-gate',at).run();
 const delivery=await syntheticDeliveryForRecord(reviewed,subject!.input_revision,'synthetic-gate');await stageSyntheticDelivery(db,decision,delivery.handle);await applyReviewedWatchProjection(db,decision,new Date(at));
 const changed=syntheticZip(syntheticXml(records.map((text,i)=>i?text:text.replaceAll('3963','4000').replace('An Act amending Titles','A synthetic revised synopsis amending Titles').replace('3:05:00 PM EDT','4:05:00 PM EDT').replace('Re-reported as committed, Sept. 30, 2026','Synthetic later retained history, Sept. 30, 2026')).join('\n'),'September 30, 2026 4:30:06 PM EDT'));
 const refresh=await run('2026-09-30T21:00:00.000Z',changed);assert.equal(refresh.sources[0].state,'healthy',JSON.stringify(refresh));
 const next=(await readWatchSubjectRevision(db,'policy',native.id,'id',new Date('2026-09-30T21:00:00.000Z')))!.item;
 assert.ok(next.kind==='policy'&&reviewed.kind==='policy');assert.deepEqual(next.latestAction,reviewed.latestAction);assert.deepEqual(next.lifecycleFact,reviewed.lifecycleFact);assert.deepEqual(next.legalEffectFact,reviewed.legalEffectFact);assert.ok(next.summary?.value.startsWith('A synthetic revised synopsis'));assert.ok(next.timeline.some(action=>action.value.text.includes('Synthetic later retained history')));
 const pn=await db.prepare("SELECT json_extract(payload_json,'$.version.nativeId') pn FROM policy_watch_captures WHERE subject_id=? ORDER BY sequence DESC LIMIT 1").bind(native.id).first<{pn:string}>();assert.equal(pn?.pn,'PN 4000');
 // Primary v1 envelopes have no new keys; optional storage failures cannot reach them.
 const unavailable:D1DatabaseLike={prepare(sql){if(sql.includes('FROM watch_collection_sources s LEFT JOIN watch_collection_state'))throw Error('PRIVATE health failure');return db.prepare(sql);},batch:statements=>db.batch(statements)};
 assert.equal((await readWatchDirectory(unavailable,{kind:'policy'},new Date('2026-09-30T21:00:00.000Z'))).items.length,4);
 assert.ok(await readWatchSubjectRevision(unavailable,'policy',native.id,'id',new Date('2026-09-30T21:00:00.000Z')));
 assert.deepEqual(Object.keys(await readWatchDirectory(db,{kind:'policy'},new Date('2026-09-30T21:00:00.000Z'))).sort(),['version','generation','asOf','items','nextCursor'].sort());
 const primary=await readWatchDirectory(db,{kind:'policy'},new Date('2026-09-30T21:00:00.000Z'));
 parseBaseWatchResponse(primary,'policy');
 parseBaseWatchResponse(await readWatchSubjectRevision(db,'policy',native.id,'id',new Date('2026-09-30T21:00:00.000Z')),'policy',native.slug);
 const corrupt:D1DatabaseLike={prepare(sql){if(sql.includes('FROM watch_collection_sources s LEFT JOIN watch_collection_state'))return {bind(){return this;},async first(){return {configuration_json:'PRIVATE bad JSON',normalized_text:'{'};}} as any;return db.prepare(sql);},batch:statements=>db.batch(statements)};
 assert.equal((await readWatchDirectory(corrupt,{kind:'policy'},new Date('2026-09-30T21:00:00.000Z'))).items.length,4);
 assert.ok(await readWatchSubjectRevision(corrupt,'policy',native.id,'id',new Date('2026-09-30T21:00:00.000Z')));
 for(const healthDb of [unavailable,corrupt]){
   const response=await handleWatchRead(new Request('https://offline.test/api/v2/watch/source-health?subject='+encodeURIComponent(native.id)),{VALLEY_DESK_DB:healthDb,WATCH_PUBLIC_ENABLED:'true'});
   assert.equal(response.status,200);const health=await response.json() as any;
   assert.equal(health.version,'pa-source-health-1');assert.ok(!JSON.stringify(health).includes('PRIVATE'));
   assert.ok(health.entries.every((entry:any)=>entry.health.exportAt===null&&entry.health.freshness==='unknown'));
 }
 const missingPolicy={...q.source,paExport:{...candidate.paExport!}};
 const missingReceipt={...q.qualification,configurationSha256:await sourceConfigurationDigest(missingPolicy)};
 assert.equal((await collectionReadiness(missingPolicy,{now:at,activeSourceIds:new Set([missingPolicy.id]),receipts:new Map([[missingReceipt.id,missingReceipt]])})).ready,false);
 const lastSuccess='2026-09-30T21:00:00.000Z';
 for(const [clock,body,status] of [['2026-10-01T00:00:00.000Z',changed,200],['2026-10-01T00:02:00.000Z',null,304]] as const){const result=await run(clock,body,status);assert.equal(result.sources[0].state,'parser-failed');assert.equal(result.sources[0].health.lastSuccessAt,lastSuccess);assert.match(result.sources[0].detail,/age-policy-stale/);}
 // Weekend bound is explicitly synthetic, not publisher policy.
 assert.equal((await run('2026-10-03T18:00:00.000Z',null,304)).sources[0].state,'healthy');
 // Expired optional status no longer participates, so it cannot freeze metadata.
 const effectGroup=delivery.manifest.groups.find(group=>group.field==='legal-effect')!;
 await db.prepare('INSERT INTO watch_dependency_expirations VALUES(?,?)').bind(effectGroup.dependencies.find(dep=>dep.kind==='accepted-fact')!.key,'2026-10-03T18:01:00.000Z').run();
 const lifecycleGroup=delivery.manifest.groups.find(group=>group.field==='lifecycle')!;
 const key=lifecycleGroup.dependencies.find(dep=>dep.kind==='accepted-fact')!.key;
 // Use durable dependency change API instead of mutating proof immutability.
 const {recordWatchDependencyHead}=await import('../src/ingest/watch-delivery');
 const head=await db.prepare('SELECT revision FROM watch_dependency_heads WHERE dependency_key=?').bind(key).first<{revision:number}>();
 await recordWatchDependencyHead(db,{key,kind:'accepted-fact',revision:head!.revision+1,digest:null,immutableRecordId:'synthetic-revoked-lifecycle',changedAt:'2026-10-03T18:01:00.000Z'});
 const newer=syntheticZip(syntheticXml(records.map((text,i)=>i?text:text.replaceAll('3963','4001').replace('An Act amending Titles','Another synthetic synopsis amending Titles').replace('September 30, 2026 3:05:00 PM EDT','October 3, 2026 2:05:00 PM EDT')).join('\n'),'October 3, 2026 2:30:06 PM EDT'));
 assert.equal((await run('2026-10-03T18:35:00.000Z',newer)).sources[0].state,'healthy');
 const final=(await readWatchSubjectRevision(db,'policy',native.id,'id',new Date('2026-10-03T18:35:00.000Z')))!.item;
 assert.ok(final.kind==='policy');assert.equal(final.legalEffectFact,null);assert.equal(final.lifecycleFact,null);assert.deepEqual(final.latestAction,reviewed.latestAction);assert.ok(final.summary?.value.startsWith('Another synthetic synopsis'));
});
