import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateRows, expand } from '../src/ingest/discovery/research-network-expansion.ts';
const args=process.argv.slice(2); if(args.length>1 || (args.length && args[0]!=='--check')) throw Error('Usage: build-research-network-expansion.mjs [--check]');
const base='docs/discovery/go-live/evidence/GL05/regional-import-20261117', dir='docs/discovery/go-live/evidence/GL05/regional-expansion-20261117';
const sha=b=>createHash('sha256').update(b).digest('hex'); const provenance=[];
async function read(path, expected) { const b=await readFile(path); const hash=sha(b); if (!expected || hash!==expected.sha256 || (expected.bytes!==undefined && b.length!==expected.bytes)) throw Error(`Input receipt mismatch: ${path}`); provenance.push({path,sha256:hash,bytes:b.length}); return JSON.parse(b.toString('utf8')); }
const oldNet=await read(`${base}/research-network.json`,{sha256:'425d3cc240e975c6df45812ed3be917d28af730168b13858882a778e4967ed8d'});
const oldQueue=await read(`${base}/qualification-queue.json`,{sha256:'b93204134f6f6a8a16ca168f845b6bad7f25c6d4f50994eb748cc50fa07c6137'});
async function manifest(path) { const b=await readFile(path); provenance.push({path,sha256:sha(b),bytes:b.length}); return JSON.parse(b.toString('utf8')); }
const dm=await manifest(`${dir}/drexel-v3/manifest.json`), vm=await manifest(`${dir}/villanova/manifest.json`);
if(dm.publicationAuthorized!==false || dm.intake!=='drexel' || !dm.files?.['source-assertions.json'] || !vm.outputs?.['source-assertions.json']) throw Error('Missing source receipt');
const d=await read(`${dir}/drexel-v3/source-assertions.json`,dm.files['source-assertions.json']);
const v=await read(`${dir}/villanova/source-assertions.json`,vm.outputs['source-assertions.json']);
if(d.publicationAuthorized!==false || d.version!==1 || v.publicationAuthorized!==false || v.schemaVersion!=='villanova-source-assertions-v1') throw Error('Unexpected source schema');
const groupsD=['accounts','repositories','projects','studentAssociations','statuses','publicationSearch','studentVerified','studentReview','publicationReview','expandedPublicationReview','forkReview'];
const groupsV=['accounts','projects','externalResources','professionalOccurrences','sourceObservations','citations'];
if (d.coverage?.broadRootChecksAreProjects !== false || d.coverage?.publicationAuthorized !== false || d.accounts.length !== d.coverage.accountContextAssociations || groupsD.filter(g=>g!=='accounts').some(g=>d[g].length!==d.coverage.counts[g])) throw Error('Drexel coverage mismatch');
if (v.accounts.length!==v.coverage.accounts || v.projects.length!==v.coverage.repositoryPaths || v.externalResources.length!==v.coverage.externalCodeResources || v.accounts.length+v.projects.length!==v.coverage.reportedGithubUrls) throw Error('Villanova coverage mismatch');
const observations=[], sourceRecords=[];
const add=(id,batch,kind,url,fields,date=null)=>observations.push({id,batch,kind,url:url??null,nativeId:null,observedDate:date,fields});
for (const group of groupsD) for (const row of validateRows('drexel',group,d[group])) {
 if (!dm.sourceFilesSha256?.[row.sourceRef.file]) throw Error('Unmanifested Drexel source reference');
 const id=`drexel:${group}:${row.sourceRef.file}:${row.sourceRef.row}`;
 sourceRecords.push({id,batch:'drexel',group,record:row,publicationAuthorized:false});
 const url=group==='accounts'?`https://github.com/${row.account}`:row.url??row.repository_root_url??row.repository_url??row.requested_root_url??row.project_url??row.parent_url??null;
 const kind=group==='accounts'?'account':group==='repositories'?'repository':group;
 add(id,'drexel',kind,url,{sourcePointer:`${row.sourceRef.file}#row=${row.sourceRef.row}`,status:row.reviewState},null);
}
for (const group of groupsV) for (const [index,row] of validateRows('villanova',group,v[group]).entries()) {
 if (!vm.inputs?.['README.md']) throw Error('Missing Villanova source reference');
 if (group==='externalResources') { const u=new URL(row.url); if(u.protocol!=='https:' || u.hostname.toLowerCase()==='github.com' || u.username || u.password || /\s/.test(row.url)) throw Error('Invalid external resource'); }
 const id=`villanova:${group}:${row.id??index+1}`;
 sourceRecords.push({id,batch:'villanova',group,record:row,publicationAuthorized:false});
 const kind=group==='accounts'?'account':group==='projects'?'project':group==='externalResources'?'external-resource':group;
 add(id,'villanova',kind,row.url??null,{sourceRefs:row.sourceRefs??[row.sourceRef],status:'source_reported_unreviewed'},v.snapshotDate);
}
const cleanObs=oldQueue.observations.map(({id,batch,kind,url,nativeId,observedDate,fields})=>({id,batch,kind,url,nativeId,observedDate,fields}));
const cleanNodes=oldNet.nodes.map(({id,type,label,url,sourcePointer})=>({id,type,label,url,sourcePointer}));
const cleanEdges=oldNet.edges.map(({id,source,target,relationship,evidenceUrl,reportedConfidence,status,sourcePointer})=>({id,source,target,relationship,evidenceUrl,reportedConfidence,status,sourcePointer}));
const result=expand(cleanObs,cleanNodes,cleanEdges,observations);
const all=[...oldQueue.observations,...result.observations.slice(cleanObs.length).map(o=>o.kind==='external-resource'?{...o,urlKind:'external-resource',repositoryKey:null,accountKey:null}:o)];
const distinct=rows=>new Set(rows.filter(o=>o.urlKind==='repository-url').map(o=>o.repositoryKey)).size;
const counts={accounts:result.accounts.length,repositoryCandidateIndex:result.repositories.length,distinctRepositoryUrlLeads:distinct(all),distinctRepositoryUrlLeadsExcludingBroadChecks:distinct(all.filter(o=>!(o.batch==='drexel'&&o.kind==='statuses'))),nativeRepositories:result.repositories.filter(r=>r.nativeId).length,observations:all.length,cooperNodes:result.nodes.length,cooperEdges:result.edges.length,drexelBroadRootChecks:d.statuses.length,villanovaExternalResources:v.externalResources.length};
if(counts.nativeRepositories!==231 || cleanObs.length!==4803 || cleanNodes.length!==637 || cleanEdges.length!==820) throw Error('Frozen baseline mismatch');
const header={schemaVersion:'regional-research-network-expansion-v1',visibility:'private',publicationAuthorized:false,provenance,qualification:'All source-reported observations are unreviewed. No publication, source capture, enrollment, public admission, ownership, current employment, worksite, health purpose or person identity is established.',geography:'Nine-county DVRPC primary; Delaware connections are neighboring context and do not establish worksite.'};
const network={...header,counts,sourceCoverage:{...oldNet.sourceCoverage,drexel:{coverage:d.coverage,qualifications:d.qualifications},villanova:{coverage:v.coverage,qualifications:v.qualifications}},accounts:result.accounts,repositories:result.repositories,nodes:oldNet.nodes,edges:oldNet.edges};
const queue={...header,observations:all,sourceRecords};
const link=(label,raw)=>{if(typeof raw!=='string'||/\s/.test(raw))throw Error('Invalid link');const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid link');return `[${String(label).replace(/[\\\[\]]/g,'\\$&')}](${u.href.replace(/\(/g,'%28').replace(/\)/g,'%29')})`;};
const drexelGroups=d.accounts.map(a=>`- ${link(a.account,`https://github.com/${a.account}`)} — ${a.reportedContext}.`).join('\n');
const villanovaGroups=v.accounts.map(a=>`- ${link(a.handle,a.url)} — ${(a.reportedSections??[]).join(', ')}; ${a.reportedContext??a.reportedAccountType}.`).join('\n');
const resources=v.externalResources.map((a,i)=>`- ${link(`Resource ${i+1}`,a.url)} — ${a.purpose}.`).join('\n');
const report=`# Regional research lead map: expansion\n\nThe nine-county DVRPC area remains primary. ChristianaCare Delaware connections remain neighboring context; collaborator locations are not inferred. All entries are private, source-reported and unreviewed. No public admission or publication is authorized.\n\nAcross the six source batches, the index contains ${counts.accounts} distinct account URL keys and ${counts.repositoryCandidateIndex} repository candidate keys, with ${counts.nativeRepositories} reported native IDs. The full queue contains ${counts.distinctRepositoryUrlLeads} distinct repository-shaped URL leads including broad checks; ${counts.distinctRepositoryUrlLeadsExcludingBroadChecks} remain when Drexel broad-check-only observations are excluded. These are not counts of institutional ownership or eligible health projects. The previous 4,803 observations and Cooper graph of 637 nodes and 820 edges remain intact.\n\n## Drexel reported accounts and labs\n\n${drexelGroups}\n\nThe Drexel snapshot reports 435 account repository rows, 336 project associations and 147 student associations. Its ${counts.drexelBroadRootChecks} broad root checks are search coverage, not Drexel health projects. Root availability does not prove a branch, ownership or identity. Reported corrections and historical aliases remain unverified; related hosted copies do not establish common native identity.\n\n## Villanova reported accounts and groups\n\n${villanovaGroups}\n\nThe source reports 17 accounts and 66 repository paths in a bounded historical search. No current affiliation, account ownership or worksite is inferred.\n\n## External code resources\n\n${resources}\n\nThese two non-GitHub resources are separate from malformed GitHub fragments and repository-key counts.\n\n[Expanded network](research-network.json) · [Full observation and source-record queue](qualification-queue.json) · [Previous four-institution map](../regional-import-20261117/research-network.md) · [Drexel intake](drexel-v3/manifest.json) · [Villanova intake](villanova/manifest.json)\n`;
const integration=`# GL05 regional expansion integration\n\nThe private [expanded map](../evidence/GL05/regional-expansion-20261117/research-network.md) adds Drexel and Villanova source-reported observations to the preserved four-institution snapshot. Retained manifests bind each new source output by SHA-256 and bytes; fixed hashes bind the previous network and queue. The source records preserve original roles, source pointers, statuses and dates. Nine-county DVRPC remains primary and ChristianaCare Delaware connections remain neighboring context. Person identity, present employment, ownership, worksite, health purpose, admission and publication are not established.\n\nDrexel broad root checks are search coverage, not a health-project census. Villanova external code resources have their own classification. Reported links and related copies do not establish native repository identity or validate redirects. No source network requests or supplied scripts were executed by this integration.\n`;
for (const [path,body] of [[`${dir}/research-network.json`,JSON.stringify(network,null,2)+'\n'],[`${dir}/qualification-queue.json`,JSON.stringify(queue,null,2)+'\n'],[`${dir}/research-network.md`,report],['docs/discovery/go-live/execution/GL05-expansion-integration.md',integration]]) {if(args[0]==='--check') {if(await readFile(path,'utf8')!==body)throw Error(`Stale: ${path}`);} else await writeFile(path,body);}
console.log(JSON.stringify(counts));
