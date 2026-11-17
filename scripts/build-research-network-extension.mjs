import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateManifest, validateIntake, extendNetwork } from '../src/ingest/discovery/research-network-extension.ts';
import { verifyReceipt } from './lib/research-network-extension-receipts.mjs';
const args=process.argv.slice(2); if(args.length>1 || (args.length && args[0]!=='--check')) throw Error('Usage: build-research-network-extension.mjs [--check]');
const old='docs/discovery/go-live/evidence/GL05/regional-expansion-20261117', dir='docs/discovery/go-live/evidence/GL05/regional-extension-20261117';
const sha=b=>createHash('sha256').update(b).digest('hex');
const provenance=[];
async function readPinned(path,expected) { const bytes=await readFile(path); verifyReceipt(bytes,expected); provenance.push({path,...expected}); return JSON.parse(bytes.toString('utf8')); }
async function readOld(name,hash) { const path=`${old}/${name}`, bytes=await readFile(path); if(sha(bytes)!==hash)throw Error(`Frozen baseline mismatch: ${path}`); const r={sha256:hash,bytes:bytes.length}; provenance.push({path,...r}); return JSON.parse(bytes.toString('utf8')); }
const oldNet=await readOld('research-network.json','6eca9df3495507c77fb3973586fd51f7e386533ec47f970af15337be93357897');
const oldQueue=await readOld('qualification-queue.json','bae3720eeb8aa4a01f4b6d0b35923c4f3fb321c7b87020cfdcf9858f335afc79');
const batches=['sju','pcom','widener','scranton','lehigh','rowan'], intakes=[];
const manifestHashes={sju:'838d1c4908d0c0b4222e56b39de3e1cab346bbd28d17a5cf77a564540dc42f3d',pcom:'a1a10654b924d32e79f6afd38eb3a23623a0329733f10a2056ad6ae26c0816d5',widener:'e6bbd6c8c4e630f63a28c92b2ab16b8f093747e63d747a526b4131785bca84ca',scranton:'f7d4ff08726be245e27a7887e2cae17ff3ec3efda70ccd0ee70d6cdd18b1e571',lehigh:'c1eed70faf2c67f92cc5edcf7fed35706fba0905c6d9404705306eb867bfb2e8',rowan:'81773efe0effe21cdf35f1671da0d7bde1d15af261879a61babd4cc5f09991c0'};
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
if(oldObs.length!==9275 || nodes.length!==637 || edges.length!==820 || oldQueue.sourceRecords.length!==4472)throw Error('Frozen baseline count mismatch');
const result=extendNetwork(oldObs,nodes,edges,records);
const observations=[...oldQueue.observations,...result.observations.slice(oldObs.length).map(o=>o.kind==='external-resource'?{...o,urlKind:'external-resource',accountKey:null,repositoryKey:null}:o)];
const distinct=rows=>new Set(rows.filter(o=>o.urlKind==='repository-url').map(o=>o.repositoryKey)).size;
const counts={accounts:result.accounts.length,repositoryCandidateIndex:result.repositories.length,distinctRepositoryUrlLeads:distinct(observations),distinctRepositoryUrlLeadsExcludingBroadChecks:distinct(observations.filter(o=>!(o.batch==='drexel'&&o.kind==='statuses'))),nativeRepositories:result.repositories.filter(r=>r.nativeId).length,observations:observations.length,cooperNodes:nodes.length,cooperEdges:edges.length,newSourceRecords:records.length,sourceRecordsByBatch:Object.fromEntries(intakes.map(x=>[x.batch,x.records.length]))};
if(counts.nativeRepositories!==231)throw Error('Unexpected native IDs');
const header={schemaVersion:'regional-research-network-extension-v1',visibility:'private',publicationAuthorized:false,provenance,qualification:'All source-reported observations are unreviewed. No publication, source capture, enrollment, public admission, ownership, current employment, worksite, health purpose or person identity is established.',geography:'Nine-county DVRPC primary; Delaware, Scranton and Lehigh Valley are neighboring context. Institutional location does not establish worksite.'};
const network={...header,counts,sourceCoverage:{...oldNet.sourceCoverage,...Object.fromEntries(intakes.map(x=>[x.batch,{coverage:x.coverage,qualifications:x.qualifications}]))},accounts:result.accounts,repositories:result.repositories,nodes:oldNet.nodes,edges:oldNet.edges};
const queue={...header,inheritedSourceRecords:{path:`../regional-expansion-20261117/qualification-queue.json`,sha256:'bae3720eeb8aa4a01f4b6d0b35923c4f3fb321c7b87020cfdcf9858f335afc79',jsonPointer:'/sourceRecords',count:4472},observations,sourceRecords:records};
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
const report=`# Regional research lead map: twelve-batch extension\n\nThe nine-county DVRPC region remains primary. Scranton and the Lehigh Valley are neighboring context. Locations, historical affiliations and institutional relationships do not establish present employment, ownership or worksite. All entries are private, source-reported and unreviewed; publication is not authorized.\n\nThe index contains ${counts.accounts} distinct account URL keys and ${counts.repositoryCandidateIndex} repository candidate keys, with ${counts.nativeRepositories} previously reported native IDs. The queue contains ${counts.distinctRepositoryUrlLeads} distinct repository-shaped URL leads; ${counts.distinctRepositoryUrlLeadsExcludingBroadChecks} exclude Drexel broad-check-only observations. URL-shaped leads are not eligible-project counts. The prior 9,275 observations and the Cooper graph of 637 nodes and 820 edges remain intact.\n\n## New source batches\n\n${batchLines}\n\nPCOM Georgia, SJU Lancaster, and Rowan connections to Zhu and Tulane retain their source-reported historical or mixed context. Account-only, empty or limited coverage, relationships and external resources remain source observations. A source-reported date or status is not independently verified.\n\n[Network](research-network.json) · [Observation and source-record queue](qualification-queue.json) · [Previous six-batch map](../regional-expansion-20261117/research-network.md)\n`;
const integration=`# GL05 regional extension integration\n\nThe private [twelve-batch map](../evidence/GL05/regional-extension-20261117/research-network.md) adds six source-reported intakes to the frozen six-batch snapshot. The previous observation array and Cooper graph are retained exactly; a pinned queue reference preserves the 4,472 inherited source records. Each sanitized output is checked against its manifest SHA-256 and byte count before parsing. Source input receipts are retained in the manifests, but the integration does not replay or independently verify the source materials.\n\nDVRPC remains primary; Scranton and Lehigh Valley are neighboring context. Source-reported locations and relationships do not establish worksite, identity, ownership or current affiliation. Repository-shaped leads are not qualified projects. No source network requests, supplied scripts, publication or public admission are authorized by this integration.\n`;
for(const [path,body] of [[`${dir}/research-network.json`,JSON.stringify(network,null,2)+'\n'],[`${dir}/qualification-queue.json`,JSON.stringify(queue,null,2)+'\n'],[`${dir}/research-network.md`,report],['docs/discovery/go-live/execution/GL05-extension-integration.md',integration]]) {if(args[0]==='--check'){if(await readFile(path,'utf8')!==body)throw Error(`Stale: ${path}`);}else await writeFile(path,body);}
console.log(JSON.stringify(counts));
