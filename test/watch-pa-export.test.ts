import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { records, syntheticXml, syntheticZip } from './fixtures/pa-export/synthetic';
import { derivePaExport, parsePennsylvaniaExportPolicy, normalizeWatchRepresentation, paSnapshotFreshness, assertPaExportProgress } from '../src/ingest/watch/pennsylvania-export';
import { parsePennsylvaniaExportSnapshot } from '../src/ingest/watch/pennsylvania-export-adapter';
import { materializePolicyCapture } from '../src/ingest/policy-watch-native';
import { canonicalJson, sha256 } from '../src/content/watch-schema';
import { collectionReadiness, sourceConfigurationDigest } from '../src/ingest/watch/source-enrollment';
import { prepareCapturedSource } from '../scripts/lib/watch-source-preparation';
import { qualifyCapturedWatchSource } from '../scripts/lib/watch-source-qualification';
const source=launchCandidate('candidate-pa-export').source, at='2026-09-30T20:00:00.000Z';
const context={sourceId:source.id,sourceUrl:source.endpoints[0],sourceLabel:source.name,retrievedAt:at};

test('historical selected records retain exact lexical hashes and field provenance through synthetic ZIP',async()=>{
  const receipt=JSON.parse(readFileSync(new URL('./fixtures/pa-export/receipt.json',import.meta.url),'utf8'));
  const bytes=syntheticZip(), derived=await derivePaExport(source,bytes);
  assert.equal(derived.receipt.completeCoverage,false);assert.equal(derived.records.length,4);
  for(const record of derived.records){
    assert.equal(record.documentSha256,receipt.records.find((r:any)=>r.bill===record.bill).sha256);
    for(const field of record.fields) assert.equal(field.valueSha256,await sha256(canonicalJson(record.document[field.field as keyof typeof record.document])));
    assert.ok(record.fields.every(field=>field.xmlPath.includes(record.document.id)));
  }
  const hb=derived.records.find(r=>r.bill==='HB1925')!;
  assert.deepEqual(hb.document.versions.map(v=>v.pn),['3963','3349','2403']);assert.equal(hb.document.versions[0].textDate,null);
  assert.equal(hb.lastUpdate.instant,'2026-09-30T19:05:00.000Z');assert.equal(derived.receipt.exportDate.instant,'2026-09-30T19:30:06.000Z');
  assert.equal(hb.document.actions.at(-1)!.text,'Re-reported as committed, Sept. 30, 2026');
  assert.equal(hb.document.actions.at(-1)!.date,'2026-09-30');
  const prepared=await prepareCapturedSource(source.id,bytes,at);
  assert.equal(prepared.parsed?.health.state,'healthy');assert.equal(prepared.activationAuthorized,false);
  assert.equal(prepared.parsed?.health.complete,false);assert.equal(prepared.parsed?.observations.length,4);
  assert.equal((await collectionReadiness(source,{now:at,activeSourceIds:new Set(),receipts:new Map()})).ready,false);
});

test('changing export and lastUpdate receipts do not duplicate semantic native facts',async()=>{
  const first=await derivePaExport(source,syntheticZip());
  const second=await derivePaExport(source,syntheticZip(syntheticXml(records.join('\n').replace('3:05:00 PM EDT','4:05:00 PM EDT'),'September 30, 2026 4:30:06 PM EDT')));
  assert.notEqual(first.receipt.rawArchiveSha256,second.receipt.rawArchiveSha256);
  for(let index=0;index<4;index++){
    const a=await materializePolicyCapture(parsePennsylvaniaExportPolicy(first.records[index].document,context));
    const b=await materializePolicyCapture(parsePennsylvaniaExportPolicy(second.records[index].document,{...context,retrievedAt:'2026-09-30T21:00:00.000Z'}));
    assert.equal(a.observation.id,b.observation.id);assert.deepEqual(a.actions,b.actions);assert.deepEqual(a.summary,b.summary);
  }
  assert.doesNotThrow(()=>assertPaExportProgress(first.normalizedText,second.normalizedText));
  assert.throws(()=>assertPaExportProgress(second.normalizedText,first.normalizedText),/regression/);
  assert.notEqual(await sourceConfigurationDigest(source),await sourceConfigurationDigest({...source,paExport:{...source.paExport,selectedBills:['HB1925']}}));
});

