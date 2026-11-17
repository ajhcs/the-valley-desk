import {readFileSync,writeFileSync} from 'node:fs';
import {DirectoryAcquisitionStore} from '../../../scripts/discovery-directory-acquire.mjs';
const root='/workspace/build/builderbob/tvd-gl03-20261116/root';
const receipts=[...['G01','G02','G03','C01','G04'].map(id=>root+'/batch/'+id+'.json'),...['G05','C02'].map(id=>root+'/supplemental/'+id+'.json')].map(p=>JSON.parse(readFileSync(p,'utf8')).receipt);
const start=Math.min(...receipts.map(r=>Date.parse(r.issuedAt))),end=Math.max(...receipts.map(r=>Date.parse(r.completedAt))),durationMs=end-start;
const original=JSON.parse(readFileSync(root+'/batch/plan.json','utf8')),supplemental=JSON.parse(readFileSync(root+'/supplemental/plan.json','utf8'));
const store=new DirectoryAcquisitionStore(root+'/batch/journal',original);
try{for(const county of ['Camden','Mercer','Philadelphia'])store.recordActivity('GL03:collection-window:'+county,county,durationMs);}finally{store.close();}
const countyCharges=Object.fromEntries(['Camden','Mercer','Philadelphia'].map(county=>[county,durationMs+original.pages.filter(p=>p.county===county).reduce((n,p)=>n+p.timeoutMs,0)+supplemental.pages.filter(p=>p.county===county).reduce((n,p)=>n+p.timeoutMs,0)]));
const total=3*durationMs+receipts.length*25000;
if(total>16200000||Object.values(countyCharges).some(n=>n>1800000))throw Error('actual-collection-window-over-budget');
const result={basis:'Conservative upper bound: entire wall window from first issue to last native response charged as manual collection time to EACH explored county, in addition to full request allowances. Includes interleaved method engineering. Post-capture verification/release engineering is separate; no more source exploration occurs.',start:new Date(start).toISOString(),end:new Date(end).toISOString(),manualMsPerCounty:durationMs,requestAllowanceMs:175000,totalChargedMs:total,countyChargedMs:countyCharges,totalCeilingMs:16200000,countyCeilingMs:1800000,allWithinCeilings:true,reportedActivityJournal:root+'/batch/journal/frontier.sqlite',newNativeRequests:0};
writeFileSync(root+'/activity-budget.json',JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
