import assert from "node:assert/strict";
import { test } from "node:test";
import ICAL from "ical.js";
import { EventItem } from "../src/content/schema";
import { handleEventCalendar as handleCalendar, maintainEventCalendar, serializeEventCalendar as serializeCalendar } from "../src/ingest/event-calendar";
import { cleanEventSourceMarkup } from "../src/lib/sourceMarkup";
import { calendarSubscriptionUrls } from "../src/lib/calendarSubscription";
import { pdfDatabase } from "./helpers/policy-pdf";
import type { D1DatabaseLike } from "../src/ingest/persistence";

const at = new Date("2026-09-12T17:00:00.000Z");
const later = new Date("2026-09-12T18:00:00.000Z");
const serializeEventCalendar=(db:D1DatabaseLike)=>serializeCalendar(db,later);
const handleEventCalendar=(request:Request,env:Parameters<typeof handleCalendar>[1])=>handleCalendar(request,env,later);
const item = (extra: Record<string, unknown> = {}) => EventItem.parse({
  id: "calendar-test", slug: "calendar-test", kind: "event", title: "Regional forum", dek: "Public event",
  body: "Healthcare technology discussion", status: "published", updatedAt: at.toISOString(),
  topics: [], orgs: [], region: "PA", authors: [], source: {kind: "ingest", origin: "test"},
  startsAt: "2026-10-12T14:00:00.000Z", timezone: "America/New_York", hostOrg:"Regional chapter", partner:"chapter", ...extra,
});
const event = (body: string) => new ICAL.Component(ICAL.parse(body)).getFirstSubcomponent("vevent")!;

test("calendar persists stable identity and only increments material revisions", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    assert.equal((await maintainEventCalendar(db, [item()], [], at)).changed, 1);
    const original = await serializeEventCalendar(db);
    assert.equal(event(original.body).getFirstPropertyValue("sequence"), 0);
    assert.equal((await maintainEventCalendar(db, [item({updatedAt: later.toISOString(), source: {kind:"ingest", origin:"test", fetchedAt:later.toISOString()}})], [], later)).changed, 0);
    assert.deepEqual(await serializeEventCalendar(db), original);
    await maintainEventCalendar(db, [item({title:"Revised forum", startsAt:"2026-10-13T14:00:00.000Z"})], [], later);
    const revised = await serializeEventCalendar(db);
    assert.equal(event(revised.body).getFirstPropertyValue("uid"), event(original.body).getFirstPropertyValue("uid"));
    assert.equal(event(revised.body).getFirstPropertyValue("sequence"), 1);
    assert.notEqual(revised.etag, original.etag);
    assert.equal(revised.lastModified, later.toUTCString());
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM event_calendar_revisions").get()?.n, 2);
    assert.throws(() => sqlite.exec("DELETE FROM event_calendar_revisions"), /calendar-history-retained/);
  } finally { sqlite.close(); }
});

test("absence never cancels; explicit withdrawal retains cancellation and cannot resurrect", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item()], [], at);
    const original = await serializeEventCalendar(db);
    await maintainEventCalendar(db, [], [], later);
    assert.deepEqual(await serializeEventCalendar(db), original);
    await maintainEventCalendar(db, [], [item().id], later);
    const cancelled = await serializeEventCalendar(db), parsed = event(cancelled.body);
    assert.equal(parsed.getFirstPropertyValue("status"), "CANCELLED");
    assert.equal(parsed.getFirstPropertyValue("sequence"), 1);
    assert.equal(parsed.getFirstPropertyValue("summary"), item().title);
    assert.equal(parsed.getFirstPropertyValue("description"), "");
    assert.equal(parsed.getFirstPropertyValue("uid"), event(original.body).getFirstPropertyValue("uid"));
    await maintainEventCalendar(db, [item()], [], later);
    assert.deepEqual(await serializeEventCalendar(db), cancelled);
    await maintainEventCalendar(db, [item()], [], new Date(later.getTime()+1), "https://thevalleydesk.org", [item().id]);
    const restored = event((await serializeCalendar(db,new Date(later.getTime()+1))).body);
    assert.equal(restored.getFirstPropertyValue("status"), "CONFIRMED");
    assert.equal(restored.getFirstPropertyValue("sequence"), 2);
    assert.equal(restored.getFirstPropertyValue("uid"), event(original.body).getFirstPropertyValue("uid"));
  } finally { sqlite.close(); }
});

