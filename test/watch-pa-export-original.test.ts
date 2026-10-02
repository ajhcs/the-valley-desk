import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { prepareCapturedSource } from '../scripts/lib/watch-source-preparation';
import { derivePaExport, paSnapshotFreshness } from '../src/ingest/watch/pennsylvania-export';
import { extractBoundedZip } from '../src/ingest/watch/bounded-zip';
import { reconstructOriginal } from '../scripts/lib/pa-fixture-transport.mjs';
import { sha256 } from '../src/content/watch-schema';

test('required retained original ZIP parses identically in Node and actual workerd; Library grants no upstream success',{timeout:120000},async t=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/pa-export/receipt.json',import.meta.url),'utf8'));
 // Required lossless reconstruction; missing or invalid transport fails default CI.
 const bytes=new Uint8Array(reconstructOriginal(new URL('./fixtures/pa-export/',import.meta.url)));
 assert.equal(bytes.length,1649358);
 assert.equal(fixture.originalZipBytes,1649358);
 assert.equal(fixture.originalZipSha256,'f1f5484439dd2f2d22ef9e956169aa296fe1893b97b1625b8d917fed7c13a003');
 assert.equal(fixture.memberSha256,'93f88817a99deeb398fb201926eca027fe8c91ad836b58b472c0edd453aa3692');
 assert.equal(await sha256(bytes),fixture.originalZipSha256);
 const manifestBytes=readFileSync(new URL('./fixtures/pa-export/'+fixture.captureManifestPath,import.meta.url));
 assert.equal(await sha256(manifestBytes),fixture.captureManifestSha256);
 assert.deepEqual(JSON.parse(manifestBytes.toString()),fixture.captureManifest);
 const source=launchCandidate('candidate-pa-export').source;
 const result=await derivePaExport(source,bytes);
 const [member]=await extractBoundedZip(bytes);
 for(const record of fixture.records){
   const lexical=readFileSync(new URL('./fixtures/pa-export/'+record.path,import.meta.url));
   assert.equal(await sha256(lexical),record.sha256);
   assert.ok(new TextDecoder().decode(member.bytes).includes(lexical.toString()));
 }
 assert.equal(member.bytes.length,18875097);assert.equal(fixture.memberBytes,18875097);
 assert.equal(result.receipt.memberSha256,fixture.memberSha256);assert.equal(result.receipt.inventoryCount,5118);assert.equal(result.records.length,4);
 const bundle=await build({stdin:{contents:`import {derivePaExport} from './src/ingest/watch/pennsylvania-export';export default {async fetch(request){const r=await derivePaExport(${JSON.stringify(source)},new Uint8Array(await request.arrayBuffer()));return Response.json(r.receipt)}}`,resolveDir:process.cwd()},bundle:true,format:'esm',target:'es2022',platform:'browser',write:false});
 const m=new Miniflare({workers:[{config:{name:'pa-original-offline-test',compatibilityDate:'2026-09-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle.outputFiles[0].text}}}}}]});
 t.after(()=>m.dispose());
 const response=await m.dispatchFetch('http://offline.test',{method:'POST',body:bytes});
 assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await response.json(),result.receipt);
});


test('public research metadata excludes private capture details and binds minimized rather than raw publisher bytes',()=>{
 const directory=new URL('./fixtures/pa-export/',import.meta.url);
 const receipt=JSON.parse(readFileSync(new URL('receipt.json',directory),'utf8'));
 const manifestBytes=readFileSync(new URL(receipt.captureManifestPath,directory));
 const manifest=JSON.parse(manifestBytes.toString());
 const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
 // Only digests of removed values: the regression never embeds actual private identifiers or paths.
 const denied=new Set(["1cd5c91bcb6eeb2db426f97605e0c24b0d6004e14fcdf740036645e496033e90", "1eb034c733cf7be81664c38cd0af9626005709bc144b7d14413115e2f3131c70", "2128d80e13c5c47b575d80fc3f54ee1a049a69a8df699182e409ef0fc7d977d9", "3ca5fc09505f82f944aafda504989bc406285e9334f3cde127e2b7df2fcaa10d", "4762654f4ab5113c75ac2fdd683c086e290fd1043e413f0631b16df6538e077c", "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9", "6170d6705bf8adbeee4a001ecd92ce34b97784727234599d0013906a8e409253", "7d088731391dd97836f12403f775a1515581aa9105dfec9069db8255a6ee979e", "80d5ed2602e34d37f286619becc9ab1e0f277b9da77e4c9757e5bc17ffba6ca7", "97996260e499fc2b6a92b70dd173fbf2d9ac47cd96621c70695b40e1d930547a", "a97e0bcc9ac13725d3b0c3de907daa530d8060e631f660e64163d51fba370d50", "b831d0db912d620c4c4cf64969cac803a3324d0c9368de215a421720ef579ccc", "d0c4745daf177047f1d1a6af90234ad1f36fd8d2e838355f32eab74a8360672f"]);
 function inspect(value:unknown):void {
  if(typeof value==='string') {
   assert.equal(denied.has(hash(value)),false,'private capture value');
   assert.doesNotMatch(value,/\/(?:workspace|home|mnt|tmp|Users)\/|\b[A-Za-z]:[\\/]|library-file:|file_[a-z0-9]|user\.library|xattrs|download API|retrieval tool/i);
  } else if(Array.isArray(value)) value.forEach(inspect);
  else if(value && typeof value==='object') for(const [key,child] of Object.entries(value)) {
   assert.doesNotMatch(key,/^(?:library|library_file_id|file_id|xattrs|transport|storagePath|hostPath|retrievalMechanics)$/i);
   inspect(child);
   if(key==='path'||key.endsWith('Path')) assert.match(String(child),/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  }
 }
 inspect(receipt);inspect(manifest);
 // Inspect every textual fixture too, including future additions.
 for(const name of readdirSync(directory).filter(name=>!name.endsWith('.zip'))) inspect(readFileSync(new URL(name,directory),'utf8'));
 assert.equal(receipt.metadataVersion,'pa-research-public-metadata-1');
 assert.equal(manifest.metadataVersion,receipt.metadataVersion);
 assert.equal(receipt.captureManifestSha256,hash(manifestBytes));
 assert.deepEqual(receipt.captureManifest,manifest);
 assert.match(receipt.captureManifestHashScope,/derived privacy-minimized repository manifest bytes/);
 assert.match(manifest.metadataDerivation,/not an original publisher response/);
 assert.equal(manifest.source_page,'https://www.palegis.us/data');
 assert.deepEqual(manifest.files[0],{
  path:'pa-2025-0-20260930-1531.zip',source_url:'https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0',
  bytes:1649358,sha256:receipt.originalZipSha256,
  download_observation_window_utc:['2026-09-30T20:15:13Z','2026-09-30T20:15:24Z'],
  evidenceRetention:'Unchanged historical raw ZIP reconstructible from generated lossless text transport; logical path is not a tracked binary'
 });
 for(const file of manifest.files) {
  assert.equal(new URL(file.source_url).hostname,'www.palegis.us');
  assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(file.bytes>0);
  assert.equal(file.download_observation_window_utc.length,2);
 }
 assert.equal(manifest.xml_export.xml_sha256,receipt.memberSha256);
 assert.equal(manifest.xml_export.memberBytes,18875097);
 assert.equal(manifest.xml_export.exportAtUtc,'2026-09-30T19:30:06.000Z');
 assert.equal(manifest.xml_export.hb1925_lastUpdateAtUtc,'2026-09-30T19:05:00.000Z');
 assert.equal(receipt.exportAtUtc,manifest.xml_export.exportAtUtc);
 assert.equal(receipt.inventoryCount,5118);assert.equal(receipt.records.length,4);
 for(const record of receipt.records) {
  const bytes=readFileSync(new URL(record.path,directory));
  assert.equal(record.bytes,bytes.length);assert.equal(record.sha256,hash(bytes));
  assert.equal(record.derivation,'unaltered lexical bill element from original XML member; not original ZIP');
 }
 const vote=manifest.live_vote_observation;
 assert.equal(vote.url,'https://www.palegis.us/house/roll-calls/summary?sessYr=2025&sessInd=0&rcNum=1415');
 assert.equal(vote.voteAtUtc,'2026-09-30T19:45:00.000Z');assert.ok(vote.voteAtUtc>receipt.exportAtUtc);
 assert.equal(vote.yea,144);assert.equal(vote.nay,59);assert.equal(vote.pn,'3963');
 assert.deepEqual(vote.observed_between_utc,['2026-09-30T20:17:19Z','2026-09-30T20:17:35Z']);
 assert.match(vote.evidence_kind,/not source-reviewed or accepted Watch evidence/);
 assert.equal(manifest.freshness_caveats.length,3);
 assert.match(manifest.sourceAccess.zip,/HTTP403/);assert.match(manifest.sourceAccess.htmlRobots,/unknown.*HTTP406/);
 for(const metadata of [receipt,manifest]) {
  assert.equal(metadata.qualificationEstablished,false);assert.equal(metadata.publicationAuthorized,false);assert.equal(metadata.latestStatusVerified,false);
 }
});

test('retained original Library materialization grants no live qualification, source check or later vote fact',async()=>{
 const bytes=new Uint8Array(reconstructOriginal(new URL('./fixtures/pa-export/',import.meta.url)));
 const prepared=await prepareCapturedSource('candidate-pa-export',bytes,'2026-09-30T20:15:24.000Z');
 assert.equal(prepared.activationAuthorized,false);assert.equal(prepared.parsed?.health.complete,false);
 const derived=await derivePaExport(launchCandidate('candidate-pa-export').source,bytes);
 const hb=derived.records.find(record=>record.bill==='HB1925')!;
 assert.deepEqual(hb.document.versions.map(version=>version.pn),['3963','3349','2403']);
 assert.equal(hb.document.actions.at(-1)!.text,'Re-reported as committed, Sept. 30, 2026');
 assert.ok(!JSON.stringify(hb.document).includes('FINAL PASSAGE'));
 const freshness=paSnapshotFreshness({exportAt:derived.receipt.exportDate.instant,lastCheckedAt:'2026-09-30T20:28:00.000Z',lastSuccessfulUpstreamCheckAt:'2026-09-30T20:15:24.000Z',currentFailure:'access-held',origin:'library-research'},'2026-09-30T20:28:00.000Z');
 assert.equal(freshness.lastSuccessfulUpstreamCheckAt,null);assert.equal(freshness.latestStatusVerified,false);
 assert.equal(freshness.currentFailure,'access-held');
});
