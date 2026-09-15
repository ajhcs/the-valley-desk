import ICAL from "ical.js";
import { z } from "zod";
import { EventItem, type ContentItem } from "../content/schema";
import { CanonicalInstant, canonicalJson, sha256 } from "../content/watch-schema";
import { eventCopyMarksCancelled, eventSchedule, googleCalendarDates } from "../lib/calendar";
import { canonicalUrl, publicOrigin, resolvePublicOrigin } from "../lib/canonical";
import { cleanEventSourceMarkup } from "../lib/sourceMarkup";
import type { D1DatabaseLike, D1StatementLike } from "./persistence";

const MAX_EVENTS=500, MAX_MAINTENANCE_EVENTS=5000, MAX_FEED_BYTES=2_000_000;
const Text=z.string().max(8000);
export const CalendarPayload=z.object({id:z.string().min(1).max(500),title:Text,description:Text,location:Text,url:z.string().url(),
  timeKind:z.enum(["timed","date-only","time-tbd"]),start:z.string(),end:z.string().nullable(),
  status:z.enum(["CONFIRMED","TENTATIVE","CANCELLED"])}).strict();
type CalendarPayload=z.infer<typeof CalendarPayload>;
type Entry={event_id:string;uid:string;sequence:number;payload_sha256:string;payload_json:string;revision_at:string;withdrawn:number};
const text=(value:string)=>cleanEventSourceMarkup(value).replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").slice(0,8000);
const uidFor=(id:string)=>sha256(id).then(hash=>hash+"@thevalleydesk.org");
function payloadFor(input:ContentItem,origin:string):CalendarPayload {
  const item=EventItem.parse(input),schedule=eventSchedule(item);
  if(item.endsAt && Date.parse(item.endsAt)<Date.parse(item.startsAt))throw Error("calendar-invalid-interval");
  const dates=schedule.kind==="timed"?null:googleCalendarDates(item).split("/");
  return CalendarPayload.parse({id:item.id,title:text(item.title),description:text(item.body),
    location:text(item.venue??item.city??item.geo??""),url:canonicalUrl(item,resolvePublicOrigin(origin)),
    timeKind:schedule.kind,start:dates?.[0]??new Date(item.startsAt).toISOString(),
    end:dates?.[1]??(item.endsAt?new Date(item.endsAt).toISOString():null),
    status:eventCopyMarksCancelled(item)?"CANCELLED":schedule.kind==="time-tbd"?"TENTATIVE":"CONFIRMED"});
}
async function writeRevision(db:D1DatabaseLike,payload:CalendarPayload,withdrawn:boolean,now:string,restored=false,guards:()=>D1StatementLike[]=()=>[]) {
  const previous=await db.prepare("SELECT * FROM event_calendar_entries WHERE event_id=?").bind(payload.id).first<Entry>();
  const tombstone=await db.prepare("SELECT withdrawn_at,restored_at FROM event_calendar_withdrawals WHERE event_id=?")
    .bind(payload.id).first<{withdrawn_at:string;restored_at:string|null}>();
  const active=tombstone && tombstone.restored_at===null;
  if(active && !withdrawn && (!restored || now<=tombstone.withdrawn_at))return "unchanged" as const;
  if(withdrawn && (!active || tombstone.withdrawn_at>now))return "unchanged" as const;
  if(previous?.withdrawn && !withdrawn && !restored)return "unchanged" as const;
  const json=canonicalJson(payload),digest=await sha256(json);
  if(previous?.payload_sha256===digest && previous.withdrawn===Number(withdrawn))return "unchanged" as const;
  if(previous && now<previous.revision_at)throw Error("calendar-revision-time-conflict");
  const sequence=(previous?.sequence??-1)+1,uid=previous?.uid??await uidFor(payload.id);
  try {
    await db.batch([
      ...guards(),
      db.prepare(`INSERT INTO event_calendar_write_guards SELECT ?,CASE WHEN
        (SELECT withdrawn_at FROM event_calendar_withdrawals WHERE event_id=?) IS ?
        AND (SELECT restored_at FROM event_calendar_withdrawals WHERE event_id=?) IS ?
        THEN 1 ELSE 0 END`).bind(crypto.randomUUID(),payload.id,tombstone?.withdrawn_at??null,payload.id,tombstone?.restored_at??null),
      ...(!withdrawn && active && restored?[db.prepare("UPDATE event_calendar_withdrawals SET restored_at=? WHERE event_id=? AND withdrawn_at<? AND restored_at IS NULL")
        .bind(now,payload.id,now)]:[]),
      db.prepare(`INSERT INTO event_calendar_entries VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
        sequence=excluded.sequence,payload_sha256=excluded.payload_sha256,payload_json=excluded.payload_json,
        revision_at=excluded.revision_at,withdrawn=excluded.withdrawn WHERE event_calendar_entries.sequence=?`)
        .bind(payload.id,uid,sequence,digest,json,now,withdrawn?1:0,previous?.sequence??-1),
      db.prepare("INSERT INTO event_calendar_revisions VALUES(?,?,?,?,?)").bind(payload.id,sequence,digest,json,now),
    ]);
  }catch(error){
    const concurrent=await db.prepare("SELECT payload_sha256,withdrawn FROM event_calendar_entries WHERE event_id=?")
      .bind(payload.id).first<Pick<Entry,"payload_sha256"|"withdrawn">>();
    if(concurrent?.payload_sha256===digest && concurrent.withdrawn===Number(withdrawn))return "unchanged" as const;
    throw error;
  }
  return "changed" as const;
}

