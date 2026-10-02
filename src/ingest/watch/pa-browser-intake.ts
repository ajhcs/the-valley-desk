import { CanonicalInstant, canonicalJson, sha256 } from '../../content/watch-schema';
import { paSnapshotFreshness } from '../../content/pa-source-freshness';
import type { D1DatabaseLike } from '../persistence';
import { validateBrowserOriginal } from './pa-browser-original';
import { derivePaExport, validatedPaExportSource, assertPaExportProgress } from './pennsylvania-export';
import { parsePennsylvaniaExportSnapshot, stageCollectedPennsylvaniaExport, type PaExportSnapshotInput } from './pennsylvania-export-adapter';
import { persistWatchCollectionPage, retainedProgressRepresentation, resolveEnrolledCollectionSource, resolveWatchSourcePermissions } from './collection-storage';
import { sourceConfigurationDigest } from './source-enrollment';

export type RetainedPaBrowserPacket = { packetSha256:string; sourceId:string; bytes:Uint8Array; receiptBytes:Uint8Array; acquisitionBytes:Uint8Array };
/** Internal trusted-operator entrypoint, never an HTTP handler or scheduled fetch.
 * Retention does not create authority. The caller supplies private durable storage;
 * candidate packets cannot enter active collection tables without accepted enrollment. */
export async function intakePaBrowserOriginal(db:D1DatabaseLike,sourceInput:unknown,packet:{bytes:Uint8Array;receiptBytes:Uint8Array;acquisitionBytes:Uint8Array},options:{
  retain:(packet:RetainedPaBrowserPacket)=>Promise<{packetSha256:string}>; clock?:()=>Date; onDiagnostic?:(error:unknown)=>void;
}) {
  const clock=options.clock??(()=>new Date()),now=clock().toISOString();CanonicalInstant.parse(now);
  const held=(reason:string)=>({outcome:'pending-review' as const,reason,publicationAuthorized:false as const,successfulUpstreamCheckRenewed:false as const});
  if(packet.bytes.length>2_000_000||packet.receiptBytes.length>64_000||packet.acquisitionBytes.length>64_000)return {...held('packet-byte-limit'),outcome:'rejected' as const};
  // Own immutable byte copies before any await/caller retention callback.
  const bytes=new Uint8Array(packet.bytes),receiptBytes=new Uint8Array(packet.receiptBytes),acquisitionBytes=new Uint8Array(packet.acquisitionBytes);
  let source,acquisition,derived;
  try{
    source=validatedPaExportSource(sourceInput);
    acquisition=await validateBrowserOriginal(source,bytes,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(acquisitionBytes)),receiptBytes);
    derived=await derivePaExport(source,bytes);
    if(acquisition.completedAt>now||derived.receipt.exportDate.instant>acquisition.completedAt)throw Error('packet-clock-invalid');
  }catch{return {...held('packet-invalid'),outcome:'rejected' as const};}
  const configurationSha256=await sourceConfigurationDigest(source);
  const packetSha256=await sha256(canonicalJson([source.id,configurationSha256,await sha256(bytes),await sha256(receiptBytes),await sha256(acquisitionBytes)]));
  let retained;
  try{retained=await options.retain({packetSha256,sourceId:source.id,bytes:new Uint8Array(bytes),receiptBytes:new Uint8Array(receiptBytes),acquisitionBytes:new Uint8Array(acquisitionBytes)});}catch(error){options.onDiagnostic?.(error);return {...held('private-retention-failed'),outcome:'degraded' as const,packetSha256,retained:false as const};}
  if(retained.packetSha256!==packetSha256)return {...held('private-retention-conflict'),outcome:'rejected' as const};
  const pending=(reason:string)=>({...held(reason),packetSha256,retained:true as const,exportAt:derived.receipt.exportDate.instant,acquiredAt:acquisition.completedAt});
  let enrolled;
  try{enrolled=await resolveEnrolledCollectionSource(db,source.id,now);}catch(error){options.onDiagnostic?.(error);return {...pending('source-storage-unavailable'),outcome:'degraded' as const};}
  if(!enrolled||enrolled.configurationSha256!==configurationSha256)return pending('qualification-or-activation-held');
  const age=paSnapshotFreshness({exportAt:derived.receipt.exportDate.instant,lastCheckedAt:null,lastSuccessfulUpstreamCheckAt:null,currentFailure:null,origin:'browser-original'},now,source.paExport?.freshnessPolicy);
  if(age.freshness!=='fresh')return pending('export-age-policy-'+age.freshness);
  const owner=crypto.randomUUID(),expires=new Date(Date.parse(now)+60_000).toISOString();
  await db.prepare(`INSERT INTO watch_collection_leases VALUES('watch-collector',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<=?`).bind(owner,expires,now).run();
  const lease=await db.prepare("SELECT owner FROM watch_collection_leases WHERE id='watch-collector'").first<{owner:string}>();
  if(lease?.owner!==owner)return pending('collector-lease-held');
  try{
    const previous=await retainedProgressRepresentation(db,enrolled,acquisition.requestedUrl);
    if(previous)try{assertPaExportProgress(previous.normalized_text,derived.normalizedText);}catch{return pending('retained-export-order-conflict');}
    const guarded:D1DatabaseLike={prepare:sql=>db.prepare(sql),async batch(statements){
      const at=clock().toISOString(),permission=await resolveWatchSourcePermissions(db,[source.id],at);
      if(permission.sourcePermissionDigests.get(source.id)!==enrolled.permissionDigest)throw Error('intake-permission-changed');
      const decision=crypto.randomUUID();
      return db.batch([...permission.acceptanceGuards(decision),db.prepare(`INSERT INTO watch_collection_acceptance_guards VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM watch_collection_leases WHERE id='watch-collector' AND owner=? AND expires_at>?) THEN 1 ELSE 0 END)`).bind(crypto.randomUUID(),decision,source.id,at,owner,at),...statements]);
    }};
    const input:PaExportSnapshotInput={source,body:derived.normalizedText,representationBytes:bytes,representationKind:'pa-zip-xml',finalUrl:acquisition.requestedUrl,fetchedAt:acquisition.completedAt,browserOriginal:{acquisition,receiptBytes}};
    const result=await parsePennsylvaniaExportSnapshot(input);
    if(result.health.state!=='healthy')return pending('parser-failed');
    const stored=await persistWatchCollectionPage(guarded,enrolled,{snapshotId:packetSha256,endpoint:acquisition.requestedUrl,bytes,body:derived.normalizedText,headers:new Headers(acquisition.responseHeaders??{}),result,now:clock().toISOString(),leaseOwner:owner,
      browserOriginal:{origin:'browser-original',packetSha256,acquisitionBase64:encode(acquisitionBytes),receiptBase64:encode(receiptBytes)}});
    // Explicit review staging only; no acceptance/publication option is exposed.
    await stageCollectedPennsylvaniaExport(guarded,input,result,stored.persisted,clock(),false);
    return {...pending('editorial-review-required'),outcome:'staged-review' as const,itemCount:result.observations.length};
  }catch(error){options.onDiagnostic?.(error);return {...pending('guard-or-storage-failed'),outcome:'degraded' as const};}
  finally{await db.prepare("DELETE FROM watch_collection_leases WHERE id='watch-collector' AND owner=?").bind(owner).run();}
}
function encode(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
