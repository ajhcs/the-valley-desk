import { WatchPublicRecord, canonicalJson, sha256 } from "../../content/watch-schema";
import { WatchDeliveryManifest, validateDeliveryBinding, deliveryEasternDay, WATCH_DELIVERY_MANIFEST_BYTES, type DeliveryGroup } from "../../content/watch-delivery";
import { deliveryValiditySql } from "../watch-delivery";
import type { D1DatabaseLike } from "../persistence";

/** Preserve independently supported PA optional status. Reuse the exact accepted
 * group and dependency proofs; never reverify or synthesize a native fact. */
export async function preservePaStatusForRefresh(db:D1DatabaseLike, record:WatchPublicRecord, manifest:WatchDeliveryManifest, sourceId:string, now:string) {
  if(record.kind!=="policy" || record.jurisdiction!=="PA")return {record,manifest};
  const row=await db.prepare(`WITH clock AS (SELECT ? instant,? day)
    SELECT r.payload_json,r.payload_sha256,m.manifest_json,m.manifest_sha256,${deliveryValiditySql()} validity
    FROM watch_public_revisions r CROSS JOIN clock JOIN watch_delivery_manifests m ON m.decision_id=r.decision_id
    WHERE r.subject_id=? AND r.valid_to IS NULL AND NOT EXISTS(SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=r.subject_id)`).bind(now,deliveryEasternDay(now),record.id)
    .first<{payload_json:string;payload_sha256:string;manifest_json:string;manifest_sha256:string;validity:string}>();
  if(!row)return {record,manifest};
  if(new TextEncoder().encode(row.payload_json).length>200000 || new TextEncoder().encode(row.manifest_json).length>WATCH_DELIVERY_MANIFEST_BYTES ||
    await sha256(row.payload_json)!==row.payload_sha256 || await sha256(row.manifest_json)!==row.manifest_sha256)throw Error("pa-status-prior-proof-corrupt");
  const previous=WatchPublicRecord.parse(JSON.parse(row.payload_json));
  const priorManifest=await validateDeliveryBinding(previous,JSON.parse(row.manifest_json));
  if(previous.kind!=="policy" || canonicalJson(previous.identity.value)!==canonicalJson(record.identity.value))throw Error("pa-status-identity-conflict");
  const validity=JSON.parse(row.validity) as Record<string,number>;
  const fields=[['latest-action','latestAction'],['lifecycle','lifecycleFact'],['legal-effect','legalEffectFact']] as const;
  const preserved:DeliveryGroup[]=[];
  for(const [field,key] of fields){
    const fact=previous[key];
    const group=priorManifest.groups.find(group=>group.field===field);
    if(!fact || !group || validity[group.key]!==1)continue;
    // An older export is not authority to retract a separate vote/status/PDF.
    // Same-source proof retains normal change/retraction behavior.
    if(!group.citationIds.some(id=>{const source=previous.sources.find(source=>source.id===id);return source&&source.sourceId!==sourceId;}))continue;
    preserved.push(group);
    if(key==='latestAction')record={...record,latestAction:previous.latestAction};
    if(key==='lifecycleFact')record={...record,lifecycle:previous.lifecycle,lifecycleFact:previous.lifecycleFact};
    if(key==='legalEffectFact')record={...record,legalEffect:previous.legalEffect,legalEffectFact:previous.legalEffectFact};
  }
  if(!preserved.length)return {record,manifest};
  const fieldsSet=new Set(preserved.map(group=>group.field));
  const citationIds=new Set(preserved.flatMap(group=>group.citationIds));
  const sources=new Map(record.sources.map(source=>[source.id,source]));
  for(const source of previous.sources)if(citationIds.has(source.id))sources.set(source.id,source);
  record=WatchPublicRecord.parse({...record,sources:[...sources.values()],verifiedAt:[record.verifiedAt,...fields.flatMap(([field,key])=>fieldsSet.has(field)&&previous[key]?[previous[key]!.verifiedAt]:[])].sort()[0],
    unknowns:record.unknowns.filter(unknown=>!fieldsSet.has(unknown.field as typeof preserved[number]['field']))});
  manifest=WatchDeliveryManifest.parse({...manifest,payloadSha256:await sha256(canonicalJson(record)),
    groups:[...manifest.groups.filter(group=>!fieldsSet.has(group.field)),...preserved]});
  await validateDeliveryBinding(record,manifest);
  // Caller fences ALL inherited dependency heads/expirations in its existing
  // editorial acceptance transaction and expected public-revision transaction.
  return {record,manifest};
}
