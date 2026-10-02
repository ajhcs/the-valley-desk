import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
/** Same no-follow descriptor pattern as PA fixture/review-packet helpers. */
export function boundedWatchFile(path,max,io={openSync,closeSync,fstatSync,readSync,lstatSync}){
  const fd=io.openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=io.fstatSync(fd);
    if(!before.isFile()||!Number.isSafeInteger(before.size)||before.size>max)throw Error('watch-file-not-regular-or-bounded');
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const count=io.readSync(fd,bytes,offset,Math.min(bytes.length-offset,65536),null);if(!count)throw Error('watch-file-changed');offset+=count;}
    const extra=io.readSync(fd,Buffer.alloc(1),0,1,null),after=io.fstatSync(fd),named=io.lstatSync(path);
    if(extra||!named.isFile()||before.dev!==named.dev||before.ino!==named.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('watch-file-changed');
    return new Uint8Array(bytes);
  }finally{io.closeSync(fd);}
}
export function watchOutputDirectory(out,explicitRoot,privateOriginal=false){
  if(!out||!isAbsolute(out))throw Error('--out must name an existing absolute directory');
  const directory=realpathSync(out);
  const root=explicitRoot?realpathSync(explicitRoot):'/workspace/build/builderbob';
  return validateWatchOutputPaths(directory,root,privateOriginal);
}
/** Pure boundary for already canonical paths; the CLI always resolves them above. */
export function validateWatchOutputPaths(directory,root,privateOriginal=false){
  const within=(path,root)=>path===root||path.startsWith(root+sep);
  const builderRoot='/workspace/build/builderbob';
  if(!isAbsolute(root)||!within(root,builderRoot))throw Error('Task root must stay in private Builder workspace build storage');
  if(within(directory,root))return directory;
  // Preserve the existing legacy text-capture fixture output only. Browser
  // originals and their private receipts never enter tracked fixture storage.
  if(!privateOriginal&&directory===resolve('test/fixtures/watch-launch'))return directory;
  throw Error('Output must stay in private task storage');
}
