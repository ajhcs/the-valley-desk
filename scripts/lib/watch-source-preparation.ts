import { SourceEnrollment, sourceConfigurationDigest, type SnapshotInput } from "../../src/ingest/watch/source-enrollment";
import { parseWatchFeedSnapshot } from "../../src/ingest/watch/feed-adapter";
import { parseGitHubRepositorySnapshot } from "../../src/ingest/watch/github-adapter";
import { CanonicalInstant, canonicalJson, sha256 } from "../../src/content/watch-schema";
import { fetchUpstream, SOURCE_USER_AGENT, UpstreamError, sleep } from "../../src/ingest/upstream";
import { launchCandidate } from "../../fixtures/watch-launch-candidates";

export async function prepareCapturedSource(id:string, bytes:Uint8Array, capturedAt:string) {
  const candidate=launchCandidate(id),source=SourceEnrollment.parse(candidate.source);
  CanonicalInstant.parse(capturedAt);
  if(bytes.byteLength>source.maxBytes)throw Error("capture-byte-limit");
  const body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  const input:SnapshotInput={source,body,representationBytes:bytes,finalUrl:source.endpoints[0]!,fetchedAt:capturedAt};
  const parsed=source.transport==="rss"||source.transport==="atom"?await parseWatchFeedSnapshot(input):
    source.transport==="github-json"?await parseGitHubRepositorySnapshot(input):null;
  return {schemaVersion:"source-preparation-1",sourceId:id,configurationSha256:await sourceConfigurationDigest(source),
    endpoint:input.finalUrl,capturedAt,representationSha256:await sha256(bytes),representationBytes:bytes.byteLength,
    parserId:source.parserId,parserVersion:source.parserVersion,parsed,
    parserOutputSha256:parsed?await sha256(canonicalJson(parsed)):null,
    qualificationStatus:"candidate-only",publicationAuthorized:false,activationAuthorized:false,
    review:{engineeringOwnerId:null,editorialOwnerId:null,rightsDecision:null,accessDecision:null},
    blockers:[...candidate.blockers,...(!parsed?["unsupported-parser"]:[])]};
}

// This deliberately does not implement a permissive robots engine. Any nonempty
// rule requires a human access review; unknown or blocked access never triggers a crawl.
export function conservativeRobotsDisposition(body:string) {
  if(/<html|<!doctype/i.test(body))return "robots-unrecognized";
  if(body.split(/\r?\n/).some(line=>/^\s*(?:disallow|crawl-delay)\s*:\s*[^#\s]/i.test(line)))return "robots-review-required";
  if(body.split(/\r?\n/).some(line=>line.trim()&&!/^\s*(?:#|user-agent\s*:|allow\s*:|disallow\s*:|sitemap\s*:)/i.test(line)))return "robots-unrecognized";
  return "no-disallow-observed";
}

export async function captureLaunchCandidate(id:string, fetchImpl:typeof fetch=fetch) {
  const candidate=launchCandidate(id),source=candidate.source,endpoint=source.endpoints[0]!;
  const deadlineAt=Date.now()+25_000;
  const options={fetchImpl,maxBytes:source.maxBytes,timeoutMs:10_000,deadlineAt,attempts:1,
    allowedRedirectHosts:new Set<string>(),maxRedirects:0,requiresAuth:false,
    headers:{"user-agent":SOURCE_USER_AGENT,accept:"application/json,application/rss+xml,application/xml,text/html"}};
  let access:{mode:string;robotsSha256:string|null;robotsStatus:number|null;disposition:string;robotsText?:string;failureCode?:string}=
    {mode:candidate.accessMode,robotsSha256:null,robotsStatus:null,disposition:"documented-public-repository-api"};
  if(candidate.accessMode==="robots-check"){
    try {
      const robots=await fetchUpstream({...options,url:new URL("/robots.txt",endpoint).href,maxBytes:64000});
      access={mode:"robots-check",robotsSha256:await sha256(robots.body),robotsStatus:robots.status,robotsText:robots.body,
        disposition:conservativeRobotsDisposition(robots.body)};
      if(access.disposition!=="no-disallow-observed")return {sourceId:id,outcome:"access-held",access,packet:null,bytes:null};
    }catch(error){
      if(!(error instanceof UpstreamError)||error.httpStatus!==404)
        return {sourceId:id,outcome:"access-held",access:{...access,disposition:"robots-unavailable",
          robotsStatus:error instanceof UpstreamError?error.httpStatus??null:null,
          failureCode:error instanceof UpstreamError?error.code:"fetch-failed"},packet:null,bytes:null};
      access={...access,robotsStatus:404,disposition:"robots-not-found"};
    }
    await sleep(1000);
  }
  // Tee the bounded existing fetch reader to retain exact decoded-HTTP body bytes.
  // No credentials, redirects, pagination, retries or model calls are permitted.
  const chunks:Uint8Array[]=[];let size=0;
  const retainingFetch:typeof fetch=async(input,init)=>{
    if(String(input)!==endpoint)throw Error("capture-endpoint-conflict");
    const response=await fetchImpl(input,init);
    if(response.url&&response.url!==endpoint)throw Error("unexpected-followed-redirect");
    if(!response.body)return response;
    const stream=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
      size+=chunk.byteLength;
      if(size>source.maxBytes)throw new UpstreamError("upstream-failed","capture-byte-limit");
      chunks.push(chunk.slice());controller.enqueue(chunk);
    }}));
    return new Response(stream,{status:response.status,headers:response.headers});
  };
  try {
    await fetchUpstream({...options,url:endpoint,fetchImpl:retainingFetch});
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const packet=await prepareCapturedSource(id,bytes,new Date().toISOString());
    return {sourceId:id,outcome:packet.parsed?.health.state??"unsupported-parser",access,packet,bytes};
  }catch(error){
    return {sourceId:id,outcome:error instanceof UpstreamError?error.code:"capture-or-parser-failed",
      access,packet:null,bytes:null,httpStatus:error instanceof UpstreamError?error.httpStatus??null:null};
  }
}
