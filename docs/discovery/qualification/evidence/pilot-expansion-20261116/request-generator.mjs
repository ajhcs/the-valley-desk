import {writeFile} from 'node:fs/promises';
import {constructDiscoveryEndpoint} from '../../../src/ingest/discovery/endpoint.ts';
const fields='DOI,title,type,author,published,URL,publisher,relation,license';
const works=[['aslprep','10.1038/s41592-022-01458-7'],['gandlf','10.1038/s44172-023-00066-3'],['historeg','10.3390/app11041892'],['modelarray','10.1016/j.neuroimage.2023.120037']];
const requests=[];
for(const[name,doiLiteral]of works){
 const scopeInput={declaredId:'scope:crossref-pilot-expansion-'+name,revision:1,queryKind:'fixed-doi',doiLiteral};
 const template={id:'endpoint:crossref-pilot-expansion-'+name,origin:'https://api.crossref.org',path:'/v1/works',fixed:{filter:'doi:'+doiLiteral,select:fields,rows:'1'},parameters:{},required:[]};
 requests.push({name,provider:'crossref',scopeInput,template,url:await constructDiscoveryEndpoint(template,[]),doiCanonical:doiLiteral.toLowerCase(),sourceKind:'provider-selected-factual-metadata',maxBytes:48000});
}
for(const[name,alias,id,ownerId]of [['aslprep','PennLINC/aslprep',256420694,61955309],['gandlf','mlcommons/GaNDLF',342691278,67760141],['historeg','CBICA/HistoReg',163997867,35823615],['modelarray','PennLINC/ModelArray',390797198,61955309]])requests.push({name,provider:'github',url:'https://api.github.com/repos/'+alias,alias,id,ownerId,sourceKind:'public-organization-repository-metadata',maxBytes:48000});
await writeFile('.discovery-work/pilot-expansion/root/requests.json',JSON.stringify({purpose:'EX30 bounded user-authorized factual pilot expansion; no production/source activation or benchmark labels.',nativeRequestBudget:8,requests},null,2)+'\n');
console.log(JSON.stringify({requests:requests.length,nativeRequestBudget:8}));
