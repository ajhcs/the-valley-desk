import { readFile, writeFile } from 'node:fs/promises';
import { RegionalInventory } from '../src/ingest/regional-contracts.ts';
import { qualifyPublicationScope, createPublicationDiscoveryTransport } from '../src/ingest/regional-publications.ts';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--captures','--start','--end','--out'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('Usage: --captures local-captures.json --start YYYY-MM-DD --end YYYY-MM-DD --out local-review.json');options[args[i]]=args[i+1];}
if(Object.keys(options).length!==4)throw new Error('All four explicit local qualification options required.');
const inventory=RegionalInventory.parse(JSON.parse(await readFile(new URL('../fixtures/regional-source-inventory-v1.json',import.meta.url),'utf8')));
const captures=Object.values(JSON.parse(await readFile(options['--captures'],'utf8'))),retained=new Map();
for(const citation of inventory.evidence){const row=captures.find(row=>row.url===citation.url&&row.observedAt===citation.observedAt);if(row)retained.set(citation.id,{url:row.url,observedAt:row.observedAt,body:citation.representation==='normalized-text'?row.text:row.body});}
const scope=await qualifyPublicationScope(inventory,retained);
const result=await createPublicationDiscoveryTransport({fetch})(scope,{institutionId:'inst-regional-wistar',startDay:options['--start'],endDay:options['--end'],limit:5});
await writeFile(options['--out'],JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:result.state??'metadata-staged-for-review',records:result.records.length,requests:result.receipts.length,source:'pubmed',currentEmploymentConfirmed:false,productionCollectorActivated:false}));
