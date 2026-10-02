import { lstatSync, mkdirSync } from 'node:fs';
import { resolve, join, basename, parse, sep } from 'node:path';
import { z } from 'zod';
import { boundedWatchFile } from './watch-local-files.mjs';
import { publishPaPacketFile } from './pa-browser-packet-storage.mjs';
import { importPaOriginal } from './pa-original-import.ts';
import { launchCandidate } from '../../fixtures/watch-launch-candidates.ts';
import { canonicalJson, sha256 } from '../../src/content/watch-schema.ts';
import { sourceConfigurationDigest } from '../../src/ingest/watch/source-enrollment.ts';
const names=['original.zip','original-receipt.json','acquisition.json'];
const limits=[2_000_000,64_000,64_000];
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.object({sha256:hash,bytes:z.number().int().positive(),mode:z.literal(384)}).strict();
const Manifest=z.object({schemaVersion:z.literal('pa-retained-packet-1'),candidateId:z.literal('candidate-pa-export'),sourceConfigurationSha256:hash,packetSha256:hash,derivationSha256:hash,directoryMode:z.literal(448),files:z.object({'original.zip':file,'original-receipt.json':file,'acquisition.json':file}).strict(),fetchingEnabled:z.literal(false),publicationAuthorized:z.literal(false),activationAuthorized:z.literal(false),successfulUpstreamCheckRenewed:z.literal(false)}).strict();
/** Pure preflight for the complete applicable argument set, before filesystem I/O. */
export function assertLocalArguments(paths){
  for(const path of paths)if(typeof path!=='string'||!path||/^[a-z][a-z0-9+.-]*:/i.test(path))throw Error('pa-retained-acquisition-disabled');
}
export function localOnly(path){
  assertLocalArguments([path]);
  const absolute=resolve(path);let cursor=parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(sep).filter(Boolean)){
    cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw Error('pa-retained-symlink');
  }
  return absolute;
}
function privateDirectory(path){const directory=localOnly(path),stat=lstatSync(directory);if(!stat.isDirectory()||(stat.mode&0o777)!==0o700||(process.getuid&&stat.uid!==process.getuid()))throw Error('pa-retained-directory-not-private');return directory;}
function decode(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function describe(candidateId,parts){
  if(candidateId!=='candidate-pa-export')throw Error('pa-retained-candidate-invalid');
  const source=launchCandidate(candidateId).source;
  const imported=await importPaOriginal(candidateId,parts[0],decode(parts[2]),parts[1]);
  const configuration=await sourceConfigurationDigest(source),hashes=await Promise.all(parts.map(sha256));
  const packetSha256=await sha256(canonicalJson([candidateId,configuration,...hashes]));
  const manifest=Manifest.parse({schemaVersion:'pa-retained-packet-1',candidateId,sourceConfigurationSha256:configuration,packetSha256,derivationSha256:await sha256(canonicalJson(imported.derivation)),directoryMode:0o700,files:Object.fromEntries(names.map((name,i)=>[name,{sha256:hashes[i],bytes:parts[i].length,mode:0o600}])),fetchingEnabled:false,publicationAuthorized:false,activationAuthorized:false,successfulUpstreamCheckRenewed:false});
  return {manifest,imported,source};
}
/** Trusted local filesystem boundary. The CLI separately enforces Builder private
 * storage roots; transport supplies an existing private directory, never a URL. */
export async function retainPaLocalOriginal({candidateId,zip,receipt,acquisition,out}){
  assertLocalArguments([zip,receipt,acquisition,out]);
  if(candidateId!=='candidate-pa-export')throw Error('pa-retained-candidate-invalid');
  const paths=[zip,receipt,acquisition].map(localOnly),root=privateDirectory(out);
  const parts=paths.map((path,i)=>boundedWatchFile(path,limits[i]));
  const {manifest}=await describe(candidateId,parts),directory=join(root,manifest.packetSha256);
  try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  privateDirectory(directory);
  for(let i=0;i<names.length;i++)publishPaPacketFile(join(directory,names[i]),parts[i],limits[i]);
  // Manifest is the completion marker; no original or prior manifest is replaced.
  publishPaPacketFile(join(directory,'manifest.json'),new TextEncoder().encode(canonicalJson(manifest)),16_000);
  return verifyPaRetainedPacket(directory);
}
/** No byte packet is returned to an intake caller until every original and binding
 * has passed descriptor, mode, hash, receipt, source and derivation validation. */
export async function verifyPaRetainedPacket(path){
  const directory=privateDirectory(path),manifestPath=join(directory,'manifest.json');
  const manifest=Manifest.parse(decode(boundedWatchFile(manifestPath,16_000)));
  if((lstatSync(manifestPath).mode&0o777)!==0o600||basename(directory)!==manifest.packetSha256)throw Error('pa-retained-manifest-binding');
  const parts=names.map((name,i)=>{
    const filePath=join(directory,name),bytes=boundedWatchFile(filePath,limits[i]);
    if((lstatSync(filePath).mode&0o777)!==manifest.files[name].mode||bytes.length!==manifest.files[name].bytes)throw Error('pa-retained-file-metadata');
    return bytes;
  });
  const described=await describe(manifest.candidateId,parts);
  if(canonicalJson(manifest)!==canonicalJson(described.manifest))throw Error('pa-retained-packet-binding');
  return {...described,directory,packet:{bytes:parts[0],receiptBytes:parts[1],acquisitionBytes:parts[2]}};
}
export function retainedSummary(result){return {packetSha256:result.manifest.packetSha256,manifest:join(result.directory,'manifest.json'),derivation:result.imported.derivation,captures:result.imported.captures,acquisition:result.imported.acquisition,qualificationStatus:result.imported.qualificationStatus,fetchingEnabled:false,publicationAuthorized:false,activationAuthorized:false,successfulUpstreamCheckRenewed:false};}
