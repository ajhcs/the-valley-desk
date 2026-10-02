import { mkdirSync, writeFileSync, openSync, closeSync, linkSync, unlinkSync, lstatSync, fsyncSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { boundedWatchFile, watchOutputDirectory } from './watch-local-files.mjs';
/** Private operator storage; never a fixture writer. Partial interrupted writes
 * are safely completed on replay, and existing original bytes never overwritten. */
export function privatePaPacketRetainer(out,storage={}){
  const outputDirectory=storage.outputDirectory??watchOutputDirectory;
  const syncDirectory=storage.syncDirectory??syncPaDirectory;
  const root=outputDirectory(out,undefined,true);
  privateOwned(root);
  return async packet=>{
    if(!/^[a-f0-9]{64}$/.test(packet.packetSha256))throw Error('packet-storage-id-invalid');
    const directory=join(root,packet.packetSha256);try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const checked=outputDirectory(directory,root,true);
    privateOwned(checked);
    for(const [name,bytes,max] of [['original.zip',packet.bytes,2_000_000],['original-receipt.json',packet.receiptBytes,64_000],['acquisition.json',packet.acquisitionBytes,64_000]]){
      if(!(bytes instanceof Uint8Array)||bytes.byteLength>max)throw Error('packet-storage-byte-limit');
      const path=join(checked,name);
      publishPaPacketFile(path,bytes,max);
    }
    syncDirectory(root); // Persist the packet directory entry, including on replay.
    // Durable completion marker is last; missing marker is held crash state.
    const marker=new TextEncoder().encode(JSON.stringify({schemaVersion:'pa-intake-retention-1',packetSha256:packet.packetSha256,sourceId:packet.sourceId})+'\n');
    publishPaPacketFile(join(checked,'intake-complete.json'),marker,16_000);
    return {packetSha256:packet.packetSha256};
  };
}

/** Complete a bounded owned temporary file before no-replace atomic publication.
 * The write seam is internal test I/O, never a CLI storage-policy option. */
export function publishPaPacketFile(path,bytes,max,write=writeFileSync){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>max)throw Error('packet-storage-byte-limit');
  const temporary=path+'.tmp-'+randomUUID();
  const fd=openSync(temporary,'wx',0o600); // Only this successful open establishes ownership.
  try{
    try{write(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    if(!Buffer.from(boundedWatchFile(temporary,max)).equals(Buffer.from(bytes)))throw Error('packet-storage-incomplete');
    try{linkSync(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    if(!Buffer.from(boundedWatchFile(path,max)).equals(Buffer.from(bytes)))throw Error('packet-storage-conflict');
    const stat=lstatSync(path);
    if((stat.mode&0o777)!==0o600||stat.uid!==process.getuid())throw Error('packet-storage-mode-or-owner');
    const directory=openSync(join(path,'..'),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{fsyncSync(directory);}finally{closeSync(directory);}
  }finally{unlinkSync(temporary);}
}
function privateOwned(path){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid())throw Error('packet-storage-directory-not-private');}

/** Descriptor-only parent-entry durability barrier; no path policy override. */
export function syncPaDirectory(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
