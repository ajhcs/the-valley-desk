import { z } from "zod";
import { PaHealthEntry } from "../../content/pa-source-freshness";
import { boundedJson } from "../../content/watch-response";
import type { WatchPublicRecord } from "../../content/watch-schema";
import { isWatchSlug, watchQuerySearch, type WatchKind, type WatchQueryValues } from "../../content/watch-query";
import { decodeWatchResponse, WatchReadError, type WatchReadData } from "../../content/watch-response";

export { WatchDirectoryResponse, WatchDetailResponse, WatchReadError, parseWatchResponse } from "../../content/watch-response";
export type { WatchReadData, WatchReadErrorCode } from "../../content/watch-response";

export function watchDirectoryApiPath(kind: WatchKind, values: WatchQueryValues) {
  const query = new URLSearchParams(watchQuerySearch(values, kind, values.cursor));
  return `/api/v2/watch/${kind}${query.size ? `?${query.toString()}` : ""}`;
}

export function watchDetailApiPath(kind: WatchKind, slug: string) {
  if (!isWatchSlug(slug)) throw new TypeError("Invalid Watch dossier slug");
  return `/api/v2/watch/${kind}/${encodeURIComponent(slug)}?lookup=slug`;
}

export async function readWatch(url: string, kind: WatchKind, signal: AbortSignal, slug?: string, fetcher: typeof fetch = fetch): Promise<WatchReadData> {
  const expected = `/api/v2/watch/${kind}`;
  if (slug === undefined ? url !== expected && !url.startsWith(`${expected}?`) : url !== watchDetailApiPath(kind, slug)) {
    throw new TypeError("Watch reads must use the fixed same-origin API");
  }
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" },
      credentials: "omit", cache: "no-store", redirect: "error", signal });
  } catch { throw new WatchReadError("network"); }
  return decodeWatchResponse(response, kind, slug);
}

/** Optional auxiliary read: old servers, unavailable storage and malformed health
 * yield unknown/omitted health and never reject the primary accepted response. */
export async function readPaHealth(items:WatchPublicRecord[],signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<z.infer<typeof PaHealthEntry>[]> {
  const accepted=items.filter(item=>item.kind==='policy'&&item.jurisdiction==='PA');
  if(!accepted.length)return [];
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)controller.abort();
  const timeout=setTimeout(abort,8000);
  try{
    const query=new URLSearchParams();for(const item of accepted)query.append('subject',item.id);
    const response=await fetcher('/api/v2/watch/source-health?'+query,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok){await response.body?.cancel();return [];}
    const parsed=z.object({version:z.literal('pa-source-health-1'),entries:z.array(PaHealthEntry).max(200)}).strict().parse(await boundedJson(response,256000));
    if(parsed.entries.some(entry=>!accepted.some(item=>item.id===entry.subjectId&&item.sources.some(source=>source.sourceId===entry.sourceId)))||new Set(parsed.entries.map(entry=>entry.subjectId+':'+entry.sourceId)).size!==parsed.entries.length)return [];
    return parsed.entries;
  }catch{return [];}finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
}
