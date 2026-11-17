import {readFileSync,writeFileSync,mkdirSync,copyFileSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical,DirectoryAcquisitionPlanSchema} from '../../../src/ingest/discovery/directory-acquisition.ts';
const sha=v=>createHash('sha256').update(v).digest('hex');
const folder='/workspace/build/builderbob/tvd-gl03-20261116/root/supplemental';mkdirSync(folder,{recursive:true,mode:0o700});chmodSync(folder,0o700);mkdirSync(folder+'/journal',{mode:0o700});
const manifestPath='docs/discovery/go-live/execution/GL03-supplemental-request-manifest.json',preflight='docs/discovery/go-live/execution/GL03-supplemental-preflight.md';
for(const [from,to]of [[manifestPath,'request-manifest.json'],[preflight,'preflight.md']]){copyFileSync(from,folder+'/'+to);chmodSync(folder+'/'+to,0o600);}
const methods=Object.fromEntries(['scripts/discovery-directory-capture.py','scripts/discovery-directory-journal.mjs','scripts/discovery-directory-inspect.mjs','scripts/discovery-directory-acquire.mjs','src/ingest/discovery/directory-acquisition.ts','src/ingest/discovery/directory-frontier.ts','src/ingest/discovery/metadata-preflight.ts','src/ingest/regional-privacy.ts','src/ingest/discovery/collection-contract.ts','package.json','package-lock.json','src/content/discovery-directory.ts','src/content/discovery-schema.ts',manifestPath,preflight].map(p=>[p,sha(readFileSync(p))]));
const m=JSON.parse(readFileSync(folder+'/request-manifest.json','utf8'));
for(const r of m.prior_receipts){if(sha(readFileSync(r.path))!==r.sha256)throw Error('prior-receipt-mismatch');methods[r.path]=r.sha256;}
for(const name of ['plan.json','methods.json','replay-result.json']){const p='/workspace/build/builderbob/tvd-gl03-20261116/root/batch/'+name;methods[p]=sha(readFileSync(p));}
const approvedScopeSha256=sha(canonical(methods));
const counties={G05:'Camden',C02:'Camden'};
const plan=DirectoryAcquisitionPlanSchema.parse({schemaVersion:'directory-acquisition-plan-v1',id:'GL03:supplemental:20261116',gl02ManifestSha256:sha(readFileSync('docs/discovery/go-live/execution/GL02-exploration-manifest.json')),approvedScopeSha256,limits:{totalRequests:2,perProviderRequests:1,queue:2,perCountyLeads:2,totalLeads:2,concurrentAttempts:1,resultsPerPage:1,activeMsTotal:16075000,activeMsPerCounty:1750000},pages:m.requests.map(d=>{
 const request={method:d.method,url:d.url,accept:m.headers[d.provider].Accept,encoding:'identity',userAgent:m.headers[d.provider]['User-Agent'],githubApiVersion:m.headers[d.provider]['X-GitHub-Api-Version']??null,maxBytes:48000,timeoutMs:25000,redirects:0};
 return{id:d.id,chainId:'GL03:'+d.id,page:1,parentPageId:null,provider:d.provider,route:d.kind.startsWith('account')?'account':d.kind==='publication_search'?'publication':d.kind==='fixed_repo'?'institution':'topic',county:counties[d.id],sourceId:'GL03:'+d.provider,scopeId:'GL03:'+d.id,installation:d.provider+'-public',qualificationSha256:approvedScopeSha256,parserRevision:'GL03:parser:2',parserSha256:methods['scripts/discovery-directory-inspect.mjs'],reason:'GL02 bounded '+d.kind+' route; exploration county is not geographic proof',...request,requestSha256:sha(canonical(request))};})});
for(const[name,data]of Object.entries({'plan.json':plan,'methods.json':methods}))writeFileSync(folder+'/'+name,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({folder,approvedScopeSha256,planSha256:sha(canonical(plan)),requests:plan.pages.map(p=>p.id)}));