for(const [name,mutate] of [
  ['DTD', (x:string)=>x.replace('<historyExport','<!DOCTYPE historyExport><historyExport')],
  ['entity', (x:string)=>x.replace('An Act','&hostile; An Act')],
  ['HTML-only named entity', (x:string)=>x.replace('An Act','&nbsp; An Act')],
  ['duplicate record',(x:string)=>x.replace('</session>',records[0]+'</session>')],
  ['missing selected',(x:string)=>x.replace(records[1],'')],
  ['wrong session',(x:string)=>x.replace('<session year="2025"','<session year="2023"')],
  ['wrong bill identity',(x:string)=>x.replace('<number>1925</number>','<number>1926</number>')],
  ['wrong PN link',(x:string)=>x.replace('/HB1925/PN3963','/HB1926/PN3963')],
  ['wrong subtype',(x:string)=>x.replace('<subType>B</subType>','<subType>R</subType>')],
  ['duplicate PN',(x:string)=>x.replace('>3349</number>','>3963</number>')],
  ['duplicate scalar',(x:string)=>x.replace('<number>1925</number>','<number>1925</number><number>1925</number>')],
  ['invalid action date',(x:string)=>x.replace('09/30/26','09/31/26')],
  ['future bill clock',(x:string)=>x.replace('3:05:00 PM EDT','4:05:00 PM EDT')],
] as const) test(`XML rejects ${name}`,async()=>assert.rejects(derivePaExport(source,syntheticZip(mutate(syntheticXml())))));

for(const name of ['CRC','encryption','expanded oversize','entry count','local mismatch','truncated','wrong member','unsafe path','raw oversize'] as const)
 test(`ZIP rejects ${name}`,async()=>{
  let bytes=syntheticZip(),v=new DataView(bytes.buffer),central=v.getUint32(bytes.length-6,true);
  if(name==='CRC') bytes[100]^=1;
  if(name==='encryption'){v.setUint16(6,1,true);v.setUint16(central+8,1,true);}
  if(name==='expanded oversize'){v.setUint32(22,67108865,true);v.setUint32(central+24,67108865,true);}
  if(name==='entry count'){v.setUint16(bytes.length-14,101,true);v.setUint16(bytes.length-12,101,true);}
  if(name==='local mismatch')v.setUint16(8,8,true);
  if(name==='truncated')bytes=bytes.slice(0,-1);
  if(name==='wrong member')bytes=syntheticZip(syntheticXml(),'other.xml');
  if(name==='unsafe path')bytes=syntheticZip(syntheticXml(),'../unsafe.xml');
  if(name==='raw oversize')bytes=new Uint8Array(2000001);
  await assert.rejects(derivePaExport(source,bytes));
 });

test('binary denial, derivation tamper, later independent observation and Library freshness stay separate',async()=>{
  const bytes=syntheticZip(),body=await normalizeWatchRepresentation(source,bytes);
  const input={source,body,representationBytes:bytes,representationKind:'pa-zip-xml' as const,finalUrl:source.endpoints[0],fetchedAt:at};
  assert.equal((await parsePennsylvaniaExportSnapshot({...input,status:403})).health.state,'upstream-blocked');
  assert.equal((await parsePennsylvaniaExportSnapshot({...input,body:body+' '})).health.state,'parser-failed');
  const snapshot=await parsePennsylvaniaExportSnapshot(input);
  // Synthetic separate later event. No retained vote HTML; never source literal authority.
  const later={kind:'synthetic-test-only',at:'2026-09-30T19:45:00.000Z',action:'FINAL PASSAGE',chamber:'House',legalEffect:'unknown'};
  assert.ok(later.at>JSON.parse(body).exportDate.instant);
  assert.ok(snapshot.observations.every(o=>!canonicalJson(o.payload).includes('FINAL PASSAGE')));
  const freshness=paSnapshotFreshness({exportAt:'2026-09-30T19:30:06.000Z',lastCheckedAt:at,lastSuccessfulUpstreamCheckAt:at,currentFailure:'access-held',origin:'library-research'},at);
  assert.equal(freshness.lastSuccessfulUpstreamCheckAt,null);assert.equal(freshness.latestStatusVerified,false);assert.equal(freshness.currentFailure,'access-held');assert.ok(freshness.exportAgeMs>0);
});

