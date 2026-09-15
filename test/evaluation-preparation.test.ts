import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { prepareEvaluationInventory,underlyingGroup,type DraftEvidence } from "../scripts/lib/evaluation-preparation";
import { canonicalJson } from "../src/content/watch-schema";

const record=(id:string,groupId:string,hash="a".repeat(64)):DraftEvidence=>({id,desk:"news",groupId,
  sourceUrl:"https://example.org/"+id,sourceTextSha256:hash,characters:100,provenance:{fixture:"synthetic-test-only"},limitations:[]});

test("same-instrument and identical-text deduplication is transitive across draft desks",async()=>{
  const input=[record("a","instrument-1"),record("b","instrument-1","b".repeat(64)),
    {...record("c","instrument-2","b".repeat(64)),desk:"cross-cutting" as const}];
  const report=await prepareEvaluationInventory(input,{fixture:"synthetic-test-only"});
  assert.equal(report.coverage.reduce((sum,row)=>sum+row.distinctDraftGroups!,0),1);
  const drafts=report.drafts as Array<{splitGroupId:string;duplicateGroupOrText:boolean}>;
  assert.equal(new Set(drafts.map(row=>row.splitGroupId)).size,1);
  assert.equal(drafts.filter(row=>row.duplicateGroupOrText).length,2);
  assert.equal(report.approvedCases,0);assert.equal(report.runnable,false);assert.equal(report.split.frozen,false);
});

test("event aliases and PA printer/version paths cannot be assigned independent groups",()=>{
  assert.equal(underlyingGroup("evt-dvhimss-22958","https://dvhimss.org/event"),underlyingGroup("evt-njdvhimss-fall-2026","https://njdvhimssevent.com/"));
  assert.equal(underlyingGroup("first","https://palegis.us/legislation/bills/2025/hb1925"),underlyingGroup("second","https://www.palegis.us/legislation/bills/2025/hb1925?pn=3349"));
  assert.notEqual(underlyingGroup("one","https://haponline.org/Resource-Center?resourceid=1487"),underlyingGroup("two","https://haponline.org/Resource-Center?resourceid=1531"));
});

test("inventory validates evidence bounds and does not fabricate executable labels or metrics",async()=>{
  await assert.rejects(prepareEvaluationInventory([record("a","g"),record("a","h")],{}),/duplicate/);
  await assert.rejects(prepareEvaluationInventory([{...record("a","g"),characters:0}],{}),/source-length/);
  await assert.rejects(prepareEvaluationInventory([{...record("a","g"),sourceTextSha256:"bad"}],{}),/source-hash/);
  await assert.rejects(prepareEvaluationInventory([{...record("a","g"),desk:"policy"}],{}),/jurisdiction/);
  const report=await prepareEvaluationInventory([{...record("a","g"),characters:30000,limitations:["literal-excerpt-selection-required"]}],{});
  assert.equal(report.configuration,null);assert.equal(report.pricing,null);assert.equal(report.modelMetrics,null);
  const draft=report.drafts[0] as {split:unknown;expected:unknown;reviewerLabels:unknown[];adjudication:unknown};
  assert.equal(draft.split,null);assert.equal(draft.expected,null);assert.deepEqual(draft.reviewerLabels,[]);assert.equal(draft.adjudication,null);
});

test("committed real inventory recounts exactly without requiring external backup access",async()=>{
  const report=JSON.parse(readFileSync(new URL("../fixtures/evaluation-preparation/real-case-inventory-20260912.json",import.meta.url),"utf8"));
  const records=report.drafts.map(({splitGroupId,duplicateGroupOrText,split,critical,expected,reviewerLabels,adjudication,readiness,...record}:Record<string,unknown>)=>record) as DraftEvidence[];
  const rebuilt=await prepareEvaluationInventory(records,report.provenance);
  assert.equal(canonicalJson(rebuilt),canonicalJson(report));
  assert.equal(report.coverage.reduce((sum:number,row:{draftSlotUpperBound:number})=>sum+row.draftSlotUpperBound,0),39);
  assert.equal(report.coverage.reduce((sum:number,row:{missingDraftSlots:number})=>sum+row.missingDraftSlots,0),61);
  assert.equal(report.approvedCases,0);assert.equal(report.policyCoverage.find((row:{jurisdiction:string})=>row.jurisdiction==="local").distinctDraftGroups,0);
  assert.ok(report.drafts.every((row:{sourceTextSha256:string})=>/^[a-f0-9]{64}$/.test(row.sourceTextSha256)));
});
