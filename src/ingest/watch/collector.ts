import { canonicalJson, CanonicalInstant, sha256, tupleKey } from "../../content/watch-schema";
import type { D1DatabaseLike } from "../persistence";
import { classifyFetchError, classifyHttpStatus, type SourceRunState } from "../source-health";
import { SOURCE_TIMEOUT_MS, SOURCE_USER_AGENT, UpstreamError, sleep } from "../upstream";
import { parseWatchFeedSnapshot } from "./feed-adapter";
import { parseFederalRegisterSnapshot, stageCollectedPolicyObservations } from "./policy-adapter";
import { parseRepresentativeRosterSnapshot, publishCollectedRepresentativeRoster } from "./representative-adapter";
import { parseGitHubRepositorySnapshot, parseGitHubReleasesSnapshot, parseGitHubTagsSnapshot, parseGitHubCommitsSnapshot,
  type GitHubRepositoryBinding } from "./github-adapter";
import { checkpointAfterPersistence, sourceEndpointAllowed, type SnapshotInput, type WatchSnapshotResult,
  type SnapshotPageReceipt, type PersistenceAcknowledgment, type PagePersistenceAcknowledgment } from "./source-enrollment";
import { resolveEnrolledCollectionSource, retainedGoodRepresentation, retainedBytes, persistWatchCollectionPage,
  resolveWatchSourcePermissions, type EnrolledCollectionSource } from "./collection-storage";

const MAX_SOURCES=8, MAX_PAGES=4, RUN_MS=90_000, HOST_GAP_MS=1000, MAX_BACKOFF_MS=7*86400_000;
type StateRow={source_id:string;next_due_at:string;failures:number};
export type CollectionOutcome={sourceId:string;state:SourceRunState;itemCount:number;detail:string;checkpointAdvanced:boolean};
const instant=(ms:number)=>new Date(ms).toISOString();
async function bytesFromResponse(response:Response,maximum:number) {
  const length=Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length>maximum) {await response.body?.cancel();throw new UpstreamError("upstream-failed","response-byte-limit");}
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader) try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>maximum){await reader.cancel();throw new UpstreamError("upstream-failed","response-byte-limit");}chunks.push(part.value);
  }} finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function retryAfter(response:Response,now:number) {
  const raw=response.headers.get("retry-after");if(!raw)return 0;
  const seconds=Number(raw),value=Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-now;
  return Number.isFinite(value)?Math.min(MAX_BACKOFF_MS,Math.max(0,value)):0;
}
class CollectionFetchError extends UpstreamError { constructor(code:SourceRunState,message:string,readonly retryMs=0,status?:number){super(code,message,status);} }

