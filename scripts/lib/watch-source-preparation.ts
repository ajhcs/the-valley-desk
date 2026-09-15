import { SourceEnrollment, sourceConfigurationDigest, type SnapshotInput } from "../../src/ingest/watch/source-enrollment";
import { parseWatchFeedSnapshot } from "../../src/ingest/watch/feed-adapter";
import { parseGitHubRepositorySnapshot } from "../../src/ingest/watch/github-adapter";
import { CanonicalInstant, canonicalJson, sha256 } from "../../src/content/watch-schema";
import { fetchUpstream, SOURCE_USER_AGENT, UpstreamError, sleep } from "../../src/ingest/upstream";
import { launchCandidate } from "../../fixtures/watch-launch-candidates";
import robotsParser from "robots-parser";

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

export function endpointRobotsPolicy(body:string, endpoint:string, maxDelayMs=10_000) {
  const detail={endpoint,userAgent:SOURCE_USER_AGENT,delayMs:1000,matchingLine:null as number|null};
  const held=()=>({...detail,disposition:"robots-unrecognized" as const});
  if(/<html|<!doctype|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/i.test(body))return held();
  // Reject malformed/challenge responses before the library's tolerant parser.
  // Rule precedence and agent/path matching belong exclusively to robots-parser.
  let hasAgent=false;
  for(const raw of body.split(/\r?\n/)){
    const line=raw.replace(/#.*$/,"").trim();
    if(!line)continue;
    const directive=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if(!directive)return held();
    const key=directive[1]!.toLowerCase(),value=directive[2]!;
    if(key==="user-agent"){
      if(!value||/\s/.test(value))return held();
      hasAgent=true;
    }else if(key==="allow"||key==="disallow"){
      if(!hasAgent||(value&&!/^[/*][^\s]*$/.test(value)))return held();
    }else if(key==="crawl-delay"){
      if(!hasAgent||!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value)))return held();
    }else if(key!=="host"&&key!=="sitemap")return held();
  }
  try{
    const robots=robotsParser(new URL("/robots.txt",endpoint).href,body);
    const allowed=robots.isAllowed(endpoint,SOURCE_USER_AGENT);
    const matchingLine=robots.getMatchingLineNumber(endpoint,SOURCE_USER_AGENT);
    detail.matchingLine=matchingLine&&matchingLine>0?matchingLine:null;
    if(allowed!==true)return {...detail,disposition:allowed===false?"robots-endpoint-disallowed":"robots-unrecognized"};
    detail.delayMs=Math.max(1000,(robots.getCrawlDelay(SOURCE_USER_AGENT)??0)*1000);
    if(!Number.isFinite(maxDelayMs)||detail.delayMs>maxDelayMs)return {...detail,disposition:"robots-delay-exceeds-budget"};
    return {...detail,disposition:"robots-endpoint-allowed"};
  }catch{return held();}
}

export async function captureLaunchCandidate(id:string, fetchImpl:typeof fetch=fetch, wait:typeof sleep=sleep) {
  const candidate=launchCandidate(id),source=candidate.source,endpoint=source.endpoints[0]!;
  const deadlineAt=Date.now()+25_000;
  const options={fetchImpl,maxBytes:source.maxBytes,timeoutMs:10_000,deadlineAt,attempts:1,
    allowedRedirectHosts:new Set<string>(),maxRedirects:0,requiresAuth:false,
    headers:{"user-agent":SOURCE_USER_AGENT,accept:"application/json,application/rss+xml,application/xml,text/html"}};
  let access:{mode:string;robotsSha256:string|null;robotsStatus:number|null;disposition:string;robotsText?:string;failureCode?:string;
    endpoint?:string;userAgent?:string;delayMs?:number;matchingLine?:number|null}=
    {mode:candidate.accessMode,robotsSha256:null,robotsStatus:null,disposition:"documented-public-repository-api"};
  if(candidate.accessMode==="robots-check"){
    try {
      const robots=await fetchUpstream({...options,url:new URL("/robots.txt",endpoint).href,maxBytes:64000});
      access={mode:"robots-check",robotsSha256:await sha256(robots.body),robotsStatus:robots.status,robotsText:robots.body,
        ...endpointRobotsPolicy(robots.body,endpoint,Math.min(10_000,deadlineAt-Date.now()-options.timeoutMs))};
      if(access.disposition!=="robots-endpoint-allowed")return {sourceId:id,outcome:"access-held",access,packet:null,bytes:null};
    }catch(error){
      if(!(error instanceof UpstreamError)||error.httpStatus!==404)
        return {sourceId:id,outcome:"access-held",access:{...access,disposition:"robots-unavailable",
          robotsStatus:error instanceof UpstreamError?error.httpStatus??null:null,
          failureCode:error instanceof UpstreamError?error.code:"fetch-failed"},packet:null,bytes:null};
      access={...access,robotsStatus:404,disposition:"robots-not-found"};
    }
    await wait(access.delayMs??1000);
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
