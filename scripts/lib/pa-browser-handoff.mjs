import { mkdirSync, mkdtempSync, chmodSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../src/content/watch-schema.ts';
import { localOnly, retainPaLocalOriginal } from './pa-retained-collector.mjs';
import { boundedWatchFile, watchOutputDirectory } from './watch-local-files.mjs';
import { publishPaPacketFile, syncPaDirectory } from './pa-browser-packet-storage.mjs';
const names=['original.zip','original-receipt.json','acquisition.json','capture-complete.json'];
const limits=[2_000_000,64_000,64_000,16_000];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=path=>typeof path==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Constant remote program. Path data travels in JSON stdin, never in a shell command.
const remoteCheck=`import sys,json,os,stat,hashlib,pathlib
root=pathlib.Path('/mnt/d/tmp/plumbob')
p=json.load(sys.stdin);name=p['capture']
import re
assert re.fullmatch(r'tvd-pa-one-shot-[A-Za-z0-9_-]+',name)
assert os.path.ismount('/mnt/d')
for path in [*reversed(root.parents),root]: assert not path.is_symlink()
def directory(path):
 s=path.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700
directory(root);folder=root/name;directory(folder)
files={}
for name,limit in [('original.zip',2000000),('original-receipt.json',64000),('acquisition.json',64000),('capture-complete.json',16000)]:
 fd=os.open(folder/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=limit
  raw=b''
  while len(raw)<=limit:
   block=os.read(fd,min(65536,limit+1-len(raw)))
   if not block: break
   raw+=block
  after=os.fstat(fd);named=(folder/name).lstat()
  identity=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
  assert len(raw)==s.st_size and identity(s)==identity(after)==identity(named)
  files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
  if name=='capture-complete.json': marker=json.loads(raw)
 finally: os.close(fd)
assert set(marker)=={'schemaVersion','files'} and marker['schemaVersion']=='pa-browser-capture-1' and marker['files']=={k:v for k,v in files.items() if k!='capture-complete.json'}
print(json.dumps({'schemaVersion':'pa-authenticated-handoff-1','files':files}))
`;
const quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
const sshOptions=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ConnectionAttempts=1'];
export function handoffArgv(remoteCapture,localFile,name){
 if(!/^tvd-pa-one-shot-[A-Za-z0-9_-]+$/.test(remoteCapture??'')||!names.includes(name)||!safePath(localFile))throw Error('handoff-path-refused');
 return {preflight:{file:'ssh',args:[...sshOptions,'plumbob','python3 -c '+quote(remoteCheck)],input:JSON.stringify({capture:remoteCapture})+'\n'},
 download:{file:'sftp',args:[...sshOptions,'-b','-','plumbob'],input:`get -p /mnt/d/tmp/plumbob/${remoteCapture}/${name} ${localFile}\n`}};
}
function checkManifest(manifest){
 if(manifest?.schemaVersion!=='pa-authenticated-handoff-1'||Object.keys(manifest).sort().join(',')!=='files,schemaVersion'||Object.keys(manifest.files??{}).sort().join(',')!==[...names].sort().join(','))throw Error('handoff-manifest-shape');
 names.forEach((name,i)=>{const f=manifest.files[name];if(Object.keys(f).sort().join(',')!=='bytes,sha256'||!hash(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>limits[i])throw Error('handoff-manifest-limit');});
 return manifest;
}
export async function receivePaBrowserHandoff({enabled=false,remoteCapture,out,transport},storage={}){
 if(enabled!==true)return {outcome:'disabled',fetchingEnabled:false,schedulingEnabled:false};
 // Fixture storage injection cannot select the live process transport. The CLI
 // supplies no injected storage; its Builder root admission remains mandatory.
 if(storage.outputDirectory&&!transport)throw Error('fixture-transport-required');
 // Validate all argv/path data before any process or network module import.
 handoffArgv(remoteCapture,out+'/probe','original.zip');
 const outputDirectory=storage.outputDirectory??watchOutputDirectory;
 const syncDirectory=storage.syncDirectory??syncPaDirectory;
 const root=outputDirectory(localOnly(out),undefined,true);
 const {lstatSync}=await import('node:fs');const stat=lstatSync(root);
 if(!stat.isDirectory()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid())throw Error('handoff-private-root-required');
 transport??=await processTransport();
 const preflight=handoffArgv(remoteCapture,join(root,'probe'),'original.zip').preflight;
 const manifest=checkManifest(JSON.parse(await transport.run(preflight)));
 const binding=digest(Buffer.from(JSON.stringify(names.map(name=>[name,manifest.files[name]]))));
 const directory=join(root,'handoff-'+binding);
 try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 localOnly(directory);const directoryStat=lstatSync(directory);
 if((directoryStat.mode&0o777)!==0o700||directoryStat.uid!==process.getuid()||!directoryStat.isDirectory())throw Error('handoff-directory-refused');
 for(let i=0;i<names.length;i++){
  const name=names[i],path=join(directory,name),expected=manifest.files[name];
  if(existsSync(path)){
   const bytes=boundedWatchFile(path,limits[i]);
   if(bytes.length!==expected.bytes||digest(bytes)!==expected.sha256||(lstatSync(path).mode&0o777)!==0o600)throw Error('handoff-original-conflict');
   continue;
  }
  // Download only to this owned temporary directory. Interruption preserves it;
  // a later explicit handoff resumes completed originals, never browser fetching.
  const staging=mkdtempSync(join(directory,'transfer-'));
  syncDirectory(directory);
  chmodSync(staging,0o700);
  const temporary=join(staging,name);
  await transport.run(handoffArgv(remoteCapture,temporary,name).download);
  const bytes=boundedWatchFile(temporary,limits[i]);
  if(bytes.length!==expected.bytes||digest(bytes)!==expected.sha256||(lstatSync(temporary).mode&0o777)!==0o600)throw Error('handoff-checksum-or-mode-conflict');
  publishPaPacketFile(path,bytes,limits[i]);
  unlinkSync(temporary); // Retain the staging directory as a diagnostic, never remove foreign files.
 }
 const marker=JSON.parse(Buffer.from(boundedWatchFile(join(directory,'capture-complete.json'),16_000)).toString('utf8'));
 if(marker.schemaVersion!=='pa-browser-capture-1'||Object.keys(marker).sort().join(',')!=='files,schemaVersion'||canonicalJson(marker.files)!==canonicalJson(Object.fromEntries(names.slice(0,3).map(n=>[n,manifest.files[n]]))))throw Error('handoff-capture-marker-conflict');
 const verified=await retainPaLocalOriginal({candidateId:'candidate-pa-export',zip:join(directory,names[0]),receipt:join(directory,names[1]),acquisition:join(directory,names[2]),out:root});
 syncDirectory(root);
 publishPaPacketFile(join(directory,'handoff-complete.json'),Buffer.from(JSON.stringify({schemaVersion:'pa-verified-handoff-1',manifest,packetSha256:verified.manifest.packetSha256})+'\n'),16_000);
 return verified;
}
/** Real noninteractive process adapter, intentionally lazy. No shell and no keys.
 * SSH's remote shell sees a fixed quoted program; only JSON stdin contains data. */
export async function processTransport(){
 const {spawn}=await import('node:child_process');
 return {run({file,args,input}){
  if(!['ssh','sftp'].includes(file))throw Error('handoff-process-refused');
  return new Promise((resolve,reject)=>{
   const child=spawn(file,args,{shell:false,stdio:['pipe','pipe','pipe']});
   let output='',count=0,finished=false;
   const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('handoff-process-timeout'));},25_000);
   function finish(error){if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);else resolve(output);}
   child.on('error',finish);child.stdin.on('error',finish);
   for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{count+=bytes.length;if(count>32_000){child.kill('SIGKILL');finish(Error('handoff-process-output-limit'));}else if(stream===child.stdout)output+=bytes.toString('utf8');});
   child.on('close',code=>finish(code===0?undefined:Error('handoff-process-refused-or-interrupted')));
   child.stdin.end(input);
  });
 }};
}
