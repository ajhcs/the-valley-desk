import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {RegionalInventory} from '../../src/ingest/regional-contracts.ts';
import {REGIONAL_CHANNELS} from '../../src/ingest/regional-contracts.ts';
import {regionalCoverageInputs,buildRegionalCoverageReport} from '../../src/ingest/regional-coverage.ts';
import {prepareRegionalSourceReadView,queryRegionalSourceReadView} from '../../src/ingest/regional-read-view.ts';
import {prepareRegionalDiscoveryView,queryRegionalDiscoveryView,queryRegionalDiscoveryRecord} from '../../src/ingest/regional-discovery-view.ts';
import {RegionalAgentResult} from '../../src/agents/regional-agent-contract.ts';
import {REGIONAL_TOOLS} from './regional-mcp-adapter.mjs';
// Explicit offline build. No fetch, source activation, accepted queue or public assets.
const [capturesPath,publicationPath,asOf,output]=process.argv.slice(2);
if(!capturesPath||!publicationPath||!asOf||!output||process.argv.length!==6)throw new Error('Supply retained captures, publication projection, explicit ISO time and new output path.');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const fixture=path=>new URL('../../fixtures/'+path,import.meta.url);
const inventory=RegionalInventory.parse(await read(fixture('regional-source-inventory-v1.json'))),coverage=await read(fixture('coverage-pack-v1.json')),official=await read(fixture('official-source-registry-v1.json'));
const captures=await read(capturesPath),publicationSnapshot=await read(publicationPath);
const inputs=regionalCoverageInputs(inventory,coverage.institutions,official.sources,coverage.sources);
const view=await prepareRegionalSourceReadView({inventory,existingInstitutions:coverage.institutions,existingOfficialSources:official.sources,existingLeadershipSources:coverage.sources,asOf});
const inventoryResult=RegionalAgentResult.parse(queryRegionalSourceReadView(view,{limit:50},asOf));
if(inventoryResult.nextCursor)throw new Error('Inventory exceeds finite bundled scope.');
const discovery=await prepareRegionalDiscoveryView({inventory,captures,publicationSnapshot,asOf});
const pages=[];let cursor;
do{const page=queryRegionalDiscoveryView(discovery,{limit:10,...(cursor?{cursor}:{})},asOf);pages.push(page);cursor=page.nextCursor;}while(cursor);
const records=pages.flatMap(page=>page.results).map(row=>queryRegionalDiscoveryRecord(discovery,{snapshotId:discovery.snapshotId,recordId:row.recordId,authorLimit:20},asOf));
for(const row of records)row.record.provenance.limitations.push('Retained representation checks occurred offline at build time; this Worker read performs no upstream byte verification.');
const report=buildRegionalCoverageReport({...inputs,asOf});
const data={schemaVersion:1,preparedAt:asOf,provenancePolicy:'Offline accepted reader verified retained representations at build time; runtime does not re-fetch or verify upstream wire bytes. PubMed original XML unavailable; declaration only. Dates remain historical. No live source-health receipts supplied.',
 tools:REGIONAL_TOOLS.map(({securitySchemes,_meta,...tool})=>tool),inventoryResult,inventoryInstitutionIds:inputs.institutions.map(row=>row.id),
 inventoryGaps:report.missingChannels,discoveryInstitutionIds:inventory.institutions.map(row=>row.id),discoveryBase:{...pages[0],results:[],nextCursor:null},records};
if(REGIONAL_CHANNELS.length!==5||records.length!==28||inventoryResult.results.length!==49)throw new Error('Unexpected retained candidate scope.');
const serialized=JSON.stringify(data);
if(serialized.includes('@'))throw new Error('Contact-bearing content cannot enter the server snapshot.');
const result={manifestSha256:createHash('sha256').update(serialized,'utf8').digest('hex'),data};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({records:records.length,sources:inventoryResult.results.length,manifestSha256:result.manifestSha256,sourceRequests:0,healthReceipts:0}));
