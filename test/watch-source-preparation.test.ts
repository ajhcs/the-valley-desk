import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { launchCandidates } from "../fixtures/watch-launch-candidates";
import { launchCoverage } from "../fixtures/watch-launch-coverage";
import { captureLaunchCandidate, endpointRobotsPolicy, prepareCapturedSource } from "../scripts/lib/watch-source-preparation";
import { SOURCE_USER_AGENT } from "../src/ingest/upstream";
import { collectionReadiness, sourceConfigurationDigest } from "../src/ingest/watch/source-enrollment";
import { canonicalJson, sha256 } from "../src/content/watch-schema";
import { qualifyCapturedWatchSource } from "../scripts/lib/watch-source-qualification";

test("operator qualification replays real repository evidence and requires distinct healthy samples", async () => {
  const candidate = launchCandidates.find(item => item.source.id === "candidate-orca")!;
  const entry = receipts().find(item => item.receipt.sourceId === "candidate-orca")!;
  const bytes = new Uint8Array(readFileSync(new URL(entry.receipt.bodyFile, directory)));
  const samples = ["2026-09-12T18:00:00.000Z", "2026-09-12T19:00:00.000Z"].map(capturedAt => ({
    endpoint: candidate.source.endpoints[0]!, capturedAt, bytes }));
  const approval = { engineeringOwnerId: "synthetic-engineer", editorialOwnerId: "synthetic-owner",
    statement: "Synthetic source access approval for qualification tests only; not a production decision.",
    reviewedAt: "2026-09-12T20:00:00.000Z", expiresAt: "2026-10-12T20:00:00.000Z",
    rightsDecision: "accepted", accessDecision: "public-or-authorized-read" };
  const result = await qualifyCapturedWatchSource(candidate.source, samples, approval);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.source.state, "qualified");
  assert.equal(result.qualification.configurationSha256, await sourceConfigurationDigest(candidate.source));
  assert.equal(result.review.qualificationSha256, await sha256(canonicalJson(result.qualification)));
  await assert.rejects(qualifyCapturedWatchSource(candidate.source, [samples[0]!, samples[0]!], approval));
  await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples.map(sample => ({ ...sample, bytes: new TextEncoder().encode("{") })), approval), /replay-not-healthy/);
  await assert.rejects(qualifyCapturedWatchSource(candidate.source, samples, { ...approval, rightsDecision: "pending" }));
  await assert.rejects(qualifyCapturedWatchSource({ ...candidate.source, parserId: "uninstalled-parser" }, samples, approval), /parser-unsupported/);
});

const directory=new URL("./fixtures/watch-launch/",import.meta.url);
const receipts=()=>readdirSync(directory).filter(file=>file.endsWith(".json")).map(file=>({
  file,receipt:JSON.parse(readFileSync(new URL(file,directory),"utf8")),
}));