test("source cancellation and later correction each produce a new sequence", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item()], [], at);
    await maintainEventCalendar(db, [item({cancelled:true})], [], later);
    assert.equal(event((await serializeEventCalendar(db)).body).getFirstPropertyValue("status"), "CANCELLED");
    await maintainEventCalendar(db, [item()], [], later);
    const parsed = event((await serializeEventCalendar(db)).body);
    assert.equal(parsed.getFirstPropertyValue("status"), "CONFIRMED");
    assert.equal(parsed.getFirstPropertyValue("sequence"), 2);
  } finally { sqlite.close(); }
});

test("date-only DST span uses exclusive civil end and unknown clocks stay explicit", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item({startsAt:"2026-10-31T04:00:00.000Z",endsAt:"2026-11-02T05:00:00.000Z"})], [], at);
    const parsed = event((await serializeEventCalendar(db)).body);
    assert.equal(String(parsed.getFirstPropertyValue("dtstart")), "2026-10-31");
    assert.equal(String(parsed.getFirstPropertyValue("dtend")), "2026-11-03");
    await maintainEventCalendar(db, [item({startsAt:"2026-10-31T04:00:00.000Z"})], [], later);
    const tbd = event((await serializeEventCalendar(db)).body);
    assert.equal(tbd.getFirstPropertyValue("status"), "TENTATIVE");
    assert.equal(tbd.getFirstPropertyValue("transp"), "TRANSPARENT");
    assert.equal(tbd.getFirstPropertyValue("x-valley-desk-time-status"), "TBD");
    assert.equal(tbd.getFirstPropertyValue("summary"), "Time TBD: Regional forum");
  } finally { sqlite.close(); }
});

test("serializer escapes text, folds UTF-8, and never invents an unknown end", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    const body = "First; second, third\\fourth\n" + "\u00e9".repeat(120);
    await maintainEventCalendar(db, [item({body})], [], at);
    const feed = await serializeEventCalendar(db);
    assert.equal(event(feed.body).getFirstPropertyValue("description"), body);
    assert.equal(event(feed.body).getFirstProperty("dtend"), null);
    for (const line of feed.body.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
    assert.ok(feed.body.endsWith("\r\n"));
  } finally { sqlite.close(); }
});

test("calendar HTTP supports conditional GET, HEAD and fail-closed availability", async () => {
  const {db, sqlite} = pdfDatabase();
  const req = (init?: RequestInit) => new Request("https://thevalleydesk.org/events.ics", init);
  const env = {VALLEY_DESK_DB:db, EVENT_CALENDAR_PUBLIC_ENABLED:"true"};
  try {
    assert.equal((await handleEventCalendar(req(), {VALLEY_DESK_DB:db})).status, 503);
    await maintainEventCalendar(db, [item()], [], at);
    const response = await handleEventCalendar(req(), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/calendar/);
    const conditional = await handleEventCalendar(req({headers:{"if-none-match":"W/"+response.headers.get("etag")}}), env);
    assert.equal(conditional.status, 304);
    assert.equal(await conditional.text(), "");
    assert.equal((await handleEventCalendar(req({headers:{"if-modified-since":at.toUTCString()}}), env)).status, 200);
    const head = await handleEventCalendar(req({method:"HEAD"}), env);
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
    assert.equal((await handleEventCalendar(req({method:"POST"}), env)).status, 405);
  } finally { sqlite.close(); }
});

