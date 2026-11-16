// Private operator boundary. JSON stdin avoids shell arguments containing bodies.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {DirectoryAcquisitionStore} from './discovery-directory-acquire.mjs';
export function operate(input) {
  const store = new DirectoryAcquisitionStore(input.directory, input.plan);
  try {
    if (input.action === 'issue') {
      store.reserve(input.pageId);
      return store.markAttempt(input.pageId, new Date().toISOString());
    }
    if (input.action === 'finish') return store.finish(input.receipt, input.packet ?? undefined);
    if (input.action === 'progress') return {progress: store.progress(), candidates: store.listCandidates()};
    throw new Error('unknown-operation');
  } finally {store.close();}
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {process.stdout.write(JSON.stringify({ok:true,result:operate(JSON.parse(readFileSync(0,'utf8')))}));}
  catch {process.stdout.write(JSON.stringify({ok:false,code:'journal-operation-rejected'}));process.exitCode=1;}
}