/** Trusted published-catalog maintenance, called inside the existing ingestion lock.
 * Missing feed items never imply withdrawal. Only explicit durable tombstone IDs do. */
export async function maintainEventCalendar(db:D1DatabaseLike,items:readonly ContentItem[],withdrawnIds:readonly string[],
  now=new Date(),origin=publicOrigin(),restoredIds:readonly string[]=[],guards:()=>D1StatementLike[]=()=>[]) {
  const at=CanonicalInstant.parse(now.toISOString()),withdrawn=new Set(withdrawnIds);
  const events=items.filter(item=>item.kind==="event" && item.status==="published");
  if(events.length>MAX_MAINTENANCE_EVENTS || withdrawn.size>1000 || restoredIds.length>MAX_MAINTENANCE_EVENTS)throw Error("calendar-maintenance-limit");
  const restored=new Set(restoredIds);
  const unique=new Map<string,ContentItem>();for(const item of events){
    if(unique.has(item.id))throw Error("calendar-duplicate-input");unique.set(item.id,item);
  }
  let changed=0;
  for(const item of unique.values()){
    if(withdrawn.has(item.id))continue;
    const outcome=await writeRevision(db,payloadFor(item,origin),false,at,restored.has(item.id),guards);
    if(outcome==="changed")changed++;
  }
  for(const id of withdrawn){
    // A withdrawal must survive even when no calendar entry has existed yet.
    // A later confirmed withdrawal also invalidates an in-flight restoration.
    await db.batch([...guards(),db.prepare(`INSERT INTO event_calendar_withdrawals VALUES(?,?,NULL)
      ON CONFLICT(event_id) DO UPDATE SET withdrawn_at=excluded.withdrawn_at,restored_at=NULL
      WHERE excluded.withdrawn_at>event_calendar_withdrawals.withdrawn_at
        AND (event_calendar_withdrawals.restored_at IS NULL OR excluded.withdrawn_at>event_calendar_withdrawals.restored_at)`)
      .bind(id,at)]);
    const row=await db.prepare("SELECT * FROM event_calendar_entries WHERE event_id=?").bind(id).first<Entry>();
    if(!row || row.withdrawn)continue;
    const payload=CalendarPayload.parse(JSON.parse(row.payload_json));
    if(await sha256(canonicalJson(payload))!==row.payload_sha256)throw Error("calendar-payload-integrity");
    if(await writeRevision(db,{...payload,status:"CANCELLED",description:""},true,at,false,guards)==="changed")changed++;
  }
  return {changed,considered:unique.size,withdrawals:withdrawn.size};
}

