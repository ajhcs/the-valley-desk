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