test('single Library snapshot and unnamed or absent original receipts cannot qualify',async()=>{
  const bytes=syntheticZip(),sample={bytes,endpoint:source.endpoints[0],capturedAt:at};
  const approval={engineeringOwnerId:'synthetic-engineer',editorialOwnerId:'synthetic-editor',statement:'Synthetic test approval only; no actual source rights or production activation.',reviewedAt:'2026-09-30T21:00:00.000Z',expiresAt:'2026-10-01T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read'};
  await assert.rejects(qualifyCapturedWatchSource(source,[sample],approval),/samples/);
  await assert.rejects(qualifyCapturedWatchSource(source,[sample,{...sample,capturedAt:'2026-09-30T20:05:00.000Z'}],approval),/named-receipts/);
  await assert.rejects(qualifyCapturedWatchSource(source,[sample,{...sample,capturedAt:'2026-09-30T20:05:00.000Z'}],{...approval,receipts:{engineering:'synthetic-eng',editorial:'synthetic-ed',rights:'synthetic-rights',access:'synthetic-access'}}));
});

for(const [name,mutate] of [
  ['nested number (independent review trigger)',(x:string)=>x.replace('<number>1925</number>','<number>1925<unexpected>1926</unexpected></number>')],
  ['nested title (independent review trigger)',(x:string)=>x.replace('</shortTitle>','<unexpected>hidden title</unexpected></shortTitle>')],
  ['nested type with legitimate description',(x:string)=>x.replace('>B</type>','>B<unexpected>S</unexpected></type>')],
  ['nested PN',(x:string)=>x.replace('>3963</number>','>3963<unexpected>3349</unexpected></number>')],
  ['nested action text',(x:string)=>x.replace('</fullAction>','<unexpected>FINAL PASSAGE</unexpected></fullAction>')],
  ['unexpected scalar attribute',(x:string)=>x.replace('<number>1925','<number unexpected="1926">1925')],
  ['unexpected type attribute',(x:string)=>x.replace('description="House Bill"','description="House Bill" unexpected="S"')],
  ['unexpected PN attribute',(x:string)=>x.replace('<number sequence="01"','<number unexpected="yes" sequence="01"')],
  ['partial numeric identity',(x:string)=>x.replace('<number>1925</number>','<number>1925garbage</number>')],
  ['partial numeric sequence',(x:string)=>x.replace('sequence="01"','sequence="1tail"')],
  ['coerced exponential sequence',(x:string)=>x.replace('sequence="01"','sequence="1e0"')],
  ['duplicate title',(x:string)=>x.replace('</shortTitle>','</shortTitle><shortTitle>different</shortTitle>')],
  ['CDATA outside observed profile',(x:string)=>x.replace('An Act','<![CDATA[An Act]]>')],
] as const) test(`strict XML scalar rejects ${name}`,async()=>{
  const bytes=syntheticZip(mutate(syntheticXml()));
  await assert.rejects(derivePaExport(source,bytes));
  const result=await parsePennsylvaniaExportSnapshot({source,body:'',representationBytes:bytes,representationKind:'pa-zip-xml',finalUrl:source.endpoints[0],fetchedAt:at});
  assert.equal(result.health.state,'parser-failed');assert.equal(result.observations.length,0);
});

test('legitimate type/PN attributes and escaped literal scalar text retain complete meaning',async()=>{
  const xml=syntheticXml().replace('An Act amending Titles','An Act &amp; &#x28;literal&#x29; &lt;text&gt; amending Titles');
  const result=await derivePaExport(source,syntheticZip(xml));
  const hb=result.records.find(record=>record.bill==='HB1925')!;
  assert.ok(hb.document.shortTitle.startsWith('An Act & (literal) <text> amending Titles'));
  assert.equal(hb.document.type,'B');assert.deepEqual(hb.document.versions.map(v=>v.sequence),[1,2,3]);
  assert.equal(hb.document.versions[0].textUrl,'https://www.palegis.us/legislation/bills/text/PDF/2025/0/HB1925/PN3963');
});