test("calendar rejects invalid or oversized maintenance and preserves previous revision", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item()], [], at);
    const before = await serializeEventCalendar(db);
    await assert.rejects(maintainEventCalendar(db, [item({endsAt:"2026-10-01T00:00:00.000Z"})], [], later), /invalid-interval/);
    await assert.rejects(maintainEventCalendar(db, [item(), item()], [], later), /duplicate-input/);
    await assert.rejects(maintainEventCalendar(db, Array.from({length:5001},(_,i)=>item({id:String(i)})), [], later), /maintenance-limit/);
    await assert.rejects(maintainEventCalendar(db, [item({title:"Changed"})], [], new Date("2026-09-11T00:00:00.000Z")), /time-conflict/);
    assert.deepEqual(await serializeEventCalendar(db), before);
  } finally { sqlite.close(); }
});

test("known DVHIMSS residue is removed without deleting event prose or unknown brackets", () => {
  // Literal source-derived excerpt from retained evt-dvhimss-22958 readback.
  const excerpt = '[vc_row][vc_column][vc_column_text]The 19th Annual NJDVHIMSS Fall Conference Returns This October[/vc_column_text] '+
    '#default-btn-1e0d2335f97293128e6d58d1532c7a8e.ico-right-side > i { margin-right: 0px; margin-left: 8px; } Register Here[/vc_column][/vc_row]';
  assert.equal(cleanEventSourceMarkup(excerpt), "The 19th Annual NJDVHIMSS Fall Conference Returns This October Register Here");
  assert.equal(cleanEventSourceMarkup("[registration required] CSS .example { color: red; }"), "[registration required] CSS .example { color: red; }");
  assert.equal(cleanEventSourceMarkup("Before<style>.bad { color:red }</style>After"), "Before After");
});

test("failed history insertion rolls back calendar head and concurrent exact retry is idempotent", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item()], [], at);
    const before = await serializeEventCalendar(db);
    sqlite.exec("CREATE TRIGGER fail_calendar_test BEFORE INSERT ON event_calendar_revisions BEGIN SELECT RAISE(ABORT,'test-failure'); END");
    await assert.rejects(maintainEventCalendar(db, [item({title:"Changed"})], [], later), /test-failure/);
    assert.deepEqual(await serializeEventCalendar(db), before);
    sqlite.exec("DROP TRIGGER fail_calendar_test");
    let raced = false;
    const interleaved: D1DatabaseLike = {...db, async batch(statements) {
      if (!raced) { raced = true; await maintainEventCalendar(db, [item({title:"Changed"})], [], later); }
      return db.batch(statements);
    }};
    assert.equal((await maintainEventCalendar(interleaved, [item({title:"Changed"})], [], later)).changed, 0);
    assert.equal(event((await serializeEventCalendar(db)).body).getFirstPropertyValue("sequence"), 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM event_calendar_revisions").get()?.n, 2);
  } finally { sqlite.close(); }
});

