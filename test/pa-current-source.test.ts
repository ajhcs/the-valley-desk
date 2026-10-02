import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { launchCandidate } from '../fixtures/watch-launch-candidates';
import { syntheticZip, syntheticXml, records } from './fixtures/pa-export/synthetic';
import { importPaOriginal } from '../scripts/lib/pa-original-import';
import { qualifyCapturedWatchSource } from '../scripts/lib/watch-source-qualification';
import { sha256, canonicalJson } from '../src/content/watch-schema';
import { paSnapshotFreshness } from '../src/content/pa-source-freshness';
import { PaSourceHealth } from '../src/ui/watch/WatchShared';
import { reconstructOriginal } from '../scripts/lib/pa-fixture-transport.mjs';
const source=launchCandidate('candidate-pa-export').source;
const policy={weekdayMaxAgeMs:7200000,weekendMaxAgeMs:259200000,reviewMaxAgeMs:7200000,evidenceReceiptId:'synthetic-policy-review'};
async function syntheticAcquisition(bytes:Uint8Array,index=0){
  const completedAt=index?'2026-09-30T20:05:00.000Z':'2026-09-30T20:00:00.000Z';
  const startedAt=index?'2026-09-30T20:04:59.000Z':'2026-09-30T19:59:59.000Z';
  const hash=await sha256(bytes);
  const receiptBytes=new TextEncoder().encode(JSON.stringify({publisher:'Pennsylvania General Assembly',session_label:'2025-2026 Regular Session',requested_download_url_observed:source.endpoints[0],download_started_at_utc:startedAt,download_completed_at_utc:completedAt,download_success:true,size_bytes:bytes.length,sha256:hash,http_status:null,response_headers:null,final_download_response_url:null,download_redirect_chain:null}));
  const acquisition={schemaVersion:'pa-browser-original-1',origin:'browser-original',publisher:'Pennsylvania General Assembly',session:'2025_0',requestedUrl:source.endpoints[0],finalResponseUrl:null,startedAt,completedAt,downloadSucceeded:true,tool:'SYNTHETIC browser test only',toolSession:'synthetic-session',downloadObservation:`synthetic-download-${index}`,representationSha256:hash,representationBytes:bytes.length,downloadReceiptSha256:await sha256(receiptBytes),downloadReceiptBytes:receiptBytes.length,httpStatus:null,responseHeaders:null,redirectChain:null};
  return {acquisition,receiptBytes};
}
test('review-only original import preserves unknown HTTP metadata and derives clocks/facts from bytes',async()=>{
  const bytes=syntheticZip(),{acquisition,receiptBytes}=await syntheticAcquisition(bytes);
  const result=await importPaOriginal(source.id,bytes,acquisition,receiptBytes);
  assert.equal(result.acquisition.httpStatus,null);assert.equal(result.acquisition.finalResponseUrl,null);
  assert.equal(result.derivation.exportDate.instant,'2026-09-30T19:30:06.000Z');
  assert.equal(result.successfulUpstreamCheckRenewed,false);assert.equal(result.publicationAuthorized,false);
  assert.ok(result.captures.every(capture=>capture.historyComplete===false));
  assert.ok(result.captures.every(capture=>!canonicalJson(capture).includes('144-59')));
  for(const change of [{httpStatus:200},{finalResponseUrl:source.endpoints[0]},{requestedUrl:'https://example.invalid/export'},{representationBytes:bytes.length+1},{downloadReceiptSha256:'0'.repeat(64)}]){
    await assert.rejects(importPaOriginal(source.id,bytes,{...acquisition,...change},receiptBytes));
  }
  await assert.rejects(importPaOriginal(source.id,bytes,{...acquisition,exportAt:'2026-10-01T20:30:06.000Z'},receiptBytes));
  await assert.rejects(importPaOriginal(source.id,bytes,acquisition,new Uint8Array(receiptBytes.length)));
});
test('legacy required shape takes precedence over unknown format metadata without rewriting receipt bytes',async t=>{
  const bytes=syntheticZip(),{acquisition,receiptBytes}=await syntheticAcquisition(bytes);
  const legacy=JSON.parse(new TextDecoder().decode(receiptBytes));
  for(const metadata of [{result:'success'},{result:'legacy-observation'},{schema_version:1},{schema_version:'legacy-version'},
    {result:'failure',schema_version:99,source:{page_url:'https://example.invalid'},xml_validation:{export_date_utc:'2099-01-01T00:00:00Z'}}])
    await t.test(JSON.stringify(metadata),async()=>{
      const original=new TextEncoder().encode(' \n'+JSON.stringify({...legacy,...metadata},null,2)+'\n');
      const before=new Uint8Array(original),bound={...acquisition,downloadReceiptBytes:original.length,downloadReceiptSha256:await sha256(original)};
      const imported=await importPaOriginal(source.id,bytes,bound,original);
      assert.deepEqual(original,before);assert.equal(await sha256(original),bound.downloadReceiptSha256);
      assert.deepEqual(imported.acquisition,bound);assert.equal(imported.derivation.exportDate.instant,'2026-09-30T19:30:06.000Z');
      assert.equal(imported.publicationAuthorized,false);assert.equal(imported.activationAuthorized,false);assert.equal(imported.successfulUpstreamCheckRenewed,false);
      const rewritten=new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(original))));
      await assert.rejects(importPaOriginal(source.id,bytes,bound,rewritten));
      await assert.rejects(importPaOriginal(source.id,bytes,{...bound,httpStatus:200},original));
    });
});
test('known nested session-link receipt binds unchanged bytes and rejects conflicting observations',async t=>{
  const bytes=syntheticZip(),{acquisition}=await syntheticAcquisition(bytes);
  const receipt={schema_version:1,result:'success',
    source:{page_url:'https://www.palegis.us/data',offered_href:'/data/file?documentType=BillHistoryData&session=2025_0',offered_resolved_url:source.endpoints[0]},
    acquisition:{click_started_observed_utc:acquisition.startedAt,download_completed_observed_utc:acquisition.completedAt,attempts:1,denial_or_captcha_observed:false},
    transport:{http_status:null,response_headers:null,response_final_url:null},
    original_archive:{byte_count:bytes.length,sha256:acquisition.representationSha256},
    environment:{browser:'SYNTHETIC browser',method:'SYNTHETIC official session-link click'},
    xml_validation:{export_date_utc:'2099-01-01T00:00:00Z'},pn:'invented',actions:['invented'],
  };
  const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
  const receiptBytes=encode(receipt),bound={...acquisition,downloadReceiptBytes:receiptBytes.length,downloadReceiptSha256:await sha256(receiptBytes)};
  const result=await importPaOriginal(source.id,bytes,bound,receiptBytes);
  assert.deepEqual(result.acquisition,bound);assert.equal(result.acquisition.httpStatus,null);assert.equal(result.acquisition.redirectChain,null);
  assert.equal(result.derivation.exportDate.instant,'2026-09-30T19:30:06.000Z');
  assert.equal(result.successfulUpstreamCheckRenewed,false);assert.equal(result.publicationAuthorized,false);assert.equal(result.activationAuthorized,false);
  assert.ok(!canonicalJson(result.captures).includes('invented'));
  await assert.rejects(importPaOriginal(source.id,bytes,bound,encode(receipt).subarray(0,receiptBytes.length-1)));
  const changes:[string,(r:any)=>void][]=[
    ['unknown schema',r=>r.schema_version=2],['malformed shape',r=>delete r.environment],['failure',r=>r.result='failure'],
    ['page URL',r=>r.source.page_url='https://example.invalid/data'],['href',r=>r.source.offered_href+='#shortcut'],
    ['endpoint',r=>r.source.offered_resolved_url='https://example.invalid/export'],
    ['invalid timestamp',r=>r.acquisition.click_started_observed_utc='bad'],
    ['start mismatch',r=>r.acquisition.click_started_observed_utc='2026-09-30T19:59:58.000Z'],
    ['completion mismatch',r=>r.acquisition.download_completed_observed_utc='2026-09-30T20:00:01.000Z'],
    ['denial',r=>r.acquisition.denial_or_captcha_observed=true],['attempts',r=>r.acquisition.attempts=2],
    ['hash',r=>r.original_archive.sha256='0'.repeat(64)],['invalid hash',r=>r.original_archive.sha256='bad'],
    ['size',r=>r.original_archive.byte_count++],['status',r=>r.transport.http_status=200],
    ['invalid status',r=>r.transport.http_status=999],['headers',r=>r.transport.response_headers={etag:'fabricated'}],
    ['final URL',r=>r.transport.response_final_url=source.endpoints[0]],['redirect observation',r=>r.transport.redirect_chain=[]],
  ];
  for(const [name,change] of changes)await t.test(name,async()=>{
    const altered=structuredClone(receipt);change(altered);const alteredBytes=encode(altered);
    await assert.rejects(importPaOriginal(source.id,bytes,{...bound,downloadReceiptBytes:alteredBytes.length,downloadReceiptSha256:await sha256(alteredBytes)},alteredBytes));
  });
  for(const change of [{httpStatus:200},{responseHeaders:{etag:'fabricated'}},{finalResponseUrl:source.endpoints[0]},{redirectChain:[]},
    {startedAt:'2026-09-30T20:00:01.000Z'},{completedAt:'2026-09-30T19:59:58.000Z'}])
    await assert.rejects(importPaOriginal(source.id,bytes,{...bound,...change},receiptBytes));
  const observed=structuredClone(receipt) as any;observed.transport={http_status:200,response_headers:{etag:'synthetic'},response_final_url:source.endpoints[0]};
  const observedBytes=encode(observed),observedEnvelope={...bound,httpStatus:200,responseHeaders:{etag:'synthetic'},finalResponseUrl:source.endpoints[0],downloadReceiptBytes:observedBytes.length,downloadReceiptSha256:await sha256(observedBytes)};
  await importPaOriginal(source.id,bytes,observedEnvelope,observedBytes);
  observed.transport.http_status=403;const deniedBytes=encode(observed);
  await assert.rejects(importPaOriginal(source.id,bytes,{...observedEnvelope,httpStatus:403,downloadReceiptBytes:deniedBytes.length,downloadReceiptSha256:await sha256(deniedBytes)},deniedBytes));
});
test('browser download qualification requires distinct named provenance/access review and reviewed export-age policy',async()=>{
  const samples=await Promise.all([syntheticZip(),syntheticZip(syntheticXml(records.join('\n'),'September 30, 2026 3:35:06 PM EDT'))].map(async(bytes,index)=>{
    const {acquisition,receiptBytes}=await syntheticAcquisition(bytes,index);
    return {endpoint:source.endpoints[0],capturedAt:acquisition.completedAt,bytes,upstreamReceipt:acquisition,downloadReceiptBytes:receiptBytes};
  }));
  const approval={engineeringOwnerId:'synthetic-engineer',editorialOwnerId:'synthetic-editor',statement:'Synthetic provenance and rights/access decisions only; no real reviewer or production authorization.',reviewedAt:'2026-09-30T21:00:00.000Z',expiresAt:'2026-10-01T00:00:00.000Z',rightsDecision:'accepted',accessDecision:'public-or-authorized-read',receipts:{engineering:'synthetic-eng',editorial:'synthetic-ed',rights:'synthetic-rights',access:'synthetic-access'},browserProvenanceReviews:await Promise.all(samples.map(async sample=>({downloadReceiptSha256:sample.upstreamReceipt.downloadReceiptSha256,acquisitionSha256:await sha256(canonicalJson(sample.upstreamReceipt)),reviewerId:'synthetic-provenance-reviewer',reviewReceiptId:'synthetic-review-'+sample.capturedAt.slice(14,16),reviewedAt:'2026-09-30T20:30:00.000Z',accessReceiptId:'synthetic-access'})))};
  const configured={...source,paExport:{...source.paExport!,freshnessPolicy:policy}};
  const result=await qualifyCapturedWatchSource(configured,samples,approval);
  assert.equal(result.source.state,'qualified');assert.equal(result.publicationAuthorized,false);
  assert.ok(result.evidence.captureReceipts?.every(receipt=>receipt.httpStatus===null));
  await assert.rejects(qualifyCapturedWatchSource(configured,samples,{...approval,browserProvenanceReviews:[]}),/provenance-review/);
  await assert.rejects(qualifyCapturedWatchSource(source,samples,approval),/age-policy/);
  await assert.rejects(qualifyCapturedWatchSource(configured,samples,{...approval,reviewedAt:'2026-10-01T21:00:00.000Z',expiresAt:'2026-10-02T00:00:00.000Z'}),/age-policy/);
});
test('freshness separates failure/success, research/import origin, unknown policy and invalid/regressed clocks',()=>{
  const input={exportAt:'2026-10-01T20:30:06.000Z',billLastUpdateAt:'2026-09-30T20:05:00.000Z',lastCheckedAt:'2026-10-01T21:10:00.000Z',lastSuccessfulUpstreamCheckAt:'2026-10-01T21:00:00.000Z',currentFailure:'upstream-blocked',origin:'upstream' as const};
  const now='2026-10-01T21:15:00.000Z';
  const fresh=paSnapshotFreshness(input,now,policy);assert.equal(fresh.freshness,'fresh');assert.equal(fresh.currentFailure,'upstream-blocked');assert.equal(fresh.latestStatusVerified,false);
  assert.equal(paSnapshotFreshness(input,now).freshness,'unknown');
  for(const origin of ['library-research','browser-original'] as const)assert.equal(paSnapshotFreshness({...input,origin},now,policy).lastSuccessfulUpstreamCheckAt,null);
  assert.equal(paSnapshotFreshness(input,'2026-10-01T23:15:00.000Z',policy).freshness,'stale');
  assert.equal(paSnapshotFreshness({...input,exportAt:'bad'},now,policy).freshness,'invalid');
  assert.equal(paSnapshotFreshness({...input,exportAt:'2026-10-02T00:00:00.000Z'},now,policy).exportAgeMs,null);
  assert.equal(paSnapshotFreshness({...input,previousExportAt:'2026-10-01T21:00:00.000Z'},now,policy).freshness,'regressed');
  const weekend=paSnapshotFreshness(input,'2026-10-03T21:15:00.000Z',policy);assert.equal(weekend.boundMs,policy.weekendMaxAgeMs);assert.equal(weekend.freshness,'fresh');
  const html=renderToStaticMarkup(createElement(PaSourceHealth,{entries:[{subjectId:'synthetic-bill',sourceId:source.id,health:fresh}]}));
  for(const literal of ['Export timestamp','Bill last update','Last attempted source check','Last successful upstream check','upstream-blocked','Prior dated evidence is retained','Latest bill status remains unverified'])assert.ok(html.includes(literal),literal);
});
test('CLI imports/replays full original archive above former 500KB limit without source fetch',async()=>{
  const bytes=new Uint8Array(reconstructOriginal(new URL('./fixtures/pa-export/',import.meta.url))),{acquisition,receiptBytes}=await syntheticAcquisition(bytes);
  const directory=mkdtempSync(join(tmpdir(),'pa-original-replay-'));
  const body=join(directory,'original.zip'),receipt=join(directory,'tool-receipt.json'),input=join(directory,'acquisition.json');
  writeFileSync(body,bytes);writeFileSync(receipt,receiptBytes);writeFileSync(input,JSON.stringify(acquisition));
  const result=await importPaOriginal(source.id,bytes,acquisition,receiptBytes),packet=join(directory,'import.json');writeFileSync(packet,JSON.stringify(result));
  const replay=JSON.parse(execFileSync(process.execPath,['--import','tsx/esm','scripts/prepare-watch-source.mjs','--replay',packet,'--body',body,'--download-receipt',receipt],{encoding:'utf8'}));
  assert.equal(replay.outcome,'exact-replay');assert.ok(bytes.length>500000);
});

