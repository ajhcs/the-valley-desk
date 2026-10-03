import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import replay from "../fixtures/leadership-health-replay-20261003.json";
import { buildRuntimeLeadershipCoverage } from "../src/lib/operational-status.ts";
import { sendAutomationAlerts } from "../worker.js";
import { handleReviewApi } from "../src/ingest/review-api.ts";
import { seedCoveragePack } from "../src/ingest/executive-persistence.ts";
import { monitorLeadershipSources, type ScheduledLeadershipState } from "../src/ingest/leadership-monitor.ts";
import { normalizeSourceUrl } from "../src/ingest/identity.ts";
import { coveragePack, CoveragePackDocument, monitorableSources } from "../src/ingest/coverage-pack.ts";
import { runAutomation } from "../src/ingest/automation.ts";
import { recordOperationalAlert } from "../src/lib/alerts.ts";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence.ts";
const configured = replay.configured.map(row => ({...row, configuredStatus:"active" as const}));
const now = new Date(replay.provenance.alertAt);
function coverage(at=now) { return buildRuntimeLeadershipCoverage(configured,replay.sources,at); }
function database() {
 const sqlite=new DatabaseSync(":memory:");
 for(const file of readdirSync("migrations").filter(x=>x.endsWith(".sql")).sort())sqlite.exec(readFileSync(`migrations/${file}`,"utf8"));
 const statement=(query:string,values:unknown[]=[]):D1StatementLike=>({bind:(...args:unknown[])=>statement(query,args),first:async<T>()=>(sqlite.prepare(query).get(...values as never[]) as T)??null,all:async<T>()=>({results:sqlite.prepare(query).all(...values as never[]) as T[]}),run:async()=>sqlite.prepare(query).run(...values as never[])});
 const db:D1DatabaseLike={prepare:query=>statement(query),batch:async statements=>Promise.all(statements.map(s=>s.run()))};
 return {sqlite,db};
}
const stage=(at=now)=>({outcome:"degraded",fetched:3,failed:3,backoff:6,coverage:configured,runtimeCoverage:coverage(at),failureDetails:[{institutionId:"inst-penn",sourceId:"src-penn-is-leadership",errorClass:"empty-unverified",reason:"Page fetched, but no readable leadership content was found",nextRetryAt:"2026-10-09T23:01:13.480Z"},{institutionId:"inst-cooper",sourceId:"src-cooper-leadership",errorClass:"http",httpStatus:403,reason:"HTTP 403",nextRetryAt:"2026-10-09T23:01:13.480Z"},{institutionId:"inst-lvhn",sourceId:"src-lvhn-leadership-committees",errorClass:"http",httpStatus:403,reason:"HTTP 403",nextRetryAt:"2026-10-09T23:01:13.480Z"}]});
test("captured daily observations remove false losses while retaining all six genuinely unusable sources",()=>{
 for(const at of [now,new Date(replay.provenance.capturedAt)]) {
  const rows=coverage(at);
  assert.deepEqual(rows.filter(r=>r.coverageLost).map(r=>r.shortName),replay.actuallyLost);
  assert.equal(rows.filter(r=>r.state==="healthy").length,10);
  assert.equal(rows.find(r=>r.shortName==="Cooper")?.state,"blocked");
  assert.equal(rows.find(r=>r.shortName==="Penn")?.state,"backoff");
 }
});
test("cadence windows are bounded; next retry never prolongs old observations",()=>{
 const c=[{institutionId:"inst-one",shortName:"One",configuredStatus:"active" as const,sourceIds:["src-one"]}];
 const check=(cadence:string,hours:number)=>buildRuntimeLeadershipCoverage(c,[{sourceId:"src-one",institutionId:"inst-one",cadence,state:"unchanged",lastSuccessAt:new Date(now.getTime()-hours*3600000).toISOString(),nextAttemptAt:"2099-01-01T00:00:00.000Z"}],now)[0]!;
 for(const [cadence,hours] of [["hourly",2],["daily",26],["weekly",170],["unknown",2],["inventory",2]] as const) {
  assert.equal(check(cadence,hours).coverageLost,false,`${cadence} exact boundary`);
  assert.equal(check(cadence,hours+1/3600000).coverageLost,true,`${cadence} expired boundary`);
 }
});
test("future, invalid, missing and cross-institution observations cannot provide coverage",()=>{
 const c=[{institutionId:"inst-one",shortName:"One",configuredStatus:"active" as const,sourceIds:["src-one"]}];
 for(const value of ["2026-10-04T00:00:00.000Z","invalid",null]) {
  const row=buildRuntimeLeadershipCoverage(c,[{sourceId:"src-one",institutionId:"inst-one",cadence:"daily",state:"healthy",lastSuccessAt:value}],now)[0]!;
  assert.equal(row.coverageLost,true);assert.notEqual(row.state,"healthy");
 }
 assert.equal(buildRuntimeLeadershipCoverage(c,[{sourceId:"src-one",institutionId:"inst-other",cadence:"daily",state:"healthy",lastSuccessAt:now.toISOString()}],now)[0]!.coverageLost,true);
 assert.equal(buildRuntimeLeadershipCoverage(c,[],now)[0]!.coverageLost,true);
});
test("calendar rollovers and unzoned dates cannot fabricate fresh weekly observations",()=>{
 const c=[{institutionId:"inst-one",shortName:"One",configuredStatus:"active" as const,sourceIds:["src-one"]}];
 const at=new Date("2026-10-03T03:25:34.967Z");
 const check=(value:string,clock=at)=>buildRuntimeLeadershipCoverage(c,[{sourceId:"src-one",institutionId:"inst-one",cadence:"weekly",state:"healthy",lastSuccessAt:value}],clock)[0]!;
 for(const value of ["2026-09-31T03:25:34.967Z","2026-02-29T03:25:34Z","1900-02-29T00:00:00Z","2026-10-02T24:00:00Z","2026-10-02T03:60:00Z","2026-10-02T03:25:60Z","2026-10-02T03:25:34.967","2026-10-02T03:25:34+24:00","2026-10-02T03:25:34+00:60","2026-00-02T03:25:34Z","2026-10-00T03:25:34Z"]) {
  const row=check(value);assert.equal(row.coverageLost,true,value);
  assert.equal(row.sourceStates[0]!.coverageCurrent,false,value);assert.equal(row.sourceStates[0]!.failureAgeMs,null,value);assert.equal(row.sourceStates[0]!.freshUntilAt,null,value);
 }
 for(const value of ["2026-10-01T03:25:34.967Z","2026-10-01T05:25:34.967+02:00","2026-10-01T01:25:34.967-02:00"])assert.equal(check(value).coverageLost,false,value);
 assert.equal(check("2024-02-29T00:00:00Z",new Date("2024-03-01T00:00:00Z")).coverageLost,false);
 assert.equal(check("2000-02-29T00:00:00Z",new Date("2000-03-01T00:00:00Z")).coverageLost,false);
});
test("a fresh fallback preserves coverage while failed source state and evidence remain degraded",()=>{
 const c=[{institutionId:"inst-one",shortName:"One",configuredStatus:"active" as const,sourceIds:["src-one","src-two"]}];
 const rows=buildRuntimeLeadershipCoverage(c,[{sourceId:"src-one",institutionId:"inst-one",cadence:"daily",state:"blocked",consecutiveFailures:3,nextAttemptAt:"2026-10-09T00:00:00.000Z"},{sourceId:"src-two",institutionId:"inst-one",cadence:"daily",state:"healthy",lastSuccessAt:"2026-10-02T07:00:00.000Z"}],now);
 assert.equal(rows[0]!.coverageLost,false);assert.equal(rows[0]!.state,"degraded");assert.equal(rows[0]!.sourceStates[0]!.state,"blocked");
});
test("multi-institution alert retains own-source retry/state and distinguishes evaluations from attempts",async()=>{
 const {sqlite,db}=database(),sent:string[]=[];
 try {
  const env={VALLEY_DESK_DB:db,NOTIFY_OPS:{send:async(message:{text:string})=>{sent.push(message.text);return {messageId:"local-only"};}}};
  await recordOperationalAlert(db,{fingerprint:"valley-desk:leadership-monitor",event:"leadership-monitor-failed",severity:"critical",subsystem:"leadership",institutionId:"inst-penn",groupKey:"valley-desk:leadership:inst-penn",notify:false,now:new Date(now.getTime()-1000)});
  await sendAutomationAlerts(env,{leadership:stage()},now);
  const row=sqlite.prepare("SELECT * FROM operational_alerts WHERE fingerprint='valley-desk:leadership-monitor'").get() as any;
  assert.equal(row.institution_id,null);assert.equal(row.group_key,"valley-desk:leadership:monitor");assert.equal(row.severity,"critical");assert.equal(row.condition_state,"blocked");
  const detail=JSON.parse(row.detail_json);assert.equal(detail.sourceIssueCount,6);assert.equal(detail.coverageLostCount,6);assert.equal(detail.countSemantics,"condition-evaluations");assert.equal(detail.fetched,3);assert.equal(detail.failed,3);assert.equal(detail.sourceId,undefined);assert.equal(detail.nextRetryAt,undefined);
  const issues=Object.entries(detail).filter(([key])=>/^sourceIssue\d+$/.test(key)).map(([,v])=>JSON.parse(v as string));
  assert.equal(issues.length,6);assert.equal(issues.find(x=>x.sourceId==="src-penn-is-leadership").state,"backoff");assert.equal(issues.find(x=>x.sourceId==="src-penn-is-leadership").errorClass,"empty-unverified");assert.equal(issues.find(x=>x.sourceId==="src-cooper-leadership").errorClass,"http-403");assert.equal(issues.find(x=>x.sourceId==="src-rwjbarnabas-leadership").nextRetryAt,"2026-10-08T01:30:44.555Z");
  assert.match(sent[0]!,/occurrence_unit: condition-evaluations/);
 } finally {sqlite.close();}
});
test("persistent failures remain visible during backoff without pretending fresh fetches or recovery",async()=>{
 const {sqlite,db}=database();try {
  const pending={...stage(),outcome:"ok",fetched:0,failed:0,failureDetails:[]};
  await sendAutomationAlerts({VALLEY_DESK_DB:db},{leadership:pending},now);
  await sendAutomationAlerts({VALLEY_DESK_DB:db},{leadership:pending},new Date(now.getTime()+1000));
  const row=sqlite.prepare("SELECT * FROM operational_alerts WHERE fingerprint='valley-desk:leadership-monitor'").get() as any;
  assert.ok(row);assert.equal(row.state,"open");assert.equal(row.recovery_count,0);assert.equal(row.occurrence_count,2);
  const detail=JSON.parse(row.detail_json);assert.equal(detail.fetched,0);assert.equal(detail.failed,0);assert.equal(detail.sourceIssueCount,6);
 }finally{sqlite.close();}
});
test("missing runtime evidence and unrelated model recovery cannot clear leadership",async()=>{
 const {sqlite,db}=database();try{
  await recordOperationalAlert(db,{fingerprint:"valley-desk:leadership-monitor",event:"leadership-monitor-failed",severity:"critical",subsystem:"leadership",notify:false,now});
  for(let i=0;i<2;i++)await sendAutomationAlerts({VALLEY_DESK_DB:db},{leadership:{outcome:"ok",fetched:0,failed:0,backoff:0},modelVerificationAttempted:1,modelVerificationFailed:0},new Date(now.getTime()+1000+i));
  const row=sqlite.prepare("SELECT state,recovery_count FROM operational_alerts WHERE fingerprint='valley-desk:leadership-monitor'").get() as any;
  assert.equal(row.state,"open");assert.equal(row.recovery_count,0);
 }finally{sqlite.close();}
});