test("calendar response fails closed on corrupted persisted payload", async () => {
  const {db, sqlite} = pdfDatabase();
  try {
    await maintainEventCalendar(db, [item()], [], at);
    sqlite.exec("UPDATE event_calendar_entries SET sequence=sequence+1, payload_sha256='" + "0".repeat(64) + "'");
    const response = await handleEventCalendar(new Request("https://thevalleydesk.org/events.ics"), {VALLEY_DESK_DB:db, EVENT_CALENDAR_PUBLIC_ENABLED:"true"});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { sqlite.close(); }
});

test("subscription URLs retain HTTPS download and native calendar protocol", () => {
  const urls = calendarSubscriptionUrls("https://thevalleydesk.org");
  assert.equal(urls.download, "https://thevalleydesk.org/events.ics");
  assert.equal(urls.subscribe, "webcal://thevalleydesk.org/events.ics");
});

test("withdrawals before first capture persist and concurrent stale first writes roll back", async () => {
  const {db,sqlite}=pdfDatabase();
  try {
    await maintainEventCalendar(db,[],[item().id],later);
    assert.equal((await maintainEventCalendar(db,[item()],[],at)).changed,0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM event_calendar_entries").get()?.n,0);
    assert.equal((await maintainEventCalendar(db,[item()],[],later,"https://thevalleydesk.org",[item().id])).changed,0);
    const restoredAt=new Date(later.getTime()+1);
    assert.equal((await maintainEventCalendar(db,[item()],[],restoredAt,"https://thevalleydesk.org",[item().id])).changed,1);
    const racing=item({id:"calendar-racing",slug:"calendar-racing"});
    const interleaved:D1DatabaseLike={...db,async batch(statements) {
      await maintainEventCalendar(db,[],[racing.id],later);
      return db.batch(statements);
    }};
    await assert.rejects(maintainEventCalendar(interleaved,[racing],[],at),/CHECK constraint/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM event_calendar_entries WHERE event_id=?").get(racing.id)?.n,0);
  } finally {sqlite.close();}
});

test("new withdrawal during explicit restoration prevents stale restoration",async()=>{
  const {db,sqlite}=pdfDatabase();
  try{
    await maintainEventCalendar(db,[item()],[],at);
    await maintainEventCalendar(db,[],[item().id],new Date(at.getTime()+1));
    const interleaved:D1DatabaseLike={...db,async batch(statements){
      await maintainEventCalendar(db,[],[item().id],new Date(later.getTime()+1));
      return db.batch(statements);
    }};
    await assert.rejects(maintainEventCalendar(interleaved,[item()],[],later,"https://thevalleydesk.org",[item().id]),/CHECK constraint/);
    assert.equal(sqlite.prepare("SELECT withdrawn FROM event_calendar_entries").get()?.withdrawn,1);
  }finally{sqlite.close();}
});

test("calendar horizon preserves history, includes boundaries and recent old-event cancellations",async()=>{
  const {db,sqlite}=pdfDatabase();
  try{
    const beforePast=new Date(at.getTime()-90*86400000-1).toISOString();
    const past=new Date(at.getTime()-90*86400000).toISOString();
    const future=new Date(at.getTime()+365*86400000).toISOString();
    const afterFuture=new Date(at.getTime()+365*86400000+1).toISOString();
    const events=[
      ...Array.from({length:501},(_,i)=>item({id:"historic-"+i,slug:"historic-"+i,startsAt:beforePast})),
      item({id:"past-boundary",slug:"past-boundary",startsAt:past}),
      item({id:"future-boundary",slug:"future-boundary",startsAt:future}),
      item({id:"future-outside",slug:"future-outside",startsAt:afterFuture}),
    ];
    await maintainEventCalendar(db,events,[],at);
    await maintainEventCalendar(db,[],["historic-0"],at);
    const body=(await serializeCalendar(db,at)).body;
    const summaries=new ICAL.Component(ICAL.parse(body)).getAllSubcomponents("vevent");
    assert.equal(summaries.length,3);
    assert.equal(summaries.filter(value=>value.getFirstPropertyValue("status")==="CANCELLED").length,1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM event_calendar_entries").get()?.n,504);
    assert.equal((await handleCalendar(new Request("https://thevalleydesk.org/events.ics"),{VALLEY_DESK_DB:db,EVENT_CALENDAR_PUBLIC_ENABLED:"true"},at)).status,200);
    assert.notEqual((await serializeCalendar(db,new Date(at.getTime()+1))).etag,(await serializeCalendar(db,at)).etag);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM event_calendar_revisions").get()?.n,505);
  }finally{sqlite.close();}
});

test("more than 500 in-window events and failed D1 reads fail closed",async()=>{
  const {db,sqlite}=pdfDatabase();
  try{
    await maintainEventCalendar(db,Array.from({length:501},(_,i)=>item({id:"active-"+i,slug:"active-"+i})),[],at);
    await assert.rejects(serializeCalendar(db,at),/feed-limit/);
    for(const result of [{success:false,error:"synthetic"}, {results:null}, {results:[],success:false}]){
      const failed={prepare:()=>({bind(){return this;},async all(){return result;}})} as unknown as D1DatabaseLike;
      const response=await handleCalendar(new Request("https://thevalleydesk.org/events.ics"),{VALLEY_DESK_DB:failed,EVENT_CALENDAR_PUBLIC_ENABLED:"true"},at);
      assert.equal(response.status,503);assert.equal(response.headers.get("cache-control"),"no-store");
    }
  }finally{sqlite.close();}
});
