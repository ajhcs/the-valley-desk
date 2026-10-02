import { parseArgs } from 'node:util';
import { watchOutputDirectory } from './lib/watch-local-files.mjs';
import { assertLocalArguments, localOnly, retainPaLocalOriginal, verifyPaRetainedPacket, retainedSummary } from './lib/pa-retained-collector.mjs';
// No acquisition transport exists here. Refuse acquisition switches before I/O.
if(process.argv.slice(2).some(value=>/^(--(?:fetch|url|acquire)(?:=|$)|fetch$|acquire$)/.test(value)))throw Error('pa-retained-acquisition-disabled');
const {values}=parseArgs({options:Object.fromEntries(['mode','candidate','zip','receipt','acquisition','out','packet'].map(name=>[name,{type:'string'}]))});
if(!['retain','verify'].includes(values.mode))throw Error('pa-retained-acquisition-disabled');
let result;
if(values.mode==='retain'){
  assertLocalArguments(['zip','receipt','acquisition','out'].map(key=>values[key]));
  if(values.candidate!=='candidate-pa-export')throw Error('pa-retained-candidate-invalid');
  const out=watchOutputDirectory(values.out,undefined,true);
  result=await retainPaLocalOriginal({candidateId:values.candidate,zip:values.zip,receipt:values.receipt,acquisition:values.acquisition,out});
}else{
  localOnly(values.packet);watchOutputDirectory(values.packet,undefined,true);
  result=await verifyPaRetainedPacket(values.packet);
}
console.log(JSON.stringify(retainedSummary(result)));