const syntheticApproval={engineeringOwnerId:'synthetic-engineer',editorialOwnerId:'synthetic-editor',statement:'Fabricated original-capture and named approval receipts for offline tests only; not actual rights or source authenticity.',reviewedAt:'2026-09-30T21:00:00.000Z',expiresAt:'2026-10-01T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read',receipts:{engineering:'synthetic-eng',editorial:'synthetic-ed',rights:'synthetic-rights',access:'synthetic-access'}};
async function qualificationPair(secondXml:string){
  return Promise.all([syntheticZip(),syntheticZip(secondXml)].map(async(bytes,index)=>{
    const capturedAt=index?'2026-09-30T20:05:00.000Z':at;
    return {bytes,endpoint:source.endpoints[0],capturedAt,upstreamReceipt:{id:`synthetic-original-${index}`,origin:'upstream-original',endpoint:source.endpoints[0],capturedAt,representationSha256:await sha256(bytes),httpStatus:200,accessReceiptId:'synthetic-access'}};
  }));
}
for(const [name,xml,error] of [
  ['changed title with unchanged bill lastUpdate',syntheticXml(records.join('\n').replace('An Act amending Titles','A changed Act amending Titles'),'September 30, 2026 3:35:06 PM EDT'),/bill-clock-or-content-conflict/],
  ['regressed bill lastUpdate with advancing export',syntheticXml(records.join('\n').replace('3:05:00 PM EDT','3:04:00 PM EDT'),'September 30, 2026 3:35:06 PM EDT'),/bill-clock-or-content-conflict/],
  ['regressed export clock',syntheticXml(records.join('\n'),'September 30, 2026 3:29:06 PM EDT'),/clock-regression/],
  ['relabelled identical snapshot',syntheticXml(),/distinct-coherent-original-captures-required/],
] as const) test(`qualification rejects ${name} before granting source qualification`,async()=>{
  await assert.rejects(qualifyCapturedWatchSource(source,await qualificationPair(xml),syntheticApproval),error);
});

test('qualification accepts coherent unchanged content or evolving bill content with monotonic source clocks',async()=>{
  for(const body of [records.join('\n'),records.join('\n').replace('An Act amending Titles','A changed Act amending Titles').replace('3:05:00 PM EDT','3:10:00 PM EDT')]){
    const result=await qualifyCapturedWatchSource(source,await qualificationPair(syntheticXml(body,'September 30, 2026 3:35:06 PM EDT')),syntheticApproval);
    assert.equal(result.source.state,'qualified');assert.equal(result.publicationAuthorized,false);
    assert.equal(result.evidence.captureReceipts?.length,2);
  }
});

test('qualification rejects repeated captures, declared Library origin and invalid named receipts',async()=>{
  const samples=await qualificationPair(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT'));
  await assert.rejects(qualifyCapturedWatchSource(source,[samples[0],samples[0]],syntheticApproval),/distinct-coherent-original-captures-required/);
  await assert.rejects(qualifyCapturedWatchSource(source,samples.map(s=>({...s,upstreamReceipt:{...s.upstreamReceipt,origin:'library-research'}})),syntheticApproval));
  await assert.rejects(qualifyCapturedWatchSource(source,samples,{...syntheticApproval,receipts:{...syntheticApproval.receipts,rights:'synthetic-access'}}),/named-receipts-required/);
  await assert.rejects(qualifyCapturedWatchSource(source,samples,{...syntheticApproval,rightsDecision:'pending'}));
  await assert.rejects(qualifyCapturedWatchSource(source,samples.map(s=>({...s,upstreamReceipt:{...s.upstreamReceipt,accessReceiptId:'wrong-access'}})),syntheticApproval),/original-capture-binding/);
});
