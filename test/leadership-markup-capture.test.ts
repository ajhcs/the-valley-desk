import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readBoundedBytes, readBoundedText, SOURCE_USER_AGENT } from "../src/ingest/upstream.ts";
import { fetchAllowlistedArticlePage } from "../src/ingest/news-extraction.ts";
import { normalizeSourceUrl } from "../src/ingest/identity.ts";
import { coveragePack } from "../src/ingest/coverage-pack.ts";
import { monitorLeadershipSources, type ScheduledLeadershipState } from "../src/ingest/leadership-monitor.ts";
import { MARKUP_CAPTURE_SOURCES, MARKUP_CAPTURE_START, MARKUP_CAPTURE_END, markupCaptureWindow, makeMarkupCapture, selectMarkupCaptureSources, persistMarkupCaptures, purgeExpiredMarkupCaptures, MARKUP_CAPTURE_RETENTION_END } from "../src/ingest/leadership-markup-capture.ts";
import type { D1DatabaseLike, D1StatementLike } from "../src/ingest/persistence.ts";
const at = new Date(Date.parse(MARKUP_CAPTURE_START) + 45 * 60_000);
const clock = () => at;
const source = coveragePack.sources.find(row => row.id === "src-chop-desai")!;
const pack = {...coveragePack, sources:[{...source, alternateUrls:[]}]};
const html = "<html><body><h1>Bimal Desai</h1><p>Chief Medical Information Officer</p></body></html>";
const fetcher: typeof fetch = async () => new Response(html, {headers:{"content-type":"text/html"}});
const held: ScheduledLeadershipState = {sourceId:source.id,state:"upstream-failed",lastSuccessAt:"2026-10-03T08:01:11.035Z",nextAttemptAt:MARKUP_CAPTURE_END,consecutiveFailures:2};
function database(databaseClock: (() => Date) | null = clock) {
 const sqlite=new DatabaseSync(":memory:");
 // SQLite test clock only: production uses the built-in DB clock.
 if(databaseClock) sqlite.function("strftime", {varargs:true}, () => databaseClock().toISOString()); sqlite.exec(readFileSync("migrations/0040_leadership_markup_captures.sql","utf8"));
 const statement=(query:string,values:unknown[]=[]):D1StatementLike=>({bind:(...args)=>statement(query,args),first:async<T>()=>(sqlite.prepare(query).get(...values as never[]) as T)??null,all:async<T>()=>({results:sqlite.prepare(query).all(...values as never[]) as T[]}),run:async()=>sqlite.prepare(query).run(...values as never[])});
 const db:D1DatabaseLike={prepare:q=>statement(q),batch:async rows=>Promise.all(rows.map(row=>row.run()))};
 return {sqlite,db};
}
async function snapshot() {return (await monitorLeadershipSources({fetchImpl:fetcher,pack,now:at,captureMarkupSourceIds:new Set([source.id]),markupClock:clock})).snapshots[0]!;}
test("default fetch/body behavior remains unchanged; exact bytes distinguish decoding loss",async()=>{
 const bytes=new Uint8Array([0xef,0xbb,0xbf,0x61,0xff,0x62]);
 assert.deepEqual(await readBoundedBytes(new Response(bytes),6),bytes);
 const text=await readBoundedText(new Response(bytes),6); assert.equal(text,"a�b");
 const page=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),fetchImpl:async()=>new Response(bytes,{headers:{"content-type":"text/html; charset=utf-8"}}),maxBytes:6,retainMarkupBytes:true,markupClock:clock});
 const capture=await makeMarkupCapture(source.id,source.url,source.url,page); assert.ok(capture);
 assert.deepEqual(Buffer.from(capture.rawMarkupBase64,"base64"),Buffer.from(bytes));
 assert.equal(capture.rawSha256,createHash("sha256").update(bytes).digest("hex"));
 assert.equal(capture.decodedSha256,createHash("sha256").update(text).digest("hex"));
 assert.notEqual(capture.rawSha256,capture.decodedSha256); assert.equal(capture.byteCount,6);
 const plain=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),fetchImpl:fetcher}); assert.ok(plain.ok); assert.equal(plain.markupResponse,undefined);
});
test("bounded byte reader accepts boundary and cancels oversized declared/stream bodies",async()=>{
 assert.equal((await readBoundedBytes(new Response(new Uint8Array(512000)),512000)).length,512000);
 await assert.rejects(readBoundedBytes(new Response(new Uint8Array(512001)),512000),/exceeded/);
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
 await assert.rejects(readBoundedBytes(new Response(body,{headers:{"content-length":"512001"}}),512000),/exceeded/);assert.equal(cancelled,true);
});
test("capture never changes due eligibility, request headers, schedules or observations",async()=>{
 let calls=0;
 const counted:typeof fetch=async(input,init)=>{calls++;assert.equal(String(input),normalizeSourceUrl(source.url));assert.equal(new Headers(init?.headers).get("user-agent"),SOURCE_USER_AGENT);return fetcher(input,init);};
 const before=await monitorLeadershipSources({fetchImpl:counted,pack,now:at,states:new Map([[source.id,held]]),captureMarkupSourceIds:new Set([source.id]),markupClock:clock});assert.equal(calls,0);assert.equal(before.snapshots.length,0);
 const ordinary=await monitorLeadershipSources({fetchImpl:counted,pack,now:at});
 const captured=await monitorLeadershipSources({fetchImpl:counted,pack,now:at,captureMarkupSourceIds:new Set([source.id]),markupClock:clock});
 assert.equal(calls,2);assert.ok(captured.snapshots[0].markupCapture);
 const stripped={...captured.snapshots[0]};delete stripped.markupCapture;assert.deepEqual(stripped,ordinary.snapshots[0]);assert.deepEqual(captured.schedule,ordinary.schedule);assert.deepEqual(captured.observations,ordinary.observations);
});
test("no capture table reads outside flag/window and read/write failure leaves collector usable",async()=>{
 let calls=0;const db={prepare(){calls++;throw new Error("unavailable");}} as unknown as D1DatabaseLike;
 for(const flag of [undefined,"false","TRUE"])assert.equal((await selectMarkupCaptureSources(db,flag,at,at)).size,0);
 assert.equal((await selectMarkupCaptureSources(db,"true",new Date(MARKUP_CAPTURE_END),at)).size,0);
 assert.equal((await selectMarkupCaptureSources(db,"true",at,new Date(MARKUP_CAPTURE_END))).size,0);assert.equal(calls,0);
 assert.equal((await selectMarkupCaptureSources(db,"true",at,at)).size,0);assert.equal(calls,1);
 const result=await persistMarkupCaptures(db,[await snapshot()],clock);assert.deepEqual(result,{attempted:0,failed:1});
});
test("one immutable row per fixed source, bounded table, and idempotent retention",async()=>{
 const {sqlite,db}=database();try{
 const row=await snapshot();await persistMarkupCaptures(db,[row],clock);
 const first=sqlite.prepare("SELECT * FROM leadership_markup_captures").get() as any;
 assert.equal(first.source_id,source.id);assert.equal(first.final_url,row.finalUrl);assert.equal(first.scheduled_at,at.toISOString());
 await persistMarkupCaptures(db,[{...row,markupCapture:{...row.markupCapture!,rawSha256:"f".repeat(64)}}],clock);
 assert.deepEqual(sqlite.prepare("SELECT * FROM leadership_markup_captures").get(),first);
 const remaining=await selectMarkupCaptureSources(db,"true",at,at);assert.equal(remaining.size,6);assert.equal(remaining.has(source.id),false);assert.equal(remaining.has("src-jefferson-enterprise-leadership"),false);
 assert.equal(Object.keys(MARKUP_CAPTURE_SOURCES).length,7);
 assert.throws(()=>sqlite.prepare("UPDATE leadership_markup_captures SET byte_count=512001").run(),/CHECK/);
 assert.throws(()=>sqlite.prepare("UPDATE leadership_markup_captures SET source_id='other'").run(),/CHECK/);
 }finally{sqlite.close();}
});
test("non-HTML, blocked, off-host and suffix-only responses supply no full markup proof",async()=>{
 for(const response of [new Response("blocked",{status:403}),new Response("json",{headers:{"content-type":"application/json"}}),new Response("missing type")]){
 const page=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),fetchImpl:async()=>response,retainMarkupBytes:true,markupClock:clock});assert.equal(await makeMarkupCapture(source.id,source.url,source.url,page),undefined);
 }
 let calls=0;
 const redirect=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:"https://example.net/private"}});},retainMarkupBytes:true});assert.equal(redirect.ok,false);assert.equal(calls,1);
 const suffix=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),fetchImpl:fetcher,scanMaxBytes:512000,retainSuffixBytes:20,retainMarkupBytes:true,markupClock:clock});assert.ok(suffix.ok);assert.equal(suffix.markupResponse,undefined);
});
test("receipt hard stop and fixed source URL prevent accidental capture expansion",async()=>{
 for(const date of ["invalid",new Date(Date.parse(MARKUP_CAPTURE_START)-1).toISOString(),MARKUP_CAPTURE_END])assert.equal(markupCaptureWindow(new Date(date)),false);
 const row=await snapshot();
 const expired=await monitorLeadershipSources({fetchImpl:fetcher,pack,now:at,captureMarkupSourceIds:new Set([source.id]),markupClock:()=>new Date(MARKUP_CAPTURE_END)});assert.equal(expired.snapshots[0].markupCapture,undefined);
 const other=await makeMarkupCapture("src-jefferson-enterprise-leadership",source.url,source.url,{ok:true,url:source.url,body:html});assert.equal(other,undefined);
 assert.ok(row.markupCapture);
});
test("validated redirects and selected alternates retain matching response provenance",async()=>{
 const alternate=source.url+"/alternate";
 const alternatePack={...pack,sources:[{...source,alternateUrls:[alternate]}]};let calls=0;
 const result=await monitorLeadershipSources({pack:alternatePack,now:at,captureMarkupSourceIds:new Set([source.id]),markupClock:clock,fetchImpl:async(input)=>{calls++;return String(input)===normalizeSourceUrl(source.url)?new Response("<html><body>no roster</body></html>",{headers:{"content-type":"text/html"}}):new Response(html,{headers:{"content-type":"text/html"}});}});
 assert.equal(calls,2);const row=result.snapshots[0];assert.equal(row.finalUrl,normalizeSourceUrl(alternate));assert.equal(row.markupCapture!.attemptedUrl,alternate);assert.equal(Buffer.from(row.markupCapture!.rawMarkupBase64,"base64").toString(),html);
 const redirected=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host, source.host.replace(/^www\./, "")]),markupClock:clock,retainMarkupBytes:true,fetchImpl:async(input)=>String(input)===normalizeSourceUrl(source.url)?new Response(null,{status:301,headers:{location:source.url+"/"}}):new Response(html,{headers:{"content-type":"text/html"}})});assert.ok(redirected.ok);assert.equal(redirected.url,source.url+"/");assert.ok(redirected.markupResponse);
});

