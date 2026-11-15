import {mkdir,writeFile} from 'node:fs/promises';
import {constructDiscoveryEndpoint} from '/workspace/worktrees/builderbob/thevalleydesk/tvd-discovery-implementation-20261113/src/ingest/discovery/endpoint.ts';
const root='.discovery-work/source-qualification/crossref-expansion/root';
await mkdir(root,{recursive:true});
const fields='DOI,title,type,author,published,URL,publisher,relation,license';
const works=[['qsiprep','10.1038/s41592-021-01185-5'],['captk-main','10.1117/1.JMI.5.1.011018'],['autogvp','10.1093/bioinformatics/btae114'],['immunotar','10.1093/bioinformatics/btaf060'],['phenomantics','10.1186/1471-2105-15-248'],['deepcnv','10.1093/bib/bbaa381']];
const requests=[];
for(const [name,doiLiteral] of works){
 const scopeInput={declaredId:'scope:crossref-fixed-'+name,revision:1,queryKind:'fixed-doi',doiLiteral};
 const template={id:'endpoint:crossref-fixed-'+name,origin:'https://api.crossref.org',path:'/v1/works',fixed:{filter:'doi:'+doiLiteral,select:fields,rows:'1'},parameters:{},required:[]};
 requests.push({name,provider:'crossref',scopeInput,template,url:await constructDiscoveryEndpoint(template,[]),doiCanonical:doiLiteral.toLowerCase(),sourceKind:'provider-selected-factual-metadata',maxBytes:48000});
}
const repos=[['autogvp','diskin-lab-chop/AutoGVP',525946788,53345105],['immunotar','sacanlab/immunotar',734388793,18205643],['phenomantics','chop-dbhi/phenomantics',15715626,709892],['deepcnv','CAG-CNV/DeepCNV',285885136,31705609]];
for(const [name,alias,id,ownerId] of repos)requests.push({name,provider:'github',url:'https://api.github.com/repos/'+alias,alias,id,ownerId,sourceKind:'public-organization-repository-metadata',maxBytes:48000});
await writeFile(root+'/requests.json',JSON.stringify({purpose:'Bounded user-authorized factual source investigation; no production/source authority or corpus labels.',crossrefScopeQualification:'pending code verification; URLs constructed by unchanged reviewed endpoint constructor',requests},null,2)+'\n');
console.log(JSON.stringify({requests:requests.map(({name,provider,url})=>({name,provider,url})),directRequestBudget:10},null,2));