async function fetchPage(db:D1DatabaseLike,enrolled:EnrolledCollectionSource,url:string,fetchImpl:typeof fetch,deadline:number,clock:()=>Date) {
  if (!sourceEndpointAllowed(enrolled.source,url)) throw new UpstreamError("misconfigured","endpoint-not-enrolled");
  const previous=await retainedGoodRepresentation(db,enrolled,url);
  const headers:Record<string,string>={"user-agent":SOURCE_USER_AGENT,accept:enrolled.source.transport==="github-json"?"application/vnd.github+json":enrolled.source.transport==="official-json"?"application/json":"application/xml,text/xml"};
  const conditionalAllowed=enrolled.source.transport!=="github-json" || !new URL(url).pathname.split("/")[4];
  if(conditionalAllowed && previous?.etag)headers["if-none-match"]=previous.etag;
  if(conditionalAllowed && previous?.last_modified)headers["if-modified-since"]=previous.last_modified;
  for(let hop=0;hop<4;hop++){
    const now=clock().getTime(),remaining=Math.min(SOURCE_TIMEOUT_MS,deadline-now);
    if(remaining<=0)throw new UpstreamError("timed-out","watch-run-deadline");
    const host=new URL(url).hostname,pace=await db.prepare("SELECT next_allowed_at FROM watch_collection_hosts WHERE host=?").bind(host).first<{next_allowed_at:string}>();
    if(pace && pace.next_allowed_at>instant(now)){
      const wait=Date.parse(pace.next_allowed_at)-now;
      if(now+wait+1>=deadline)throw new CollectionFetchError("rate-limited","watch-host-paced",wait);
      await sleep(wait);
    }
    const requestAt=clock().getTime(),requestBudget=Math.min(SOURCE_TIMEOUT_MS,deadline-requestAt);
    if(requestBudget<=0)throw new UpstreamError("timed-out","watch-run-deadline");
    await db.prepare("INSERT INTO watch_collection_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET next_allowed_at=excluded.next_allowed_at").bind(host,instant(requestAt+HOST_GAP_MS)).run();
    const response=await fetchImpl(url,{headers,redirect:"manual",signal:AbortSignal.timeout(requestBudget)});
    if(response.status===304){
      await response.body?.cancel();
      if(!conditionalAllowed || !previous || previous.endpoint!==url)throw new UpstreamError("upstream-failed","not-modified-without-retained-good-representation");
      const bytes=retainedBytes(previous);
      if(await sha256(bytes)!==previous.representation_sha256)throw new UpstreamError("parser-failed","retained-representation-corrupt");
      return {bytes,body:new TextDecoder("utf-8",{fatal:true}).decode(bytes),headers:new Headers({etag:previous.etag??"", "last-modified":previous.last_modified??""}),url,notModified:true};
    }
    if(response.status>=300 && response.status<400){
      const location=response.headers.get("location");await response.body?.cancel();
      const next=location?new URL(location,url).href:"";
      if(!sourceEndpointAllowed(enrolled.source,next))throw new UpstreamError("upstream-failed","redirect-not-enrolled");
      url=next;continue;
    }
    if(response.status!==200){await response.body?.cancel();throw new CollectionFetchError(classifyHttpStatus(response.status,{requiresAuth:enrolled.source.requiresAuth}),
      "upstream-http-"+response.status,retryAfter(response,now),response.status);}
    if(response.url && response.url!==url)throw new UpstreamError("upstream-failed","unexpected-followed-redirect");
    const type=response.headers.get("content-type")??"";
    if(/charset\s*=\s*(?!["']?utf-?8(?:["';\s]|$))/i.test(type)) {await response.body?.cancel();throw new UpstreamError("parser-failed","unqualified-charset");}
    const bytes=await bytesFromResponse(response,enrolled.source.maxBytes);
    return {bytes,body:new TextDecoder("utf-8",{fatal:true}).decode(bytes),headers:response.headers,url,notModified:false};
  }
  throw new UpstreamError("upstream-failed","redirect-limit");
}
function githubNext(headers:Headers,enrolled:EnrolledCollectionSource):string|null {
  const links=(headers.get("link")??"").split(",").filter(value=>/rel=["']?next["']?/.test(value));
  if(!links.length)return null;if(links.length!==1)throw new UpstreamError("parser-failed","ambiguous-pagination");
  const match=links[0]!.match(/<([^>]+)>/);if(!match||!sourceEndpointAllowed(enrolled.source,match[1]!))throw new UpstreamError("parser-failed","pagination-not-enrolled");
  return match[1]!;
}
async function collectSource(db:D1DatabaseLike,enrolled:EnrolledCollectionSource,fetchImpl:typeof fetch,deadline:number,clock:()=>Date,leaseOwner:string,publishVerified:boolean) {
  const snapshotId=crypto.randomUUID(),source=enrolled.source,pages:SnapshotPageReceipt[]=[],
    persisted=new Map<string,PersistenceAcknowledgment>(),persistedPages=new Map<string,PagePersistenceAcknowledgment>();
  let url=source.endpoints[0]!,pageKey="1",binding:GitHubRepositoryBinding|null=null,itemCount=0;
  let lastResult:WatchSnapshotResult|null=null;
  for(let pageNumber=0;pageNumber<MAX_PAGES;pageNumber++){
    const fetched=await fetchPage(db,enrolled,url,fetchImpl,deadline,clock);
    const input:SnapshotInput={source,body:fetched.body,representationBytes:fetched.bytes,finalUrl:fetched.url,fetchedAt:clock().toISOString(),status:200,pageKey};
    let result:WatchSnapshotResult;
    if(source.transport==="rss"||source.transport==="atom") result=await parseWatchFeedSnapshot(input);
    else if(source.transport==="official-json") result=await parseFederalRegisterSnapshot(input);
    else if(source.transport==="official-xml") result=await parseRepresentativeRosterSnapshot(input);
    else if(source.transport==="github-json"){
      const mode=new URL(url).pathname.split("/")[4];
      if(!mode){
        const previous=await retainedGoodRepresentation(db,enrolled,url);
        const previousId=previous?String(JSON.parse(previous.normalized_text).id):undefined;
        const repository=await parseGitHubRepositorySnapshot(input,previousId);
        result=repository;
        binding=repository.repository;
      } else {
        if(!binding)throw new UpstreamError("misconfigured","fresh-persisted-github-binding-required");
        const next=githubNext(fetched.headers,enrolled);input.nextPageKey=next;input.terminal=!next;
        result=mode==="releases"?await parseGitHubReleasesSnapshot(input,binding):mode==="tags"?await parseGitHubTagsSnapshot(input,binding):
          mode==="commits"?await parseGitHubCommitsSnapshot(input,binding):(()=>{throw new UpstreamError("misconfigured","github-mode-unsupported");})();
      }
    } else throw new UpstreamError("misconfigured","watch-transport-not-implemented");
    // A repository snapshot is retained before its binding can authorize a list.
    const stored=await persistWatchCollectionPage(db,enrolled,{snapshotId,endpoint:fetched.url,bytes:fetched.bytes,
      body:fetched.body,headers:fetched.headers,result,now:clock().toISOString(),leaseOwner});
    if(["official-json","official-xml"].includes(source.transport) && !result.rejectedItems && !result.truncated && result.health.state==="healthy") {
      const permission=await resolveEnrolledCollectionSource(db,source.id,clock().toISOString());
      if(permission?.permissionDigest!==enrolled.permissionDigest)throw new UpstreamError("disabled","watch-source-permission-changed");
      // Native persistence can retract stale evidence, so every write transaction
      // must retain the same enrollment and live lease, not just the pre-read.
      const guardedDb:D1DatabaseLike={prepare:sql=>db.prepare(sql),async batch(statements){
        const at=clock().toISOString(),context=await resolveWatchSourcePermissions(db,[source.id],at);
        if(context.sourcePermissionDigests.get(source.id)!==enrolled.permissionDigest)
          throw new UpstreamError("disabled","watch-source-permission-changed");
        const decisionId=crypto.randomUUID();
        return db.batch([...context.acceptanceGuards(decisionId),
          db.prepare(`INSERT INTO watch_collection_acceptance_guards VALUES(?,?,?,?,CASE WHEN EXISTS(
            SELECT 1 FROM watch_collection_leases WHERE id='watch-collector' AND owner=? AND expires_at>?
          ) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),decisionId,source.id,at,leaseOwner,at),...statements]);
      }};
      if(source.transport==="official-xml") await publishCollectedRepresentativeRoster(guardedDb,input,clock(),publishVerified);
      else await stageCollectedPolicyObservations(guardedDb,result.observations,clock(),publishVerified);
    }
    pages.push(stored.page);for(const [id,ack] of stored.persisted)persisted.set(id,ack);persistedPages.set(pageKey,stored.acknowledgment);
    itemCount+=result.observations.length;lastResult=result;
    if(!["healthy","healthy-empty"].includes(result.health.state)||result.truncated||result.rejectedItems)break;
    // Repository-plus-list enrollments use a separate chain: neither is a full inventory.
    if(binding && pageNumber===0 && source.endpoints[1] && !new URL(url).pathname.split("/")[4]){
      url=source.endpoints[1];pageKey="2";pages.length=0;persistedPages.clear();continue;
    }
    if(result.pagination.terminal)break;
    const next=result.pagination.nextPageKey;
    if(!next)break;
    const mapped=source.transport==="github-json"||source.transport==="official-json"?next:(await Promise.all(source.endpoints.map(async endpoint=>
      ({endpoint,key:await tupleKey("watch-page-v1",[await sha256(endpoint)])})))).find(value=>value.key===next)?.endpoint;
    if(!mapped || !sourceEndpointAllowed(source,mapped))throw new UpstreamError("parser-failed","pagination-not-enrolled");
    url=mapped;pageKey=next;
  }
  let checkpoint:unknown=null;
  try { checkpoint=await checkpointAfterPersistence({sourceId:source.id,snapshotId,parserVersion:source.parserVersion,
    firstPageKey:pages[0]?.pageKey??"1",pages,persisted,persistedPages}); } catch { /* Partial writes remain durable for bounded replay. */ }
  return {itemCount,state:lastResult?.health.state??"parser-failed",detail:lastResult?.health.error??(checkpoint?"durable-discovery-checkpoint":"partial-snapshot-retained"),checkpoint};
}

// No model, secret lookup or source activation happens here. Qualified complete
// official rosters may advance through the exact-source rule, under the same lease.
export async function runWatchCollection(db:D1DatabaseLike,options:{
  enabled:boolean;publishVerified?:boolean;fetchImpl?:typeof fetch;clock?:()=>Date;maxSources?:number;deadlineMs?:number;
}) {
  if(!options.enabled)return {outcome:"disabled" as const,sources:[]};
  const clock=options.clock??(()=>new Date()),started=clock().toISOString();CanonicalInstant.parse(started);
  const duration=Math.max(1000,Math.min(RUN_MS,options.deadlineMs??RUN_MS)),deadline=Date.parse(started)+duration,owner=crypto.randomUUID();
  await db.prepare(`INSERT INTO watch_collection_leases VALUES('watch-collector',?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<=?`)
    .bind(owner,instant(deadline+SOURCE_TIMEOUT_MS),started).run();
  const lock=await db.prepare("SELECT owner FROM watch_collection_leases WHERE id='watch-collector'").first<{owner:string}>();
  if(lock?.owner!==owner)return {outcome:"locked" as const,sources:[]};
  const sources:CollectionOutcome[]=[];
  try {
    const rows=(await db.prepare(`SELECT * FROM watch_collection_state WHERE next_due_at<=? ORDER BY next_due_at,source_id LIMIT ?`)
      .bind(started,Math.max(1,Math.min(MAX_SOURCES,Math.trunc(options.maxSources??MAX_SOURCES)))).all<StateRow>()).results;
    for(const row of rows??[]){
      if(clock().getTime()>=deadline)break;
      const checked=clock().toISOString(),enrolled=await resolveEnrolledCollectionSource(db,row.source_id,checked);
      let state:SourceRunState="disabled",detail="qualification-or-activation-held",itemCount=0,checkpoint:unknown=null,retryMs=0;
      if(enrolled)try{
        if(enrolled.source.requiresAuth)throw new UpstreamError("misconfigured","watch-credential-resolver-not-provisioned");
        if(!["rss","atom","github-json","official-json","official-xml"].includes(enrolled.source.transport))throw new UpstreamError("misconfigured","watch-transport-not-implemented");
        if(enrolled.source.parserVersion!=="1" || enrolled.source.parserId!==(enrolled.source.transport==="github-json"?"watch-github":enrolled.source.transport==="official-json"?"watch-federal-register":enrolled.source.transport==="official-xml"?"watch-federal-roster":"watch-rss"))
          throw new UpstreamError("misconfigured","watch-parser-not-installed");
        const result=await collectSource(db,enrolled,options.fetchImpl??fetch,deadline,clock,owner,options.publishVerified??false);
        ({state,detail,itemCount,checkpoint}=result);
      }catch(error){
        state=error instanceof UpstreamError?error.code:classifyFetchError(error);detail=error instanceof Error?error.message:"collection-failed";
        retryMs=error instanceof CollectionFetchError?error.retryMs:0;
      }
      const now=clock().toISOString(),healthy=["healthy","healthy-empty"].includes(state),
        failures=healthy?0:Math.min(30,row.failures+1),cadence=(enrolled?.cadenceSeconds??3600)*1000,
        next=instant(Date.parse(now)+Math.max(cadence,retryMs,healthy?0:Math.min(MAX_BACKOFF_MS,60_000*2**Math.min(failures-1,14))));
      const lease=await db.prepare("SELECT owner,expires_at FROM watch_collection_leases WHERE id='watch-collector'").first<{owner:string;expires_at:string}>();
      if(lease?.owner!==owner || lease.expires_at<=now)throw Error("watch-collection-lease-lost");
      await db.batch([
        db.prepare("INSERT INTO watch_collection_runs VALUES(?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(),row.source_id,checked,now,state,itemCount,detail.slice(0,500),checkpoint?1:0),
        db.prepare(`UPDATE watch_collection_state SET next_due_at=?,failures=?,last_checked_at=?,last_state=?,
          last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,checkpoint_json=COALESCE(?,checkpoint_json) WHERE source_id=?`)
          .bind(next,failures,now,state,healthy?1:0,now,checkpoint?canonicalJson(checkpoint):null,row.source_id),
      ]);
      sources.push({sourceId:row.source_id,state,itemCount,detail,checkpointAdvanced:!!checkpoint});
    }
    return {outcome:"completed" as const,sources};
  } finally {await db.prepare("DELETE FROM watch_collection_leases WHERE id='watch-collector' AND owner=?").bind(owner).run();}
}
