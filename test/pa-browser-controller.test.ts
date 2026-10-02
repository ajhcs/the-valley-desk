import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {tmpdir} from 'node:os';
import {lstatSync,chmodSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,symlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {syntheticZip} from './fixtures/pa-export/synthetic';
// Operator MJS seams deliberately reuse repository TS parsing under tsx.
// @ts-expect-error private operator boundary
import {receivePaBrowserHandoff,handoffArgv} from '../scripts/lib/pa-browser-handoff.mjs';
// @ts-expect-error private operator boundary
import {intakeVerifiedPaBrowserPacket} from '../scripts/lib/pa-browser-operator.mjs';
// @ts-expect-error SQLite offline preview adapter
import {sqliteD1,previewPaBrowserIntake} from '../scripts/lib/pa-offline-d1.mjs';
// @ts-expect-error private storage boundary
import {verifyPaRetainedPacket} from '../scripts/lib/pa-retained-collector.mjs';
// Private fixture-only storage injection; production CLI defaults are never changed.
const build=mkdtempSync(join(tmpdir(),'pa-controller-fixtures-'));chmodSync(build,0o700);
after(()=>rmSync(build,{recursive:true,force:true}));
const fixtureStorage={outputDirectory(path:string){
 if(path!==build&&!path.startsWith(build+'/'))throw Error('fixture-root-refused');
 const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid())throw Error('fixture-private-root-required');
 return path;
}};
const names=['original.zip','original-receipt.json','acquisition.json','capture-complete.json'];
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(t:any){
 const root=mkdtempSync(join(build,'controller-fixture-'));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const remote=join(root,'synthetic-remote');mkdirSync(remote,{mode:0o700});const bytes=Buffer.from(syntheticZip());writeFileSync(join(remote,'input.zip'),bytes);
 execFileSync('python3',['test/pa-browser-controller_test.py','--emit-fixture',remote],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'});
 const files=Object.fromEntries(names.map(name=>[name,readFileSync(join(remote,name))]));
 const manifest=()=>({schemaVersion:'pa-authenticated-handoff-1',files:Object.fromEntries(names.map(name=>[name,{bytes:files[name].length,sha256:digest(files[name])}]))});
 let corrupt:string|undefined,interrupt:number|undefined,refuse=false;const calls:any[]=[];
 const transport={async run(command:any){
  calls.push(command);
  for(const option of ['BatchMode=yes','StrictHostKeyChecking=yes','ConnectTimeout=5','ConnectionAttempts=1'])assert.ok(command.args.includes(option));
  assert.equal(command.args.filter((a:string)=>a==='plumbob').length,1);assert.ok(!command.args.includes('-i'));assert.ok(!command.args.includes('-F'));
  if(command.file==='ssh'){assert.equal(JSON.parse(command.input).capture,'tvd-pa-one-shot-synthetic');assert.ok(command.args.at(-1).startsWith("python3 -c '"));if(refuse)throw Error('synthetic authentication refusal');return JSON.stringify(manifest());}
  assert.equal(command.file,'sftp');assert.deepEqual(command.args.slice(-3),['-b','-','plumbob']);
  const match=/^get -p \/mnt\/d\/tmp\/plumbob\/tvd-pa-one-shot-synthetic\/([a-z.-]+) (\/[A-Za-z0-9_./-]+)\n$/.exec(command.input);assert.ok(match);
  const [,name,path]=match;assert.ok(names.includes(name));
  if(interrupt!==undefined&&calls.filter(c=>c.file==='sftp').length===interrupt){writeFileSync(path,files[name].subarray(0,3),{mode:0o600});throw Error('synthetic transfer interruption');}
  writeFileSync(path,corrupt===name?Buffer.from('corrupt'):files[name],{mode:0o600});return '';
 }};
 return {root,files,bytes,manifest,calls,transport,request:()=>({enabled:true,remoteCapture:'tvd-pa-one-shot-synthetic',out:root,transport}),setCorrupt:(name?:string)=>{corrupt=name;},setInterrupt:(n?:number)=>{interrupt=n;},setRefuse:()=>{refuse=true;}};
}
function database(t:any){
 const root=mkdtempSync(join(build,'offline-d1-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const sql=new DatabaseSync(join(root,'isolated.sqlite'));t.after(()=>sql.close());
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 return {sql,db:sqliteD1(sql),count:(name:string)=>Number((sql.prepare(`SELECT count(*) n FROM ${name}`).get() as any).n)};
}
test('complete Python observed receipt -> authenticated fixture handoff -> bounded ZIP receiver -> trusted D1 pending intake',async t=>{
 const f=fixture(t),received=await receivePaBrowserHandoff(f.request(),fixtureStorage),{db,count}=database(t);
 assert.deepEqual(Buffer.from(received.packet.bytes),f.bytes);assert.deepEqual(Buffer.from(received.packet.receiptBytes),f.files['original-receipt.json']);assert.deepEqual(Buffer.from(received.packet.acquisitionBytes),f.files['acquisition.json']);
 assert.equal(received.imported.derivation.exportDate.instant,'2026-09-30T19:30:06.000Z');assert.equal(received.imported.acquisition.completedAt,'2026-09-30T20:00:01.123Z');
 assert.equal(received.imported.acquisition.httpStatus,null);assert.equal(received.imported.acquisition.responseHeaders,null);assert.equal(received.imported.acquisition.finalResponseUrl,null);assert.equal(received.imported.acquisition.redirectChain,null);assert.equal(received.imported.captures.length,4);
 const retention=join(f.root,'durable-intake');mkdirSync(retention,{mode:0o700});
 const args={enabled:true,db,packetDirectory:received.directory,retentionRoot:retention,clock:()=>new Date('2026-09-30T20:01:00.000Z')};
 const first=await intakeVerifiedPaBrowserPacket(args,fixtureStorage),second=await intakeVerifiedPaBrowserPacket(args,fixtureStorage);
 assert.deepEqual(second,first);assert.equal(first.outcome,'pending-review');assert.equal(first.reason,'qualification-or-activation-held');assert.equal(first.retained,true);assert.equal(first.successfulUpstreamCheckRenewed,false);assert.equal(first.publicationAuthorized,false);
 for(const table of ['watch_collection_sources','watch_collection_state','watch_collection_pages','watch_raw_representations','watch_public_revisions','watch_editorial_drafts'])assert.equal(count(table),0,table);
 const original=join(retention,first.packetSha256,'original.zip');assert.deepEqual(readFileSync(original),f.bytes);assert.ok(existsSync(join(retention,first.packetSha256,'intake-complete.json')));
 const previousCalls=f.calls.length,replay=await receivePaBrowserHandoff(f.request(),fixtureStorage);assert.equal(replay.directory,received.directory);assert.equal(f.calls.length,previousCalls+1,'idempotent replay revalidates remote manifest and skips completed byte transfers');
 const before=readFileSync(original);writeFileSync(original,'conflict');const conflict=await intakeVerifiedPaBrowserPacket(args,fixtureStorage);assert.equal(conflict.reason,'private-retention-failed');assert.equal(readFileSync(original,'utf8'),'conflict');assert.ok(before.equals(f.bytes));
});
test('fixture authentication refusal and transfer corruption cannot produce a commit marker',async t=>{
 const f=fixture(t);f.setRefuse();await assert.rejects(receivePaBrowserHandoff(f.request(),fixtureStorage),/authentication refusal/);assert.equal(f.calls.filter(c=>c.file==='sftp').length,0);
 for(const name of names)await t.test(name,async t=>{const f=fixture(t);f.setCorrupt(name);await assert.rejects(receivePaBrowserHandoff(f.request(),fixtureStorage),/checksum/);assert.equal(readdirSync(f.root).filter(n=>/^[a-f0-9]{64}$/.test(n)).length,0);for(const n of readdirSync(f.root).filter(n=>n.startsWith('handoff-')))assert.equal(existsSync(join(f.root,n,'handoff-complete.json')),false);});
});
test('interruption preserves partial state, replay resumes bytes, conflicts never overwrite',async t=>{
 const f=fixture(t);f.setInterrupt(2);await assert.rejects(receivePaBrowserHandoff(f.request(),fixtureStorage),/interruption/);
 const staged=join(f.root,readdirSync(f.root).find(n=>n.startsWith('handoff-'))!);assert.deepEqual(readFileSync(join(staged,'original.zip')),f.bytes);assert.equal(existsSync(join(staged,'handoff-complete.json')),false);
 const partial=readdirSync(staged).filter(n=>n.startsWith('transfer-')).find(n=>existsSync(join(staged,n,'original-receipt.json')))!;assert.equal(readFileSync(join(staged,partial,'original-receipt.json')).length,3);
 f.setInterrupt();const complete=await receivePaBrowserHandoff(f.request(),fixtureStorage);assert.ok(existsSync(join(staged,'handoff-complete.json')));assert.deepEqual(Buffer.from(complete.packet.bytes),f.bytes);assert.equal(readFileSync(join(staged,partial,'original-receipt.json')).length,3,'unfinished original preserved');
 writeFileSync(join(staged,'original.zip'),'conflict');await assert.rejects(receivePaBrowserHandoff(f.request(),fixtureStorage),/original-conflict/);assert.equal(readFileSync(join(staged,'original.zip'),'utf8'),'conflict');
});
test('fixed argv rejects URLs, shell data, unsafe aliases/directories, bad manifests and receipt tamper',async t=>{
 for(const capture of ['plumbob','../capture','tvd-pa-one-shot-a;id','https://example.invalid','tvd-pa-one-shot-$(id)','tvd-pa-one-shot-a\nget /secret'])assert.throws(()=>handoffArgv(capture,join(build,'valid'),'original.zip'),/path-refused/);
 for(const path of ['/tmp/file name','/tmp/a\nput x','https://example.invalid','/tmp/../secret'])assert.throws(()=>handoffArgv('tvd-pa-one-shot-synthetic',path,'original.zip'),/path-refused/);
 assert.throws(()=>handoffArgv('tvd-pa-one-shot-synthetic',join(build,'valid'),'../secret'),/path-refused/);
 for(const manifest of [{schemaVersion:'wrong',files:{}},{schemaVersion:'pa-authenticated-handoff-1',files:{}},{schemaVersion:'pa-authenticated-handoff-1',files:Object.fromEntries(names.map(n=>[n,{bytes:2_000_001,sha256:'0'.repeat(64)}]))}]){
  const f=fixture(t);await assert.rejects(receivePaBrowserHandoff({...f.request(),transport:{async run(){return JSON.stringify(manifest);}}},fixtureStorage),/manifest/);
 }
 const f=fixture(t);const receipt=JSON.parse(f.files['original-receipt.json'].toString());receipt.transport.http_status=200;f.files['original-receipt.json']=Buffer.from(JSON.stringify(receipt));
 const acquisition=JSON.parse(f.files['acquisition.json'].toString());acquisition.downloadReceiptBytes=f.files['original-receipt.json'].length;acquisition.downloadReceiptSha256=digest(f.files['original-receipt.json']);f.files['acquisition.json']=Buffer.from(JSON.stringify(acquisition));
 const marker=JSON.parse(f.files['capture-complete.json'].toString());for(const name of ['original-receipt.json','acquisition.json'])marker.files[name]={bytes:f.files[name].length,sha256:digest(f.files[name])};f.files['capture-complete.json']=Buffer.from(JSON.stringify(marker));
 await assert.rejects(receivePaBrowserHandoff(f.request(),fixtureStorage),/observation-conflict/);
});
test('receiver symlinks and missing finalized marker cannot reach intake; preview stays isolated',async t=>{
 const f=fixture(t),received=await receivePaBrowserHandoff(f.request(),fixtureStorage);const {db,count}=database(t);
 const args={enabled:true,db,packetDirectory:received.directory,retentionRoot:f.root};
 const acquisition=join(received.directory,'acquisition.json');rmSync(acquisition);symlinkSync(join(f.root,'synthetic-remote','acquisition.json'),acquisition);await assert.rejects(intakeVerifiedPaBrowserPacket(args,fixtureStorage));assert.equal(count('watch_raw_representations'),0);
 rmSync(acquisition);writeFileSync(acquisition,f.files['acquisition.json'],{mode:0o600});rmSync(join(received.directory,'manifest.json'));await assert.rejects(verifyPaRetainedPacket(received.directory));
 const repaired=await receivePaBrowserHandoff(f.request(),fixtureStorage);assert.equal(repaired.directory,received.directory);
 const preview=await previewPaBrowserIntake({packet:repaired.directory,state:f.root,retention:f.root},fixtureStorage);
 assert.equal(preview.offlineOnly,true);assert.equal(preview.outcome,'pending-review');assert.equal(preview.sourceQualified,false);assert.equal(preview.successfulUpstreamCheckRenewed,false);
 const check=new DatabaseSync(join(preview.databaseDirectory,'preview.sqlite'));try{assert.equal(Number((check.prepare('SELECT count(*) n FROM watch_collection_sources').get() as any).n),0);}finally{check.close();}
});
test('disabled adapters and CLIs make zero external calls or database/storage operations',async()=>{
 let calls=0;const transport={run(){calls++;throw Error('external call');}},db={get prepare(){throw Error('database touched');}};
 assert.equal((await receivePaBrowserHandoff({remoteCapture:'bad',out:'/must-not-read',transport})).outcome,'disabled');assert.equal((await intakeVerifiedPaBrowserPacket({db,packetDirectory:'/must-not-read'})).outcome,'disabled');assert.equal(calls,0);
 for(const script of ['scripts/receive-pa-browser.mjs','scripts/preview-pa-browser-intake.mjs']){
  const guard="import {registerHooks} from 'node:module';registerHooks({resolve(s,c,next){if(['node:child_process','node:fs','node:sqlite','node:http','node:https','node:net'].includes(s)||s.includes('/lib/'))throw Error('disabled import '+s);return next(s,c);}});";
  const result=JSON.parse(execFileSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(guard),script,'--packet','/must-not-read','--preflight','/must-not-read'],{encoding:'utf8'}));assert.equal(result.outcome,'disabled');assert.equal(result.schedulingEnabled,false);
 }
});

test('production handoff, intake and receiving/preview CLIs still refuse portable fixture roots before network',async t=>{
 const f=fixture(t),wrongRoot=process.cwd();await assert.rejects(receivePaBrowserHandoff({...f.request(),out:wrongRoot}),/Output must stay/);assert.equal(f.calls.length,0);
 await assert.rejects(intakeVerifiedPaBrowserPacket({enabled:true,db:{prepare(){throw Error('database touched');},batch(){}},packetDirectory:wrongRoot,retentionRoot:wrongRoot}),/Output must stay/);
 for(const [script,args] of [
  ['scripts/receive-pa-browser.mjs',['--enable-authenticated-handoff','--capture','tvd-pa-one-shot-synthetic','--out',wrongRoot]],
  ['scripts/preview-pa-browser-intake.mjs',['--enable-offline-preview','--packet',wrongRoot,'--state',wrongRoot,'--retention',wrongRoot]],
 ] as const)assert.throws(()=>execFileSync(process.execPath,['--import','tsx/esm',script,...args],{stdio:'pipe'}),(error:any)=>String(error.stderr).includes('Output must stay in private task storage'));
});
test('parent fsync failure holds intake completion, preserving originals for immutable replay',async t=>{
 const f=fixture(t),root=join(f.root,'retention-barrier');mkdirSync(root,{mode:0o700});
 const {privatePaPacketRetainer,syncPaDirectory}=await import('../scripts/lib/pa-browser-packet-storage.mjs');
 const packet={packetSha256:'a'.repeat(64),sourceId:'candidate-pa-export',bytes:f.files['original.zip'],receiptBytes:f.files['original-receipt.json'],acquisitionBytes:f.files['acquisition.json']};
 const directory=join(root,packet.packetSha256);let barriers=0;
 const fail=privatePaPacketRetainer(root,{...fixtureStorage,syncDirectory(path:string){barriers++;assert.equal(path,root);assert.deepEqual(readFileSync(join(directory,'original.zip')),f.bytes);assert.equal(existsSync(join(directory,'intake-complete.json')),false);throw Error('synthetic parent fsync failure');}});
 await assert.rejects(fail(packet),/parent fsync failure/);assert.equal(barriers,1);assert.equal(existsSync(join(directory,'intake-complete.json')),false);assert.deepEqual(readFileSync(join(directory,'original.zip')),f.bytes);
 const retry=privatePaPacketRetainer(root,{...fixtureStorage,syncDirectory(path:string){assert.equal(existsSync(join(directory,'intake-complete.json')),false);syncPaDirectory(path);}});
 assert.deepEqual(await retry(packet),{packetSha256:packet.packetSha256});assert.ok(existsSync(join(directory,'intake-complete.json')));assert.deepEqual(readFileSync(join(directory,'original.zip')),f.bytes);
});

// Execute the controller's exported JS, rather than asserting canned CDP values.
// @ts-expect-error socket-free MJS fixture
import {evaluateDom} from './fixtures/pa-browser-dom-vm.mjs';
const expressions=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'scripts');from pa_browser.live import SNAPSHOT,CLICK;print(json.dumps({'snapshot':SNAPSHOT,'click':CLICK}))"],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const observedLink={label:'2025-2026 Regular Session',href:'/data/file?documentType=BillHistoryData&session=2025_0',resolved:'https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0'};
test('real SNAPSHOT is null-safe; original body access reproduces TypeError without proving prior live cause',()=>{
 assert.equal(evaluateDom('document.body.innerText',{body:null}).exceptionDetails.exception.className,'TypeError');
 for(const state of [{url:'about:blank',body:null,ready:'loading'},{body:null,ready:'loading'},{body:'',ready:'interactive'},{body:'Last Updated: literal unzoned label',links:[observedLink]}]){
  const result=evaluateDom(expressions.snapshot,state);assert.equal(result.exceptionDetails,undefined);assert.equal(result.result.value.bodyPresent,state.body!==null);assert.equal(result.result.value.ready,state.ready??'complete');
 }
});
test('real expressions deny title/widget challenges without body, redirects and interstitial clicks',()=>{
 for(const state of [{body:null,title:'Just a moment'},{body:null,challengeWidget:true},{body:'Access denied'},{body:null,interstitial:true},{url:'chrome-error://chromewebdata/',body:null},{url:'https://other.invalid/data',links:[observedLink]},{url:observedLink.resolved,links:[observedLink]}]){
  const result=evaluateDom(expressions.click,state);assert.ok(result.exceptionDetails);assert.deepEqual(result.clicks,[]);
  const snapshot=evaluateDom(expressions.snapshot,state);assert.equal(snapshot.exceptionDetails,undefined);
 }
});
test('real CLICK requires complete body and unique exact observed anchor, issuing one ordinary click',()=>{
 for(const state of [{body:null},{ready:'loading',links:[observedLink]},{ready:'interactive',links:[observedLink]},{links:[]},{links:[observedLink,observedLink]},{links:[{...observedLink,href:observedLink.resolved}]},{links:[{...observedLink,resolved:'https://other.invalid/file'}]}]){
  const result=evaluateDom(expressions.click,state);assert.ok(result.exceptionDetails);assert.deepEqual(result.clicks,[]);
 }
 const result=evaluateDom(expressions.click,{body:'ordinary page',links:[observedLink]});assert.equal(result.exceptionDetails,undefined);assert.equal(result.result.value.clicked,true);assert.deepEqual(result.clicks,[observedLink.href]);
});
