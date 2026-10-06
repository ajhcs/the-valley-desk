import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {evaluateRetainedCaptures} from '../scripts/evaluate-retained-leadership.mjs';
import {coveragePack} from '../src/ingest/coverage-pack';
const ids=['src-chop-desai','src-chop-leadership','src-chop-pennington','src-chop-salmasian','src-inspira-leadership','src-nemours-leadership','src-temple-leadership'];
const now=Date.parse('2026-10-06T12:00:00Z');
function fixtures(){
 // Invented empty page; no retained publisher response in this fixture.
 const html='<main><h1>Invented test page</h1></main>',bytes=Buffer.from(html),hash=createHash('sha256').update(bytes).digest('hex');
 return ids.map(id=>{const url=coveragePack.sources.find(s=>s.id===id)!.url;return {source_id:id,configured_url:url,attempted_url:url,final_url:url,http_status:200,content_type:'text/html; charset=utf-8',received_at:'2026-10-06T03:00:00Z',expires_at:'2026-10-07T04:00:00.000Z',byte_count:bytes.length,raw_markup_base64:bytes.toString('base64'),raw_sha256:hash,decoded_sha256:hash,byte_semantics:'fetch-response-body',decoding:'utf-8-replacement-bom-stripped'};});
}
test('authorized synthetic rows validate integrity without retaining input bytes',()=>{
 const r=evaluateRetainedCaptures(fixtures(),now);assert.equal(r.inputRows,7);assert.equal(r.evaluationWritesRaw,false);
 assert.equal(JSON.stringify(r).includes('raw_markup_base64'),false);assert.ok(r.results.every((r:any)=>r.integrityVerified&&r.candidateCount===0));
});
test('expiry is exclusive and cannot be extended or made invalid',()=>{
 for(const time of [Date.parse('2026-10-07T04:00:00Z'),NaN])assert.throws(()=>evaluateRetainedCaptures(fixtures(),time));
 for(const value of ['invalid','2026-10-08T04:00:00Z']){const rows=fixtures();rows[0].expires_at=value;assert.throws(()=>evaluateRetainedCaptures(rows,now));}
});
test('exact source set rejects duplicates, foreign sources and missing rows',()=>{
 const rows=fixtures();rows[0].source_id='src-foreign';assert.throws(()=>evaluateRetainedCaptures(rows,now));
 const duplicates=fixtures();duplicates[0]=duplicates[1];assert.throws(()=>evaluateRetainedCaptures(duplicates,now));
 assert.throws(()=>evaluateRetainedCaptures(fixtures().slice(1),now));
});
test('integrity, response attribution and capture semantics fail closed',()=>{
 for(const [key,value] of [['raw_sha256','0'.repeat(64)],['decoded_sha256','0'.repeat(64)],['final_url','https://example.invalid/'],['attempted_url','https://example.invalid/'],['byte_count',512001],['http_status',403],['content_type','application/json'],['received_at','2026-10-06T04:00:00Z'],['decoding','unknown'],['byte_semantics','wire-body']]){
  const rows=fixtures();Object.assign(rows[0],{[String(key)]:value});assert.throws(()=>evaluateRetainedCaptures(rows,now));
 }
});
function replaceHtml(row:ReturnType<typeof fixtures>[number],html:string){
 const bytes=Buffer.from(html);row.byte_count=bytes.length;row.raw_markup_base64=bytes.toString('base64');row.raw_sha256=row.decoded_sha256=createHash('sha256').update(bytes).digest('hex');
}
test('every emitted candidate and rejection field excludes synthetic markup fragments',()=>{
 const rows=fixtures();
 replaceHtml(rows.find(r=>r.source_id==='src-chop-leadership')!,'<main id="main-content"><h1>CHOP Executive Leadership</h1><chop-basic-card><h2>Jordan Example, &lt;section&gt;SYNTHETIC BIOGRAPHY FRAGMENT&lt;/section&gt;</h2><p>Chief Information Officer</p></chop-basic-card></main>');
 replaceHtml(rows.find(r=>r.source_id==='src-nemours-leadership')!,'<main><h1>Leadership &amp; Governance</h1><div class="cmp-tabs__tabpanel"><h2 class="cmp-title__text">&lt;section&gt;SYNTHETIC BIOGRAPHY FRAGMENT&lt;/section&gt;</h2></div></main>');
 const result=evaluateRetainedCaptures(rows,now);assert.equal(JSON.stringify(result).includes('FRAGMENT'),false);assert.equal(JSON.stringify(result).includes('<section>'),false);
 assert.equal(result.results.find((r:any)=>r.sourceId==='src-chop-leadership').candidateCount,0);
});
test('accepted date metadata emits canonical timestamps without original comments',()=>{
 const rows=fixtures();rows[0].received_at='Tue, 06 Oct 2026 03:00:00 GMT (SYNTHETIC FRAGMENT)';
 const result=evaluateRetainedCaptures(rows,now);assert.equal(result.results[0].receivedAt,'2026-10-06T03:00:00.000Z');assert.equal(JSON.stringify(result).includes('FRAGMENT'),false);
});
test('semicolonless and recursive entity fragments cannot leave the evaluator',()=>{
 for(const fragment of ['&amp;ltsection&amp;gtSYNTHETIC FRAGMENT&amp;lt/section&amp;gt','&amp;#38;lt;section','&amp;NewLine;SYNTHETIC FRAGMENT']){
  const rows=fixtures();replaceHtml(rows.find(r=>r.source_id==='src-chop-leadership')!,'<main id="main-content"><h1>CHOP Executive Leadership</h1><chop-basic-card><h2>Jordan Example</h2><p>Chief Information Officer '+fragment+'</p></chop-basic-card></main>');
  const r=evaluateRetainedCaptures(rows,now);assert.equal(r.results.find((r:any)=>r.sourceId==='src-chop-leadership').candidateCount,0);assert.equal(JSON.stringify(r).includes('FRAGMENT'),false);
 }
});
