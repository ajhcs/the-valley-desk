import ICAL from "ical.js";
import { z } from "zod";
import { EventItem, type ContentItem } from "../content/schema";
import { CanonicalInstant, canonicalJson, sha256 } from "../content/watch-schema";
import { eventCopyMarksCancelled, eventSchedule, googleCalendarDates } from "../lib/calendar";
import { canonicalUrl, publicOrigin, resolvePublicOrigin } from "../lib/canonical";
import { cleanEventSourceMarkup } from "../lib/sourceMarkup";
import type { D1DatabaseLike } from "./persistence";

const MAX_EVENTS=500, MAX_FEED_BYTES=2_000_000;
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
async function writeRevision(db:D1DatabaseLike,payload:CalendarPayload,withdrawn:boolean,now:string) {
  const previous=await db.prepare("SELECT * FROM event_calendar_entries WHERE event_id=?").bind(payload.id).first<Entry>();
  if(previous?.withdrawn && !withdrawn)return "unchanged" as const;
  const json=canonicalJson(payload),digest=await sha256(json);
  if(previous?.payload_sha256===digest && previous.withdrawn===Number(withdrawn))return "unchanged" as const;
  if(previous && now<previous.revision_at)throw Error("calendar-revision-time-conflict");
  const sequence=(previous?.sequence??-1)+1,uid=previous?.uid??await uidFor(payload.id);
  try {
    await db.batch([
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
  now=new Date(),origin=publicOrigin()) {
  const at=CanonicalInstant.parse(now.toISOString()),withdrawn=new Set(withdrawnIds);
  const events=items.filter(item=>item.kind==="event" && item.status==="published");
  if(events.length>MAX_EVENTS || withdrawn.size>1000)throw Error("calendar-maintenance-limit");
  const unique=new Map<string,ContentItem>();for(const item of events){
    if(unique.has(item.id))throw Error("calendar-duplicate-input");unique.set(item.id,item);
  }
  let changed=0;
  for(const item of unique.values()){
    if(withdrawn.has(item.id))continue;
    const outcome=await writeRevision(db,payloadFor(item,origin),false,at);
    if(outcome==="changed")changed++;
  }
  for(const id of withdrawn){
    const row=await db.prepare("SELECT * FROM event_calendar_entries WHERE event_id=?").bind(id).first<Entry>();
    if(!row || row.withdrawn)continue;
    const payload=CalendarPayload.parse(JSON.parse(row.payload_json));
    if(await sha256(canonicalJson(payload))!==row.payload_sha256)throw Error("calendar-payload-integrity");
    if(await writeRevision(db,{...payload,status:"CANCELLED",description:""},true,at)==="changed")changed++;
  }
  return {changed,considered:unique.size,withdrawals:withdrawn.size};
}

function calendarDate(value:string,dateOnly:boolean) {
  return dateOnly?ICAL.Time.fromDateString(value.replace(/^(\d{4})(\d{2})(\d{2})$/,"$1-$2-$3"))
    :ICAL.Time.fromJSDate(new Date(value),true);
}
export async function serializeEventCalendar(db:D1DatabaseLike) {
  const rows=(await db.prepare("SELECT * FROM event_calendar_entries ORDER BY event_id LIMIT ?").bind(MAX_EVENTS+1).all<Entry>()).results??[];
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

export async function handleEventCalendar(request:Request,env:{VALLEY_DESK_DB?:D1DatabaseLike;EVENT_CALENDAR_PUBLIC_ENABLED?:string}) {
  const headers=new Headers({"content-type":"text/calendar; charset=utf-8","cache-control":"public, max-age=300",
    "content-disposition":'inline; filename="the-valley-desk-events.ics"',"x-content-type-options":"nosniff"});
  if(!["GET","HEAD"].includes(request.method)){headers.set("allow","GET, HEAD");return new Response(null,{status:405,headers});}
  if(env.EVENT_CALENDAR_PUBLIC_ENABLED!=="true" || !env.VALLEY_DESK_DB){headers.set("cache-control","no-store");return new Response(null,{status:503,headers});}
  try{
    const result=await serializeEventCalendar(env.VALLEY_DESK_DB);headers.set("etag",result.etag);
    if(result.lastModified)headers.set("last-modified",result.lastModified);
    const inm=request.headers.get("if-none-match");
    const match=inm?.split(",").some(value=>value.trim()==="*" || value.trim().replace(/^W\//,"")===result.etag);
    if(match)return new Response(null,{status:304,headers});
    const ims=request.headers.get("if-modified-since");
    if(!inm && ims && result.lastModified && Date.parse(ims)>=Date.parse(result.lastModified))return new Response(null,{status:304,headers});
    return new Response(request.method==="HEAD"?null:result.body,{headers});
  }catch{
    headers.set("cache-control","no-store");return new Response(null,{status:503,headers});
  }
}