test("a response crossing the receipt deadline is discarded without altering collection",async()=>{
 let clocks=0;
 const result=await monitorLeadershipSources({fetchImpl:fetcher,pack,now:at,captureMarkupSourceIds:new Set([source.id]),markupClock:()=>++clocks===1?at:new Date(MARKUP_CAPTURE_END)});
 assert.equal(clocks,2);assert.equal(result.snapshots[0].markupCapture,undefined);const baseline=await monitorLeadershipSources({fetchImpl:fetcher,pack,now:at});assert.deepEqual(result.schedule,baseline.schedule);assert.deepEqual(result.observations,baseline.observations);assert.equal(result.snapshots[0].state,baseline.snapshots[0].state);
});
test("maximum raw payload remains within the bounded SQL row and uses bound values",async()=>{
 const bytes=new Uint8Array(512000).fill(97);
 const page=await fetchAllowlistedArticlePage({url:source.url,allowedHosts:new Set([source.host,source.host.replace(/^www\./,"")]),fetchImpl:async()=>new Response(bytes,{headers:{"content-type":"text/html"}}),maxBytes:512000,retainMarkupBytes:true,markupClock:clock});
 const capture=await makeMarkupCapture(source.id,source.url,source.url,page);assert.ok(capture);assert.equal(capture.rawMarkupBase64.length,682668);
 const {sqlite,db}=database();try{await persistMarkupCaptures(db,[{...await snapshot(),markupCapture:capture}],clock);assert.equal((sqlite.prepare("SELECT byte_count, length(raw_markup_base64) AS encoded FROM leadership_markup_captures").get() as any).encoded,682668);}finally{sqlite.close();}
});