test("review status and automation both use configured daily cadence without collector requests",async()=>{
 const {sqlite,db}=database();try {
  const at=new Date(),last=new Date(at.getTime()-18*3600000).toISOString(),next=new Date(at.getTime()+6*3600000).toISOString();
  await seedCoveragePack(db,undefined,at);
  sqlite.prepare("UPDATE scheduled_source_state SET state='healthy',last_success_at=?,last_attempted_at=?,next_attempt_at=?,consecutive_failures=0,last_error=NULL").run(last,last,next);
  const env={VALLEY_DESK_DB:db,REVIEW_API_TOKEN:"local-test-only"};
  const anonymous=await handleReviewApi(new Request("https://thevalleydesk.org/api/automation/status"),env);assert.equal(anonymous.status,404);
  const response=await handleReviewApi(new Request("https://thevalleydesk.org/api/automation/status",{headers:{authorization:"Bearer local-test-only"}}),env);assert.equal(response.status,200);
  const data=await response.json() as any;
  const rows=data.executiveIntelligence.runtimeCoverage;
  assert.equal(rows.length,16);assert.ok(rows.every((r:any)=>!r.coverageLost&&r.state==="healthy"));
  assert.ok(rows.flatMap((r:any)=>r.sourceStates).every((s:any)=>s.cadence==="daily"&&s.freshnessBudgetMs===26*3600000&&s.coverageCurrent));
  const networkCalls:string[]=[];
  const result=await runAutomation({VALLEY_DESK_DB:db},async input=>{networkCalls.push(input instanceof Request ? input.url : String(input));throw new Error("Local network disabled");},async()=>({fetchedAt:at.toISOString(),rss:[],events:[],social:[],notes:{rss:0,events:0,linkedin:{count:0},x:{count:0},grok:{count:0,pending:0},sources:[]}}));
  assert.equal(result.leadership?.fetched,0);
  assert.ok(result.leadership?.runtimeCoverage.every((r:any)=>!r.coverageLost&&r.state==="healthy"));
  assert.ok(result.leadership?.runtimeCoverage.flatMap((r:any)=>r.sourceStates).every((s:any)=>s.cadence==="daily"));
  const leadershipUrls=new Set(monitorableSources().flatMap(source=>[source.url,...(source.alternateUrls??[])]));
  assert.ok(!networkCalls.some(url=>leadershipUrls.has(url)),"No leadership source requests while schedules are not due");
 }finally{sqlite.close();}
});

