import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateManifest, validateIntake } from '../src/ingest/discovery/research-network-additions.ts';
import { extendNetwork } from '../src/ingest/discovery/research-network-extension.ts';
import { verifyReceipt } from './lib/research-network-extension-receipts.mjs';
const args=process.argv.slice(2); if(args.length>1 || (args.length && args[0]!=='--check')) throw Error('Usage: build-research-network-additions.mjs [--check]');
const old='docs/discovery/go-live/evidence/GL05/regional-extension-20261117', dir='docs/discovery/go-live/evidence/GL05/regional-additions-20261117';
const sha=b=>createHash('sha256').update(b).digest('hex');
const provenance=[];
async function readPinned(path,expected) { const bytes=await readFile(path); verifyReceipt(bytes,expected); provenance.push({path,...expected}); return JSON.parse(bytes.toString('utf8')); }
async function readOld(name,hash) { const path=`${old}/${name}`, bytes=await readFile(path); if(sha(bytes)!==hash)throw Error(`Frozen baseline mismatch: ${path}`); const r={sha256:hash,bytes:bytes.length}; provenance.push({path,...r}); return JSON.parse(bytes.toString('utf8')); }
const oldNet=await readOld('research-network.json','7fd3bacf269cca0c5bfb480d9f9a3abea01f84dfce6345b617cffc3872f28510');
const oldQueue=await readOld('qualification-queue.json','cdf3f01c2125c80c033fd0bbdeb37dc4e40386ddee7bc238cd70307cdbcf0fa7');
const batches=['incubators','wistar','public-health'], intakes=[];
const manifestHashes={incubators:'df70954076844b11ad6010e2cb58a3be4d8504cc9b209d9a7575438cf9d82c76',wistar:'5ced19b9335805863006e09276b9ba3c2e92b92c8c936f84582275a6d039f31e','public-health':'26a05fd8503aad69224b92e73dc9494342309abc7538abee8b6fba05b104d4bc'};
for (const batch of batches) {
 const path=`${dir}/${batch}/manifest.json`, bytes=await readFile(path); if(sha(bytes)!==manifestHashes[batch])throw Error(`Manifest hash mismatch: ${batch}`); provenance.push({path,sha256:sha(bytes),bytes:bytes.length});
 const manifest=validateManifest(JSON.parse(bytes.toString('utf8')),batch);
 const intake=validateIntake(await readPinned(`${dir}/${batch}/source-assertions.json`,manifest.outputs['source-assertions.json']),manifest);
 intakes.push(intake);
}
const records=intakes.flatMap(x=>x.records);
const oldObs=oldQueue.observations.map(({id,batch,kind,url,nativeId,observedDate,fields})=>({id,batch,kind,url,nativeId,observedDate,fields}));
const nodes=oldNet.nodes.map(({id,type,label,url,sourcePointer})=>({id,type,label,url,sourcePointer}));
const edges=oldNet.edges.map(({id,source,target,relationship,evidenceUrl,reportedConfidence,status,sourcePointer})=>({id,source,target,relationship,evidenceUrl,reportedConfidence,status,sourcePointer}));
if(oldObs.length!==17665 || nodes.length!==637 || edges.length!==820 || oldQueue.sourceRecords.length!==3261)throw Error('Frozen baseline count mismatch');
const result=extendNetwork(oldObs,nodes,edges,records);
const observations=[...oldQueue.observations,...result.observations.slice(oldObs.length).map(o=>o.kind==='external-resource'?{...o,urlKind:'external-resource',accountKey:null,repositoryKey:null}:o)];
const distinct=rows=>new Set(rows.filter(o=>o.urlKind==='repository-url').map(o=>o.repositoryKey)).size;
const counts={accounts:result.accounts.length,repositoryCandidateIndex:result.repositories.length,distinctRepositoryUrlLeads:distinct(observations),distinctRepositoryUrlLeadsExcludingBroadChecks:distinct(observations.filter(o=>!(o.batch==='drexel'&&o.kind==='statuses'))),nativeRepositories:result.repositories.filter(r=>r.nativeId).length,observations:observations.length,cooperNodes:nodes.length,cooperEdges:edges.length,newSourceRecords:records.length,sourceRecordsByBatch:Object.fromEntries(intakes.map(x=>[x.batch,x.records.length]))};
if(counts.nativeRepositories!==231)throw Error('Unexpected native IDs');
const header={schemaVersion:'regional-research-network-additions-v1',visibility:'private',publicationAuthorized:false,provenance,qualification:'All source-reported observations are unreviewed. No publication, source capture, enrollment, public admission, ownership, current employment, worksite, health purpose or person identity is established.',geography:'Nine-county DVRPC primary; Delaware, Scranton and Lehigh Valley are neighboring context. Institutional location does not establish worksite.'};
const network={...header,counts,sourceCoverage:{...oldNet.sourceCoverage,...Object.fromEntries(intakes.map(x=>[x.batch,{coverage:x.coverage,qualifications:x.qualifications}]))},accounts:result.accounts,repositories:result.repositories,nodes:oldNet.nodes,edges:oldNet.edges};
const queue={...header,inheritedSourceRecords:{path:`../regional-extension-20261117/qualification-queue.json`,sha256:'cdf3f01c2125c80c033fd0bbdeb37dc4e40386ddee7bc238cd70307cdbcf0fa7',jsonPointer:'/sourceRecords',count:3261},observations,sourceRecords:records};
const batchLines=intakes.map(x=>{
 const kinds=Object.entries(x.records.reduce((a,r)=>(a[r.kind]=(a[r.kind]??0)+1,a),{})).sort(([a],[b])=>a.localeCompare(b)).map(([k,n])=>`${k}: ${n}`).join(', ');
 const accounts=new Map();
 for(const o of result.observations.filter(o=>o.batch===x.batch && o.urlKind==='account-url')) {
  const contexts=accounts.get(o.accountKey) ?? new Set();
  contexts.add(`${o.fields.sourcePointer}${o.fields.sourceRefs?.length?` (${o.fields.sourceRefs.join(', ')})`:''}`); accounts.set(o.accountKey,contexts);
 }
 const accountLines=[...accounts].sort(([a],[b])=>a.localeCompare(b)).map(([key,contexts])=>`- [${key}](https://github.com/${key}) — ${[...contexts].sort().map(s=>`\`${s}\``).join(', ')}`).join('\n');
 return `### ${x.batch.toUpperCase()}\n\n${x.records.length} source records (${kinds}). ${x.qualifications.join(' ')}\n\nReported account URLs and source contexts:\n\n${accountLines || 'None classified.'}`;
}).join('\n\n');
const report=`# Regional research lead map: three additional intakes

The nine-county DVRPC region remains primary. The source's broader Greater Philadelphia scope does not expand the nine-county boundary; Delaware locations remain neighboring context. Reported affiliations and location do not establish current worksite, ownership or identity. These leads remain private and unreviewed; publication is not authorized.

The index contains ${counts.accounts} account keys and ${counts.repositoryCandidateIndex} catalog candidate keys, with ${counts.nativeRepositories} inherited native IDs. The queue contains ${counts.distinctRepositoryUrlLeads} distinct repository-shaped URL leads; ${counts.distinctRepositoryUrlLeadsExcludingBroadChecks} exclude Drexel broad checks. URL leads are not eligible projects. The previous 17,665 observations and Cooper graph remain intact.

## New source batches

${batchLines}

The incubator export coverage is inherited from the earlier six-batch snapshot, not fresh evidence. HEAD results do not establish ownership or relevance. PHL-2's official status is unconfirmed; citywide and community accounts are not the public health lab. PABC membership does not establish residency, and BioLabs for Advanced Therapeutics is distinct from B+labs. Source dates, forks, and qualifications are reported, not independently verified.

[Network](research-network.json) · [Queue](qualification-queue.json) · [Previous map](../regional-extension-20261117/research-network.md)
`;
const integration=`# GL05 three-intake integration

The private [map](../evidence/GL05/regional-additions-20261117/research-network.md) extends the frozen twelve-batch snapshot. It retains the previous observations and graph and points to 3,261 inherited source records; that queue in turn points to 4,472 earlier records. Manifest hashes and source assertion hashes and lengths are checked before parsing. Input receipts are reported by producers and not revalidated against original source materials here.

DVRPC remains primary; broader source geography and Delaware are context. Incubator copies of earlier derived exports are compact coverage records, not independent new observations. Accounts and repository-shaped leads require qualification before any publication. No source requests, supplied scripts, publication or public admission were performed by this build.
`;
for(const [path,body] of [[`${dir}/research-network.json`,JSON.stringify(network,null,2)+'\n'],[`${dir}/qualification-queue.json`,JSON.stringify(queue,null,2)+'\n'],[`${dir}/research-network.md`,report],['docs/discovery/go-live/execution/GL05-additions-integration.md',integration]]) {if(args[0]==='--check'){if(await readFile(path,'utf8')!==body)throw Error(`Stale: ${path}`);}else await writeFile(path,body);}
console.log(JSON.stringify(counts));
