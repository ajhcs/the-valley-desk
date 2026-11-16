import {writeFile} from 'node:fs/promises';
import {constructDiscoveryEndpoint} from '../../../src/ingest/discovery/endpoint.ts';
const fields='DOI,title,type,author,published,URL,publisher,relation,license';
const works=[['gaston','10.1038/s41592-024-02503-3'],['sleepboost','10.1007/s11517-024-03096-x'],['openpbta','10.1016/j.xgen.2023.100340'],['thread-preprint','10.1101/2020.01.15.908459']];
const requests=[];
for(const[name,doiLiteral]of works){
 const scopeInput={declaredId:'scope:crossref-county-expansion-'+name,revision:1,queryKind:'fixed-doi',doiLiteral};
 const template={id:'endpoint:crossref-county-expansion-'+name,origin:'https://api.crossref.org',path:'/v1/works',fixed:{filter:'doi:'+doiLiteral,select:fields,rows:'1'},parameters:{},required:[]};
 requests.push({name,provider:'crossref',scopeInput,template,url:await constructDiscoveryEndpoint(template,[]),doiCanonical:doiLiteral.toLowerCase(),sourceKind:'provider-selected-factual-metadata',maxBytes:48000,candidateOnly:name==='thread-preprint'});
}
for(const[name,alias,id,ownerId,ownerType]of [['gaston','raphael-group/GASTON',692249664,5168500,'Organization'],['sleepboost','akibzaman/SleepBoost',617168725,55422467,'User'],['openpbta','AlexsLemonade/OpenPBTA-analysis',192607622,29661525,'Organization'],['thread-preprint','mathiesonlab/thread',218530629,54542479,'Organization']])requests.push({name,provider:'github',url:'https://api.github.com/repos/'+alias,alias,id,ownerId,ownerType,sourceKind:'public-repository-metadata-with-explicit-owner-type',maxBytes:48000,candidateOnly:name==='thread-preprint'});
await writeFile('.discovery-work/county-expansion/root/requests.json',JSON.stringify({purpose:'EX31 bounded factual county-diversity qualification; no enrollment, clinical/current-location claim or benchmark labels. Thread preprint remains conditional on exact native affiliations.',nativeRequestBudget:8,requests},null,2)+'\n');
console.log(JSON.stringify({requests:requests.length,nativeRequestBudget:8}));