test("offline tiny unreadable pages and403failures preserve last good history and cannot infer departures",async()=>{
 const failed=replay.sources.filter(s=>s.consecutiveFailures>0),ids=new Set(failed.map(s=>s.sourceId));
 const pack=CoveragePackDocument.parse({...coveragePack,people:[],sources:coveragePack.sources.filter(s=>ids.has(s.id))});
 const states=new Map<string,ScheduledLeadershipState>(failed.map(s=>[s.sourceId,{sourceId:s.sourceId,state:s.state==="blocked"?"blocked":"upstream-failed",lastSuccessAt:s.lastSuccessAt,lastAttemptedAt:s.lastAttemptedAt,lastHash:"synthetic-prior-hash",lastExtracted:s.lastSuccessAt?[{name:"Example Person",title:"Chief Information Officer",normalizedName:"example person",normalizedTitle:"chief information officer"}]:[],nextAttemptAt:new Date(now.getTime()-1000).toISOString(),consecutiveFailures:s.consecutiveFailures,lastError:s.lastError}]));
 const blocked=new Set(pack.sources.filter(s=>s.id==="src-cooper-leadership"||s.id==="src-lvhn-leadership-committees"||s.id==="src-rwjbarnabas-leadership").flatMap(s=>[s.url,...(s.alternateUrls??[])]).map(normalizeSourceUrl));
 // Synthetic212byte shell is a regression class, not retained Penn wire content.
 const shell="<html><head><script>window.fixture=true;</script></head><body></body></html>".padEnd(212," ");
 const calls:string[]=[];
 const result=await monitorLeadershipSources({pack,states,now,fetchImpl:async input=>{const url=input instanceof Request?input.url:String(input);calls.push(url);if(new URL(url).pathname==="/robots.txt")return new Response("User-agent: *\nAllow: /\n",{headers:{"content-type":"text/plain"}});return blocked.has(url)?new Response("Forbidden",{status:403}):new Response(shell,{headers:{"content-type":"text/html"}});}});
 assert.equal(result.snapshots.length,6);
 assert.equal(result.snapshots.filter(s=>s.state==="blocked").length,3);
 assert.equal(result.snapshots.filter(s=>s.state==="failed").length,3);
 for(const snapshot of result.snapshots) {
  if(blocked.has(normalizeSourceUrl(snapshot.finalUrl))){assert.equal(snapshot.state,"blocked");assert.equal(snapshot.httpStatus,403);}
  else {assert.equal(snapshot.state,"failed");assert.equal(snapshot.extractionStatus,"empty-unverified");assert.equal(snapshot.byteCount,212);}
 }
 assert.ok(result.observations.every(o=>o.kind!=="person-departed"&&o.kind!=="person-appeared"&&o.kind!=="title-changed"));
 for(const next of result.schedule){const previous=states.get(next.sourceId)!;assert.equal(next.lastSuccessAt,previous.lastSuccessAt);assert.equal(next.lastHash,previous.lastHash);assert.deepEqual(next.lastExtracted,previous.lastExtracted);assert.equal(next.consecutiveFailures,previous.consecutiveFailures+1);assert.equal(Date.parse(next.nextAttemptAt)-now.getTime(),7*24*3600000);}
 const allowed=new Set(pack.sources.flatMap(s=>[s.url,...(s.alternateUrls??[])]).flatMap(url=>[url,new URL("/robots.txt",url).href]).map(normalizeSourceUrl));
 assert.ok(calls.every(url=>allowed.has(url)),JSON.stringify({unexpected:calls.filter(url=>!allowed.has(url))}));
});