test("response accepted before cutoff cannot be submitted at or after cutoff",async()=>{
 const {sqlite,db}=database();try{
  const row=await snapshot();assert.ok(row.markupCapture);
  for(const instant of [MARKUP_CAPTURE_END,new Date(Date.parse(MARKUP_CAPTURE_END)+1).toISOString()]){
   assert.deepEqual(await persistMarkupCaptures(db,[row],()=>new Date(instant)),{attempted:0,failed:0});
  }
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM leadership_markup_captures").get() as any).n,0);
 }finally{sqlite.close();}
});
test("database rejects a queued insert executing after cutoff despite an earlier app clock",async()=>{
 const {sqlite,db}=database(()=>new Date(MARKUP_CAPTURE_END));try{
  const row=await snapshot();assert.deepEqual(await persistMarkupCaptures(db,[row],clock),{attempted:0,failed:1});
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM leadership_markup_captures").get() as any).n,0);
 }finally{sqlite.close();}
});
test("fixed retention expiry purges private rows with DB time, without enabling capture",async()=>{
 let dbTime=at;const {sqlite,db}=database(()=>dbTime);try{
  await persistMarkupCaptures(db,[await snapshot()],clock);
  const stored=sqlite.prepare("SELECT inserted_at,expires_at FROM leadership_markup_captures").get() as any;
  assert.equal(stored.inserted_at,at.toISOString());assert.equal(stored.expires_at,MARKUP_CAPTURE_RETENTION_END);
  const expiry=new Date(MARKUP_CAPTURE_RETENTION_END);
  assert.deepEqual(await purgeExpiredMarkupCaptures(db,new Date(expiry.getTime()-1)),{attempted:false,failed:false});
  // Fast app clock cannot erase data before the database reaches the expiry.
  await purgeExpiredMarkupCaptures(db,expiry);assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM leadership_markup_captures").get() as any).n,1);
  dbTime=expiry;assert.deepEqual(await purgeExpiredMarkupCaptures(db,expiry),{attempted:true,failed:false});
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM leadership_markup_captures").get() as any).n,0);
  assert.deepEqual(await purgeExpiredMarkupCaptures(db,expiry),{attempted:true,failed:false});
 }finally{sqlite.close();}
});
test("retention is inert before expiry and cleanup failures do not change collection",async()=>{
 let queries=0;const db={prepare(){queries++;throw new Error("missing capture table");}} as unknown as D1DatabaseLike;
 assert.deepEqual(await purgeExpiredMarkupCaptures(db,at),{attempted:false,failed:false});assert.equal(queries,0);
 assert.deepEqual(await purgeExpiredMarkupCaptures(db,new Date(MARKUP_CAPTURE_RETENTION_END)),{attempted:true,failed:true});assert.equal(queries,1);
 const ordinary=await monitorLeadershipSources({fetchImpl:fetcher,pack,now:at});assert.equal(ordinary.snapshots[0].state,"failed");assert.equal(ordinary.snapshots[0].extractionStatus,"unrecognized");
});

