/** Offline, memory-only evaluator. Input is authorized capture rows via stdin.
 * Output contains hashes, provenance, candidate facts and rejection counts only. */
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {previewLeadershipDom,isPlainFactText} from './leadership-dom-preview.ts';
const EXPIRY=Date.parse('2026-10-07T04:00:00Z');
export function evaluateRetainedCaptures(rows,now=Date.now()){
if(!Number.isFinite(now)||now>=EXPIRY)throw Error('Authorized retained inspection expired');
if(!Array.isArray(rows)||rows.length!==7)throw Error('Expected exact seven-source capture scope');
const scope=new Set(['src-chop-desai','src-chop-leadership','src-chop-pennington','src-chop-salmasian','src-inspira-leadership','src-nemours-leadership','src-temple-leadership']);
const seen=new Set();const results=[];
for(const row of rows){
 if(!scope.has(row.source_id))throw Error('Source outside exact retained scope');
 if(row.byte_semantics!=='fetch-response-body'||row.decoding!=='utf-8-replacement-bom-stripped')throw Error('Unknown capture decoding semantics');
 if(seen.has(row.source_id))throw Error('Duplicate source');seen.add(row.source_id);
 const expiry=Date.parse(row.expires_at),received=Date.parse(row.received_at);
 if(!Number.isFinite(expiry)||expiry!==EXPIRY||now>=expiry)throw Error('Retained response expired or expiry invalid');
 if(!Number.isFinite(received)||received<Date.parse('2026-10-06T02:30:00Z')||received>=Date.parse('2026-10-06T04:00:00Z'))throw Error('Capture outside authorized window');
 if(row.http_status!==200||!/^text\/html(?:;|$)/i.test(row.content_type))throw Error('Unsupported retained response');
 if(!Number.isInteger(row.byte_count)||row.byte_count<=0||row.byte_count>512000||typeof row.raw_markup_base64!=='string'||row.raw_markup_base64.length>682668)throw Error('Capture bound exceeded');
 const bytes=Buffer.from(row.raw_markup_base64,'base64');
 const rawHash=createHash('sha256').update(bytes).digest('hex');
 const html=new TextDecoder().decode(bytes);
 const decodedHash=createHash('sha256').update(html).digest('hex');
 if(bytes.length!==row.byte_count||rawHash!==row.raw_sha256||decodedHash!==row.decoded_sha256)throw Error('Capture integrity mismatch');
 if(row.configured_url!==row.attempted_url||row.configured_url!==row.final_url)throw Error('Source attribution mismatch');
 const preview=previewLeadershipDom(row.source_id,html,row.configured_url);
 if(preview.rejected.some(r=>r.reason==='unregistered-source-or-url'))throw Error('Source URL not registered');
 for(const record of [...preview.candidates,...preview.rejected])for(const value of Object.values(record)){
  if(typeof value==='string'&&!isPlainFactText(value,2048))throw Error('Non-fact output rejected');
 }
 results.push({sourceId:row.source_id,url:row.final_url,receivedAt:new Date(received).toISOString(),expiresAt:new Date(expiry).toISOString(),rawSHA256:rawHash,decodedSHA256:decodedHash,rawBytes:bytes.length,integrityVerified:true,candidateCount:preview.candidates.length,...preview});
}
return {checkedAt:new Date(now).toISOString(),inputRows:rows.length,evaluationWritesRaw:false,results};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 if(Date.now()>=EXPIRY)throw Error('Authorized retained inspection expired');
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>5000000)throw Error('Input bound exceeded');}
 console.log(JSON.stringify(evaluateRetainedCaptures(JSON.parse(input)),null,2));
}