test("fourteen executable candidates cannot qualify or activate themselves; all eleven county gaps stay visible",async()=>{
  assert.equal(launchCandidates.length,14);
  assert.equal(new Set(launchCandidates.map(row=>row.source.id)).size,14);
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

test("endpoint access holds never issue an endpoint request",async()=>{
  const calls:string[]=[];
  const result=await captureLaunchCandidate("candidate-de-news",async(input)=>{
    calls.push(String(input));return new Response("User-agent: *\nDisallow: /feed/");
  });
  assert.equal(result.outcome,"access-held");
  assert.equal(result.access.disposition,"robots-endpoint-disallowed");
  assert.deepEqual(calls,["https://news.delaware.gov/robots.txt"]);
  assert.equal(result.packet,null);
  assert.equal(endpointRobotsPolicy("<html>Access challenge</html>","https://news.delaware.gov/feed/").disposition,"robots-unrecognized");
});

test("robots matching uses the actual agent, endpoint, longest path, Allow ties and wildcard/query anchors",()=>{
  const endpoint="https://news.delaware.gov/feed/";
  const policy=(body:string,url=endpoint)=>endpointRobotsPolicy(body,url);
  assert.equal(policy("User-agent: *\nDisallow: /wp-admin\nHost: news.delaware.gov\nSitemap: https://news.delaware.gov/sitemap.xml").disposition,"robots-endpoint-allowed");
  assert.equal(policy("User-agent: OtherBot\nDisallow: /\nCrawl-delay: 60\nUser-agent: *\nAllow: /").disposition,"robots-endpoint-allowed");
  assert.equal(policy("User-agent: *\nDisallow: /\nUser-agent: TheValleyDesk\nAllow: /feed/").disposition,"robots-endpoint-allowed");
  assert.equal(policy("User-agent: *\nAllow: /\nUser-agent: TheValleyDesk\nDisallow: /feed/").disposition,"robots-endpoint-disallowed");
  const specific=policy("User-agent: *\nDisallow: /\nDisallow: /feed/\nAllow: /feed/");
  assert.equal(specific.disposition,"robots-endpoint-allowed");
  assert.equal(specific.matchingLine,4);
  assert.equal(specific.userAgent,SOURCE_USER_AGENT);
  assert.equal(specific.endpoint,endpoint);
  assert.equal(policy("User-agent: *\nDisallow: /*?private=1$",endpoint+"?private=1").disposition,"robots-endpoint-disallowed");
  assert.equal(policy("User-agent: *\nDisallow: /*?private=1$",endpoint+"?private=10").disposition,"robots-endpoint-allowed");
});

test("malformed responses and unsupported directives are held while empty valid robots is allowed",()=>{
  const endpoint="https://news.delaware.gov/feed/";
  for(const body of ["Access denied","User-agent: *\nDisallow /","Disallow: /", "User-agent:\nAllow: /",
    "User-agent: *\nCrawl-delay: -1","User-agent: *\nCrawl-delay: 1s","User-agent: *\nUnknown-rule: /"]){
    assert.equal(endpointRobotsPolicy(body,endpoint).disposition,"robots-unrecognized",body);
  }
  assert.equal(endpointRobotsPolicy("# empty public policy\n",endpoint).disposition,"robots-endpoint-allowed");
});

test("permitted feeds wait for applicable crawl delay and retain no publication authority",async()=>{
  const calls:string[]=[],waits:number[]=[];
  const result=await captureLaunchCandidate("candidate-de-news",async(input,init)=>{
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("user-agent"),SOURCE_USER_AGENT);
    return new Response(calls.length===1?"User-agent: *\nDisallow: /wp-admin\nCrawl-delay: 2.5":
      '<rss version="2.0"><channel><title>Public news</title></channel></rss>');
  },async ms=>{waits.push(ms);});
  assert.deepEqual(calls,["https://news.delaware.gov/robots.txt","https://news.delaware.gov/feed/"]);
  assert.deepEqual(waits,[2500]);
  assert.equal(result.access.disposition,"robots-endpoint-allowed");
  assert.equal(result.packet?.activationAuthorized,false);
  assert.equal(result.packet?.publicationAuthorized,false);
});

test("delay beyond capture budget and unavailable robots hold without retrying or fetching content",async()=>{
  for(const response of [()=>new Response("User-agent: *\nCrawl-delay: 60"),
    ()=>new Response(null,{status:403}),()=>new Response(null,{status:429}),()=>new Response(null,{status:503})]){
    const calls:string[]=[];
    const result=await captureLaunchCandidate("candidate-de-news",async input=>{
      calls.push(String(input));return response();
    },async()=>{throw Error("must not wait");});
    assert.equal(result.outcome,"access-held");
    assert.deepEqual(calls,["https://news.delaware.gov/robots.txt"]);
    assert.equal(result.packet,null);
  }
  assert.equal(endpointRobotsPolicy("User-agent: *\nCrawl-delay: 2","https://news.delaware.gov/feed/",1500).disposition,"robots-delay-exceeds-budget");
});

test("robots 404 retains the approved public endpoint fallback",async()=>{
  let calls=0;
  const waits:number[]=[];
  const result=await captureLaunchCandidate("candidate-de-news",async()=>++calls===1?new Response(null,{status:404}):
    new Response('<rss version="2.0"><channel><title>Public news</title></channel></rss>'),async ms=>{waits.push(ms);});
  assert.equal(calls,2);
  assert.equal(result.access.disposition,"robots-not-found");
  assert.deepEqual(waits,[1000]);
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
