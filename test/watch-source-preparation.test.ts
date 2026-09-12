import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { launchCandidates } from "../fixtures/watch-launch-candidates";
import { launchCoverage } from "../fixtures/watch-launch-coverage";
import { captureLaunchCandidate, conservativeRobotsDisposition, prepareCapturedSource } from "../scripts/lib/watch-source-preparation";
import { collectionReadiness, sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import { canonicalJson, sha256 } from "../src/content/watch-schema";

const directory=new URL("./fixtures/watch-launch/",import.meta.url);
const receipts=()=>readdirSync(directory).filter(file=>file.endsWith(".json")).map(file=>({
  file,receipt:JSON.parse(readFileSync(new URL(file,directory),"utf8")),
}));

test("nine executable candidates cannot qualify or activate themselves; all eleven county gaps stay visible",async()=>{
  assert.equal(launchCandidates.length,9);
  assert.equal(new Set(launchCandidates.map(row=>row.source.id)).size,9);
  for(const candidate of launchCandidates){
    assert.equal(candidate.source.state,"pending");
    assert.equal(candidate.source.qualificationReceiptId,null);
    assert.equal(candidate.rightsDecision,null);
    assert.match(await sourceConfigurationDigest(candidate.source),/^[a-f0-9]{64}$/);
    assert.equal((await collectionReadiness(candidate.source,{now:"2026-09-12T18:00:00.000Z",activeSourceIds:new Set([candidate.source.id]),receipts:new Map()})).ready,false);
  }
  assert.equal(launchCoverage.counties.length,11);
  assert.equal(new Set(launchCoverage.counties.map(row=>row.id)).size,11);
  assert.ok(launchCoverage.counties.every(row=>row.monitoringAssignment===null&&row.municipalCoverage==="not-enumerated"));
  assert.deepEqual(new Set(launchCoverage.policyFamilies.map(row=>row.jurisdiction)),new Set(["federal","PA","NJ","DE"]));
});

test("retained real captures replay exact bytes and parser outputs with no publication permission",async()=>{
  let count=0,parsed=0;
  for(const {receipt} of receipts()){
    if(!receipt.packet)continue;
    const bytes=new Uint8Array(readFileSync(new URL(receipt.bodyFile,directory)));
    assert.equal(await sha256(bytes),receipt.packet.representationSha256);
    const actual=await prepareCapturedSource(receipt.sourceId,bytes,receipt.packet.capturedAt);
    assert.equal(canonicalJson(actual),canonicalJson(receipt.packet));
    assert.equal(actual.publicationAuthorized,false);assert.equal(actual.activationAuthorized,false);
    assert.equal(actual.review.rightsDecision,null);
    count++;if(actual.parsed){parsed++;assert.equal(actual.parsed.observations.length,1);}
  }
  assert.ok(count>=3);assert.ok(parsed>=2);
});

test("malformed, oversized, invalid-date and private repository samples do not become qualifying observations",async()=>{
  const at="2026-09-12T18:00:00.000Z";
  const encode=(text:string)=>new TextEncoder().encode(text);
  const malformed=await prepareCapturedSource("candidate-orca",encode("{"),at);
  assert.equal(malformed.parsed?.health.state,"parser-failed");
  assert.equal(malformed.parsed?.observations.length,0);
  await assert.rejects(prepareCapturedSource("candidate-philadelphia",new Uint8Array(500001),at),/byte-limit/);
  await assert.rejects(prepareCapturedSource("candidate-philadelphia",encode("hello"),"not-a-date"));
  const receipt=receipts().find(value=>value.receipt.sourceId==="candidate-orca")!.receipt;
  const repository=JSON.parse(readFileSync(new URL(receipt.bodyFile,directory),"utf8"));repository.private=true;
  const privateResult=await prepareCapturedSource("candidate-orca",encode(JSON.stringify(repository)),at);
  assert.equal(privateResult.parsed?.observations.length,0);
});

test("conservative access holds never issue an endpoint request or imply publisher prohibition",async()=>{
  const calls:string[]=[];
  const result=await captureLaunchCandidate("candidate-de-news",async(input)=>{
    calls.push(String(input));return new Response("User-agent: *\nDisallow: /wp-admin");
  });
  assert.equal(result.outcome,"access-held");
  assert.equal(result.access.disposition,"robots-review-required");
  assert.deepEqual(calls,["https://news.delaware.gov/robots.txt"]);
  assert.equal(result.packet,null);
  assert.equal(conservativeRobotsDisposition("<html>Access challenge</html>"),"robots-unrecognized");
});

test("public API capture is GET-only, bounded, no-auth and never follows redirect or retries",async()=>{
  let calls=0;
  const result=await captureLaunchCandidate("candidate-orca",async(input,init)=>{
    calls++;
    assert.equal(String(input),"https://api.github.com/repos/Stephonomon/orca-cds");
    assert.equal(init?.method??"GET","GET");
    assert.equal(init?.redirect,"manual");
    assert.equal(new Headers(init?.headers).has("authorization"),false);
    return new Response(null,{status:302,headers:{location:"https://example.com/other"}});
  });
  assert.equal(calls,1);assert.equal(result.packet,null);
  assert.equal(result.outcome,"upstream-failed");
  const huge=await captureLaunchCandidate("candidate-orca",async()=>new Response("x".repeat(500001)));
  assert.equal(huge.packet,null);assert.equal(huge.outcome,"upstream-failed");
  await assert.rejects(captureLaunchCandidate("https://example.com",async()=>{throw Error("must not fetch");}),/unknown-launch-candidate/);
});

test("CLI defaults to inventory and replays retained evidence without a network operation",()=>{
  const inventory=JSON.parse(execFileSync(process.execPath,["--import","tsx","scripts/prepare-watch-source.mjs"],{encoding:"utf8"}));
  assert.equal(inventory.status,"candidate-inventory-not-active");
  assert.equal(inventory.coverage.counties.length,11);
  const {file,receipt}=receipts().find(value=>value.receipt.sourceId==="candidate-orca")!;
  const result=JSON.parse(execFileSync(process.execPath,["--import","tsx","scripts/prepare-watch-source.mjs",
    "--replay",new URL(file,directory).pathname,"--body",new URL(receipt.bodyFile,directory).pathname],{encoding:"utf8"}));
  assert.equal(result.outcome,"exact-replay");assert.equal(result.qualificationStatus,"candidate-only");
});
