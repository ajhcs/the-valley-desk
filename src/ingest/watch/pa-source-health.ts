import { z } from "zod";
import { CanonicalInstant, Sha256, type WatchPublicRecord } from "../../content/watch-schema";
import { paSnapshotFreshness, type PaHealthEntry } from "../../content/pa-source-freshness";
import type { D1DatabaseLike } from "../persistence";
import { SOURCE_RUN_STATES } from "../source-health";
import { SourceEnrollment } from "./source-enrollment";
export type { PaHealthEntry } from "../../content/pa-source-freshness";
const Clock=z.object({raw:z.string().max(100),instant:CanonicalInstant,precision:z.literal('second'),timezone:z.literal('America/New_York'),offset:z.enum(['EDT','EST'])}).strict();
const Derivation=z.object({normalizerVersion:z.literal('watch-pa-zip-xml-v1'),rawArchiveSha256:Sha256,
  memberName:z.literal('PA-Bill-History-2025-RegularSession.xml'),memberSha256:Sha256,expandedBytes:z.number().int().positive().max(67108864),
  exportDate:Clock,inventoryCount:z.number().int().positive().max(100000),selectedCount:z.number().int().min(1).max(4),completeCoverage:z.literal(false),
  records:z.array(z.object({bill:z.enum(['HB1925','HB1993','SB1113','HB2787']),documentSha256:Sha256,semanticSha256:Sha256,lastUpdate:Clock,
    fields:z.array(z.object({field:z.string().min(1).max(100),xmlPath:z.string().min(1).max(1000),valueSha256:Sha256}).strict()).min(1).max(20)}).strict()).min(1).max(4)}).strict();
const State=z.object({last_checked_at:CanonicalInstant.nullable(),last_success_at:CanonicalInstant.nullable(),last_state:z.enum(SOURCE_RUN_STATES).nullable()});
/** Auxiliary health never hides accepted records. Decode the whole bounded,
 * bill-bound derivation before committing any clocks or upstream-origin claim. */
export async function readPaSourceHealth(db:D1DatabaseLike,items:WatchPublicRecord[],now:string):Promise<PaHealthEntry[]> {
  const result:PaHealthEntry[]=[];
  for(const item of items){
    if(item.kind!=='policy'||item.jurisdiction!=='PA')continue;
    for(const sourceId of [...new Set(item.sources.map(source=>source.sourceId))].slice(0,4)){
      let health=paSnapshotFreshness({exportAt:null,lastCheckedAt:null,lastSuccessfulUpstreamCheckAt:null,currentFailure:null,origin:'unknown'},now);
      try{
        const row=await db.prepare(`SELECT CASE WHEN length(CAST(s.configuration_json AS BLOB))<=16000 THEN s.configuration_json END configuration_json,t.last_checked_at,t.last_success_at,t.last_state,
          (SELECT CASE WHEN length(CAST(r.normalized_text AS BLOB))<=64000 THEN r.normalized_text END FROM watch_raw_representations r JOIN watch_collection_pages p ON p.representation_id=r.id
           WHERE r.source_id=s.id AND r.configuration_sha256=s.configuration_sha256 AND json_extract(p.page_json,'$.state')='healthy'
             AND json_extract(p.page_json,'$.truncated')=0 AND json_extract(p.page_json,'$.rejectedItems')=0
           ORDER BY p.persisted_at DESC,p.id DESC LIMIT 1) normalized_text
          FROM watch_collection_sources s LEFT JOIN watch_collection_state t ON t.source_id=s.id WHERE s.id=?`)
          .bind(sourceId).first<{configuration_json:string;normalized_text:string|null;last_checked_at:string|null;last_success_at:string|null;last_state:string|null}>();
        if(!row||new TextEncoder().encode(row.configuration_json).length>16000||!row.normalized_text||new TextEncoder().encode(row.normalized_text).length>64000)throw Error('health-unavailable');
        const source=SourceEnrollment.parse(JSON.parse(row.configuration_json)),state=State.parse(row),derived=Derivation.parse(JSON.parse(row.normalized_text));
        const bill=item.identity.value.sourceInstrumentId.replace(/\s+/g,''),record=derived.records.find(record=>record.bill===bill);
        if(source.id!==sourceId||source.transport!=='official-zip-xml'||!record||derived.selectedCount!==derived.records.length||
          new Set(derived.records.map(record=>record.bill)).size!==derived.records.length||
          source.paExport!.selectedBills.length!==derived.records.length||derived.records.some(record=>!source.paExport!.selectedBills.includes(record.bill)))throw Error('health-association');
        const decoded=paSnapshotFreshness({exportAt:derived.exportDate.instant,billLastUpdateAt:record.lastUpdate.instant,
          lastCheckedAt:state.last_checked_at,lastSuccessfulUpstreamCheckAt:state.last_success_at,
          currentFailure:state.last_state&&!['healthy','healthy-empty'].includes(state.last_state)?state.last_state:null,origin:'upstream'},now,source.paExport?.freshnessPolicy);
        if(decoded.freshness==='invalid')throw Error('health-invalid-clocks');
        health=decoded;
      }catch{/* Private query/parser diagnostics are never public response data. */}
      result.push({subjectId:item.id,sourceId,health});
    }
  }
  return result;
}