test('PA freshness SSR works with the CI loader default and no ambient JSX config',()=>{
  const env={...process.env,TSX_DISABLE_CACHE:'1'};
  delete env.TSX_TSCONFIG_PATH;
  const html=execFileSync(process.execPath,['--import','tsx/esm','--input-type','module','-e',`
    import assert from 'node:assert/strict';
    import {createElement} from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {PaSourceHealth} from './src/ui/watch/WatchShared.tsx';
    assert.equal(process.env.TSX_TSCONFIG_PATH,undefined);
    assert.equal(globalThis.React,undefined);
    const health={exportAt:'2026-10-01T20:30:06.000Z',exportAgeMs:60000,
      billLastUpdateAt:null,lastCheckedAt:null,lastSuccessfulUpstreamCheckAt:null,
      currentFailure:'upstream-blocked',origin:'browser-original',freshness:'unknown',
      boundMs:null,latestStatusVerified:false};
    const items=[{id:'synthetic-ssr-bill',slug:'synthetic-hb1925',title:'HB 1925',
      sources:[{sourceId:'synthetic-pa-source',label:'PA General Assembly'}]}];
    process.stdout.write(renderToStaticMarkup(createElement(PaSourceHealth,{items,
      entries:[{subjectId:items[0].id,sourceId:'synthetic-pa-source',health}]})));
  `],{cwd:new URL('../',import.meta.url),env,encoding:'utf8',timeout:30000});
  for(const text of ['PA source freshness','HB 1925','/policy-watch/synthetic-hb1925','PA General Assembly',
    'Last successful upstream check</dt><dd>unknown',
    'upstream-blocked','Prior dated evidence is retained','Latest bill status remains unverified'])assert.ok(html.includes(text),text);
  assert.match(html,/datetime="2026-10-01T20:30:06\.000Z"/i);
});