function calendarDate(value:string,dateOnly:boolean) {
  return dateOnly?ICAL.Time.fromDateString(value.replace(/^(\d{4})(\d{2})(\d{2})$/,"$1-$2-$3"))
    :ICAL.Time.fromJSDate(new Date(value),true);
}
export async function serializeEventCalendar(db:D1DatabaseLike,now=new Date()) {
  const instant=CanonicalInstant.parse(now.toISOString());
  const past=new Date(now.getTime()-90*86400000).toISOString(),future=new Date(now.getTime()+365*86400000).toISOString();
  const pastDay=past.slice(0,10).replaceAll("-",""),futureDay=future.slice(0,10).replaceAll("-","");
  const result=await db.prepare(`SELECT * FROM event_calendar_entries WHERE revision_at<=? AND (
    (json_extract(payload_json,'$.timeKind')='timed'
      AND COALESCE(json_extract(payload_json,'$.end'),json_extract(payload_json,'$.start'))>=?
      AND json_extract(payload_json,'$.start')<=?)
    OR (json_extract(payload_json,'$.timeKind')<>'timed'
      AND COALESCE(json_extract(payload_json,'$.end'),json_extract(payload_json,'$.start'))>=?
      AND json_extract(payload_json,'$.start')<=?)
    OR (json_extract(payload_json,'$.status')='CANCELLED' AND revision_at>=?))
    ORDER BY event_id LIMIT ?`).bind(instant,past,future,pastDay,futureDay,past,MAX_EVENTS+1).all<Entry>();
  if(!Array.isArray(result.results) || ("success" in result && result.success===false))throw Error("calendar-storage-unavailable");
  const rows=result.results;
  if(rows.length>MAX_EVENTS)throw Error("calendar-feed-limit");
  const calendar=new ICAL.Component("vcalendar");
  calendar.updatePropertyWithValue("version","2.0");
  calendar.updatePropertyWithValue("prodid","-//The Valley Desk//Events//EN");
  calendar.updatePropertyWithValue("calscale","GREGORIAN");
  calendar.updatePropertyWithValue("x-wr-calname","The Valley Desk Events");
  let modified:string|null=null;
  for(const row of rows){
    const payload=CalendarPayload.parse(JSON.parse(row.payload_json));CanonicalInstant.parse(row.revision_at);
    if(payload.id!==row.event_id || row.uid!==await uidFor(row.event_id) || await sha256(canonicalJson(payload))!==row.payload_sha256 ||
        !Number.isSafeInteger(row.sequence) || row.sequence<0)throw Error("calendar-payload-integrity");
    const event=new ICAL.Component("vevent"),dateOnly=payload.timeKind!=="timed";
    event.updatePropertyWithValue("uid",row.uid);event.updatePropertyWithValue("sequence",row.sequence);
    event.updatePropertyWithValue("dtstamp",calendarDate(row.revision_at,false));
    event.updatePropertyWithValue("last-modified",calendarDate(row.revision_at,false));
    event.updatePropertyWithValue("dtstart",calendarDate(payload.start,dateOnly));
    if(payload.end)event.updatePropertyWithValue("dtend",calendarDate(payload.end,dateOnly));
    event.updatePropertyWithValue("summary",(payload.timeKind==="time-tbd"?"Time TBD: ":"")+payload.title);
    event.updatePropertyWithValue("description",payload.description);
    event.updatePropertyWithValue("location",payload.location);event.updatePropertyWithValue("url",payload.url);
    event.updatePropertyWithValue("status",payload.status);
    event.updatePropertyWithValue("transp",payload.status==="CANCELLED"||payload.timeKind==="time-tbd"?"TRANSPARENT":"OPAQUE");
    if(payload.timeKind==="time-tbd")event.updatePropertyWithValue("x-valley-desk-time-status","TBD");
    calendar.addSubcomponent(event);
    if(!modified || row.revision_at>modified)modified=row.revision_at;
  }
  // ICAL.js counts folded continuation content separately from its leading space.
  const previousFoldLength=ICAL.foldLength;let body:string;
  try{ICAL.foldLength=74;body=calendar.toString()+"\r\n";}finally{ICAL.foldLength=previousFoldLength;}
  if(new TextEncoder().encode(body).byteLength>MAX_FEED_BYTES)throw Error("calendar-feed-byte-limit");
  return {body,etag:'"'+await sha256(body)+'"',lastModified:modified?new Date(modified).toUTCString():null};
}

export async function handleEventCalendar(request:Request,env:{VALLEY_DESK_DB?:D1DatabaseLike;EVENT_CALENDAR_PUBLIC_ENABLED?:string},now=new Date()) {
  const headers=new Headers({"content-type":"text/calendar; charset=utf-8","cache-control":"public, max-age=300",
    "content-disposition":'inline; filename="the-valley-desk-events.ics"',"x-content-type-options":"nosniff"});
  if(!["GET","HEAD"].includes(request.method)){headers.set("allow","GET, HEAD");return new Response(null,{status:405,headers});}
  if(env.EVENT_CALENDAR_PUBLIC_ENABLED!=="true" || !env.VALLEY_DESK_DB){headers.set("cache-control","no-store");return new Response(null,{status:503,headers});}
  try{
    const result=await serializeEventCalendar(env.VALLEY_DESK_DB,now);headers.set("etag",result.etag);
    if(result.lastModified)headers.set("last-modified",result.lastModified);
    const inm=request.headers.get("if-none-match");
    const match=inm?.split(",").some(value=>value.trim()==="*" || value.trim().replace(/^W\//,"")===result.etag);
    if(match)return new Response(null,{status:304,headers});
    // Rolling feed membership can change without any event revision. Only the
    // body ETag, not a material-event Last-Modified clock, proves a 304 response.
    return new Response(request.method==="HEAD"?null:result.body,{headers});
  }catch{
    headers.set("cache-control","no-store");return new Response(null,{status:503,headers});
  }
}
