import assert from "node:assert/strict";
import { test } from "node:test";
import catalog from "../src/content/published-catalog.json";
import { EventItem } from "../src/content/schema";
import { syncPublishedEventCalendar } from "../src/ingest/event-calendar-runtime";
import { pdfDatabase } from "./helpers/policy-pdf";
import type { D1DatabaseLike } from "../src/ingest/persistence";

const at=new Date("2026-09-12T18:00:00.000Z");
function seeded() {
  const fixture=pdfDatabase(), {sqlite}=fixture;
  const event=EventItem.parse(catalog.find(item=>item.kind==="event"));
  const updated={...event,title:"Revised regional conference",updatedAt:at.toISOString()};
  sqlite.prepare("INSERT INTO ingest_runs(id,started_at,state) VALUES('calendar-runtime',?,'succeeded')").run(at.toISOString());
  sqlite.prepare(`INSERT INTO content_candidates
    (id,fingerprint,kind,title,source_origin,item_status,content_json,first_seen_at,last_seen_at,last_run_id)
    VALUES(?,?,'event',?,'test','published',?,?,?,'calendar-runtime')`)
    .run(event.id,event.id,event.title,JSON.stringify(updated),at.toISOString(),at.toISOString());
  const publish=()=>sqlite.prepare(`INSERT INTO published_content
    (candidate_id,id,kind,slug,content_json,policy_version,decision_json,first_published_at,updated_at)
    VALUES(?,?,'event',?,?,'test','{}',?,?)`)
    .run(event.id,event.id,event.slug,JSON.stringify(updated),at.toISOString(),at.toISOString());
  const withdraw=()=>{
    sqlite.prepare("DELETE FROM published_content WHERE candidate_id=?").run(event.id);
    sqlite.prepare("UPDATE content_candidates SET item_status='unpublished' WHERE id=?").run(event.id);
    sqlite.prepare(`INSERT INTO publication_reconciliations
      (candidate_id,source_id,action,missing_count,reason,run_id,reconciled_at)
      VALUES(?,'test','withdrawn',1,'test','calendar-runtime',?)`).run(event.id,at.toISOString());
  };
  publish();
  return {...fixture,event,publish,withdraw};
}

test("calendar runtime overlays approved publications, retains withdrawals and restores only republication",async()=>{
  const {db,sqlite,event,publish,withdraw}=seeded();
  const row=()=>sqlite.prepare("SELECT payload_json,withdrawn,sequence FROM event_calendar_entries WHERE event_id=?").get(event.id)!;
  try {
    await syncPublishedEventCalendar(db,at);
    assert.equal(JSON.parse(String(row().payload_json)).title,"Revised regional conference");
    withdraw();
    await syncPublishedEventCalendar(db,new Date(at.getTime()+1000));
    assert.equal(row().withdrawn,1);
    await syncPublishedEventCalendar(db,new Date(at.getTime()+2000));
    assert.equal(row().withdrawn,1);
    publish();
    await syncPublishedEventCalendar(db,new Date(at.getTime()+3000));
    assert.equal(row().withdrawn,0);
    assert.equal(row().sequence,2);
  } finally {sqlite.close();}
});

test("a publication change after snapshot read prevents calendar writes",async()=>{
  const {db,sqlite,event,withdraw}=seeded();
  let changed=false;
  const racing:D1DatabaseLike={prepare:db.prepare.bind(db),batch:async statements=>{
    if(!changed){changed=true;withdraw();}
    return db.batch(statements);
  }};
  try {
    await assert.rejects(syncPublishedEventCalendar(racing,at),/CHECK constraint/);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM event_calendar_entries WHERE event_id=?").get(event.id)?.n,0);
    await syncPublishedEventCalendar(db,new Date(at.getTime()+1000));
    assert.ok(sqlite.prepare("SELECT withdrawn_at FROM event_calendar_withdrawals WHERE event_id=?").get(event.id));
  } finally {sqlite.close();}
});

test("failed publication reads cannot turn into an empty calendar snapshot",async()=>{
  const {db,sqlite}=pdfDatabase();
  const broken:D1DatabaseLike={batch:db.batch.bind(db),prepare(sql){
    if(!sql.includes("SELECT content_json FROM published_content"))return db.prepare(sql);
    const statement={bind(){return statement;},async first(){return null;},async run(){return {};},
      async all<T>(){return {success:false,results:[] as T[]};}};
    return statement;
  }};
  try {await assert.rejects(syncPublishedEventCalendar(broken,at),/storage-unavailable/);}
  finally {sqlite.close();}
});
