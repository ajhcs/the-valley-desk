import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync,mkdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {syntheticZip} from './fixtures/pa-export/synthetic';
import {launchCandidate} from '../fixtures/watch-launch-candidates';
import {sha256} from '../src/content/watch-schema';
import {intakePaBrowserOriginal} from '../src/ingest/watch/pa-browser-intake';
// Filesystem adapter is exercised in a portable private temp directory. CLI
// storage-root enforcement remains separate and unchanged.
// @ts-expect-error operator MJS boundary has no declaration file
import {retainPaLocalOriginal,verifyPaRetainedPacket} from '../scripts/lib/pa-retained-collector.mjs';
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'pa-retained-'));chmodSync(root,0o700);
 const bytes=syntheticZip(),hash=await sha256(bytes),source=launchCandidate('candidate-pa-export').source;
 const startedAt='2026-09-30T19:59:59.000Z',completedAt='2026-09-30T20:00:00.000Z';
 const receiptBytes=new TextEncoder().encode(JSON.stringify({publisher:'Pennsylvania General Assembly',session_label:'2025-2026 Regular Session',requested_download_url_observed:source.endpoints[0],download_started_at_utc:startedAt,download_completed_at_utc:completedAt,download_success:true,size_bytes:bytes.length,sha256:hash,http_status:null,response_headers:null,final_download_response_url:null,download_redirect_chain:null}));
 const acquisition={schemaVersion:'pa-browser-original-1',origin:'browser-original',publisher:'Pennsylvania General Assembly',session:'2025_0',requestedUrl:source.endpoints[0],finalResponseUrl:null,startedAt,completedAt,downloadSucceeded:true,tool:'SYNTHETIC test only',toolSession:null,downloadObservation:'synthetic observation',representationSha256:hash,representationBytes:bytes.length,downloadReceiptSha256:await sha256(receiptBytes),downloadReceiptBytes:receiptBytes.length,httpStatus:null,responseHeaders:null,redirectChain:null};
 const inputs={candidateId:source.id,zip:join(root,'input.zip'),receipt:join(root,'input-receipt.json'),acquisition:join(root,'input-acquisition.json'),out:root};
 writeFileSync(inputs.zip,bytes);writeFileSync(inputs.receipt,receiptBytes);writeFileSync(inputs.acquisition,JSON.stringify(acquisition));
 return {root,inputs,source};
}
test('immutable roundtrip and replay feed existing intake without granting candidate authority',async()=>{
 const f=await fixture(),originalFetch=globalThis.fetch;let fetchCalls=0;
 globalThis.fetch=async()=>{fetchCalls++;throw Error('unexpected acquisition');};try{
 const result=await retainPaLocalOriginal(f.inputs),before=readFileSync(join(result.directory,'manifest.json'));
 const replay=await retainPaLocalOriginal(f.inputs);assert.equal(replay.manifest.packetSha256,result.manifest.packetSha256);assert.deepEqual(readFileSync(join(result.directory,'manifest.json')),before);
 const received=await verifyPaRetainedPacket(result.directory);assert.ok(Buffer.from(received.packet.bytes).equals(readFileSync(f.inputs.zip)));assert.equal(received.imported.acquisition.httpStatus,null);assert.equal(received.imported.acquisition.finalResponseUrl,null);
 assert.equal(received.imported.derivation.exportDate.instant,'2026-09-30T19:30:06.000Z');
 const db={prepare(){return {bind(){return this;},async first(){return null;}};}};
 const intake=await intakePaBrowserOriginal(db as never,received.source,received.packet,{clock:()=>new Date('2026-09-30T20:01:00.000Z'),retain:async packet=>({packetSha256:packet.packetSha256})});
 assert.equal(intake.outcome,'pending-review');assert.equal(intake.publicationAuthorized,false);assert.equal(intake.successfulUpstreamCheckRenewed,false);
 assert.equal(fetchCalls,0);
 }finally{globalThis.fetch=originalFetch;rmSync(f.root,{recursive:true});}
});
test('changed, truncated, symlinked and conflicting originals fail closed without replacement',async()=>{
 const f=await fixture();try{
 for(const key of ['receipt','acquisition','out'])await assert.rejects(retainPaLocalOriginal({...f.inputs,zip:'/nonexistent-pa-retained-preflight',[key]:'https://example.invalid'}),/pa-retained-acquisition-disabled/);
 const result=await retainPaLocalOriginal(f.inputs),original=readFileSync(join(result.directory,'original.zip'));
 writeFileSync(f.inputs.zip,original.subarray(0,original.length-1));await assert.rejects(retainPaLocalOriginal(f.inputs));
 writeFileSync(f.inputs.zip,original);
 const receiptOriginal=readFileSync(f.inputs.receipt);writeFileSync(f.inputs.receipt,'{}');await assert.rejects(retainPaLocalOriginal(f.inputs));writeFileSync(f.inputs.receipt,receiptOriginal);
 const envelopeOriginal=readFileSync(f.inputs.acquisition),envelope=JSON.parse(envelopeOriginal.toString());writeFileSync(f.inputs.acquisition,JSON.stringify({...envelope,httpStatus:200}));await assert.rejects(retainPaLocalOriginal(f.inputs));writeFileSync(f.inputs.acquisition,envelopeOriginal);
 const alias=join(f.root,'alias.zip');symlinkSync(f.inputs.zip,alias);await assert.rejects(retainPaLocalOriginal({...f.inputs,zip:alias}),/symlink/);
 const stored=join(result.directory,'original-receipt.json');writeFileSync(stored,'conflicting bytes');await assert.rejects(retainPaLocalOriginal(f.inputs),/conflict/);assert.equal(readFileSync(stored,'utf8'),'conflicting bytes');
 assert.deepEqual(readFileSync(join(result.directory,'original.zip')),original);
 }finally{rmSync(f.root,{recursive:true});}
});
test('received manifest hashes, source config, path keys, modes and symlinks are enforced',async()=>{
 const f=await fixture();try{
 const valid=await retainPaLocalOriginal(f.inputs),manifest=valid.manifest;
 for(const change of [m=>({...m,sourceConfigurationSha256:'0'.repeat(64)}),m=>({...m,files:{...m.files,'../outside':m.files['original.zip']}}),m=>({...m,files:{...m.files,'original.zip':{...m.files['original.zip'],sha256:'0'.repeat(64)}}})]){
 writeFileSync(join(valid.directory,'manifest.json'),JSON.stringify(change(manifest)));await assert.rejects(verifyPaRetainedPacket(valid.directory));
 }
 writeFileSync(join(valid.directory,'manifest.json'),JSON.stringify(manifest));
 chmodSync(join(valid.directory,'original.zip'),0o644);await assert.rejects(verifyPaRetainedPacket(valid.directory),/metadata/);chmodSync(join(valid.directory,'original.zip'),0o600);
 const copyRoot=join(f.root,'received');mkdirSync(copyRoot,{mode:0o700});const copy=join(copyRoot,manifest.packetSha256);cpSync(valid.directory,copy,{recursive:true});chmodSync(copy,0o700);
 assert.equal((await verifyPaRetainedPacket(copy)).manifest.packetSha256,manifest.packetSha256);
 rmSync(join(copy,'acquisition.json'));symlinkSync(f.inputs.acquisition,join(copy,'acquisition.json'));await assert.rejects(verifyPaRetainedPacket(copy));
 }finally{rmSync(f.root,{recursive:true});}
});
test('CLI refuses fetch/URL acquisition before local I/O and verifies the private output boundary',async()=>{
 const run=args=>execFileSync(process.execPath,['--import','tsx/esm','scripts/collect-pa-retained.mjs',...args],{stdio:'pipe'});
 const hasError=message=>error=>String(error.stderr).includes(message);
 for(const args of [['--mode','fetch'],['--fetch','https://example.invalid'],['--mode','retain','--zip','https://example.invalid']]){
  assert.throws(()=>run(args),hasError('pa-retained-acquisition-disabled'));
 }
 for(const key of ['receipt','acquisition','out']){
  const args=['--mode','retain','--candidate','candidate-pa-export'];
  for(const field of ['zip','receipt','acquisition','out'])args.push('--'+field,field===key?'https://example.invalid':'/nonexistent-pa-retained-preflight');
  assert.throws(()=>run(args),hasError('pa-retained-acquisition-disabled'));
 }
 const f=await fixture();try{
  assert.throws(()=>run(['--mode','verify','--packet',process.cwd()]),hasError('Output must stay in private task storage'));
  assert.throws(()=>run(['--mode','retain','--candidate',f.inputs.candidateId,'--zip',f.inputs.zip,'--receipt',f.inputs.receipt,'--acquisition',f.inputs.acquisition,'--out',process.cwd()]),hasError('Output must stay in private task storage'));
 }finally{rmSync(f.root,{recursive:true});}
});