test("real SQLite database clock enforces the trigger independently of the app clock",async()=>{
 const {sqlite,db}=database(null);try{
  const sqlNow=(sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS current_time").get() as any).current_time;
  const result=await persistMarkupCaptures(db,[await snapshot()],clock);
  assert.deepEqual(result,markupCaptureWindow(new Date(sqlNow))?{attempted:1,failed:0}:{attempted:0,failed:1});
 }finally{sqlite.close();}
});

test("new window cannot reactivate the expired October5 interval or read the table early",async()=>{
 let queries=0;const db={prepare(){queries++;throw new Error("must not read");}} as unknown as D1DatabaseLike;
 const expired=new Date("2026-10-05T03:30:00.000Z");
 assert.equal(markupCaptureWindow(expired),false);assert.equal((await selectMarkupCaptureSources(db,"true",expired,expired)).size,0);assert.equal(queries,0);
 const before=new Date(Date.parse(MARKUP_CAPTURE_START)-1);assert.equal((await selectMarkupCaptureSources(db,"true",before,before)).size,0);assert.equal(queries,0);
});
test("October6 02:30 window opening does not advance the existing 02:31 source hold",async()=>{
 const opening=new Date(MARKUP_CAPTURE_START),due=new Date("2026-10-06T02:31:00.122Z");let calls=0;
 const prior={...held,nextAttemptAt:due.toISOString(),consecutiveFailures:3};
 const fetchImpl:typeof fetch=async(input,init)=>{calls++;return fetcher(input,init);};
 const early=await monitorLeadershipSources({pack,states:new Map([[source.id,prior]]),now:opening,fetchImpl,captureMarkupSourceIds:new Set([source.id]),markupClock:()=>opening});assert.equal(calls,0);assert.equal(early.snapshots.length,0);
 const normalDue=await monitorLeadershipSources({pack,states:new Map([[source.id,prior]]),now:due,fetchImpl,captureMarkupSourceIds:new Set([source.id]),markupClock:()=>due});assert.equal(calls,1);assert.ok(normalDue.snapshots[0].markupCapture);
});
test("SQL accepts the inclusive opening and rejects DB execution before it",async()=>{
 const opening=new Date(MARKUP_CAPTURE_START);
 const row=(await monitorLeadershipSources({pack,now:opening,fetchImpl:fetcher,captureMarkupSourceIds:new Set([source.id]),markupClock:()=>opening})).snapshots[0]!;
 for(const [offset,expected] of [[-1,{attempted:0,failed:1}],[0,{attempted:1,failed:0}]] as const){
  const {sqlite,db}=database(()=>new Date(opening.getTime()+offset));try{assert.deepEqual(await persistMarkupCaptures(db,[row],()=>opening),expected);}finally{sqlite.close();}
 }
});
