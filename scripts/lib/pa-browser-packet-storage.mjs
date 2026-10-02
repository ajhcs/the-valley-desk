import { mkdirSync, writeFileSync, openSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { boundedWatchFile, watchOutputDirectory } from './watch-local-files.mjs';
/** Private operator storage; never a fixture writer. Partial interrupted writes
 * are safely completed on replay, and existing original bytes never overwritten. */
export function privatePaPacketRetainer(out){
  const root=watchOutputDirectory(out,undefined,true);
  return async packet=>{
    if(!/^[a-f0-9]{64}$/.test(packet.packetSha256))throw Error('packet-storage-id-invalid');
    const directory=join(root,packet.packetSha256);try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const checked=watchOutputDirectory(directory,root,true);
    for(const [name,bytes,max] of [['original.zip',packet.bytes,2_000_000],['original-receipt.json',packet.receiptBytes,64_000],['acquisition.json',packet.acquisitionBytes,64_000]]){
      if(!(bytes instanceof Uint8Array)||bytes.byteLength>max)throw Error('packet-storage-byte-limit');
      const path=join(checked,name);
      publishPaPacketFile(path,bytes,max);
    }
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
    try{write(fd,bytes);}finally{closeSync(fd);}
    if(!Buffer.from(boundedWatchFile(temporary,max)).equals(Buffer.from(bytes)))throw Error('packet-storage-incomplete');
    try{linkSync(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    if(!Buffer.from(boundedWatchFile(path,max)).equals(Buffer.from(bytes)))throw Error('packet-storage-conflict');
  }finally{unlinkSync(temporary);}
}
