import { isWatchSlug, parseWatchQuery, watchDirectoryPath, watchQuerySearch, type WatchKind, type WatchQuery } from "../content/watch-query";
import { decodeWatchResponse, WatchReadError, type WatchReadData, type WatchReadErrorCode } from "../content/watch-response";
import { CanonicalInstant } from "../content/watch-schema";

export type WatchPageRoute = {
  key: string; kind: WatchKind; path: string; slug?: string; query: WatchQuery;
  status: 200 | 400 | 404; apiPath?: string;
};
export type WatchPageResult = { route: WatchPageRoute; status: number; data?: WatchReadData;
  error?: WatchReadErrorCode | "method-not-allowed"; deliveryAsOf?: string };
export type WatchPageHead = { title: string; desc: string; canonicalPath: string; status: number };

export function isWatchPagePath(path: string) { return /^\/(policy-watch|technology-watch)(?:\/|$)/.test(path); }

/** Page slugs are literal canonical slugs; query strings are never interpreted as JSON. */
export function parseWatchPageRoute(path: string, search = ""): WatchPageRoute | null {
  if (!isWatchPagePath(path)) return null;
  const kind = path.startsWith("/policy-watch") ? "policy" : "technology";
  const base = watchDirectoryPath(kind);
  const key = `${path}${search}`;
  const match = /^\/(?:policy-watch|technology-watch)(?:\/([^/]+))?\/?$/.exec(path);
  const query = parseWatchQuery(search, kind);
  if (!match || (match[1] !== undefined && !isWatchSlug(match[1]))) {
    return { key, kind, path: base, query, status: 404 };
  }
  const slug = match[1];
  const canonicalPath = slug ? `${base}/${slug}` : base;
  if (slug !== undefined) {
    if (new URLSearchParams(search).size) return { key, kind, path: canonicalPath, slug, query, status: 400 };
    return { key, kind, path: canonicalPath, slug, query, status: 200,
      apiPath: `/api/v2/watch/${kind}/${slug}?lookup=slug` };
  }
  if (query.errors.length) return { key, kind, path: base, query, status: 400 };
  const params = new URLSearchParams(watchQuerySearch(query.values, kind, query.values.cursor));
  return { key, kind, path: base, query, status: 200,
    apiPath: `/api/v2/watch/${kind}${params.size ? `?${params.toString()}` : ""}` };
}

export function watchErrorStatus(code: WatchReadErrorCode | "method-not-allowed") {
  return code === "not-found" ? 404 : code === "invalid-query" ? 400 : code === "held" ? 409 :
    code === "cursor-expired" ? 410 : code === "method-not-allowed" ? 405 : 503;
}

export function watchPageHead(result: WatchPageResult): WatchPageHead {
  const { route, data, status } = result;
  const name = route.kind === "policy" ? "Policy Watch" : "Technology Watch";
  const canonicalPath = route.path;
  const error = result.error ?? (status === 404 ? "not-found" : status === 400 ? "invalid-query" : undefined);
  if (error) {
    const label = error === "not-found" ? "Not found" : error === "held" ? "Record held for review" :
      error === "invalid-query" ? "Check your filters" : error === "cursor-expired" ? "Results expired" :
      error === "method-not-allowed" ? "Method not allowed" : "Watch unavailable";
    const desc = error === "not-found" ? "This page is not published." : error === "held" ?
      "Current source evidence requires review. No current record is being returned." : error === "invalid-query" ?
        "Choose supported filters and bounded values." : error === "cursor-expired" ?
          "This result snapshot has expired. Start a new search." : error === "method-not-allowed" ?
            "This page supports GET and HEAD requests only." : "Watch data is temporarily unavailable.";
    return { title: `${label} | ${name} | The Valley Desk`, desc, canonicalPath, status };
  }
  const item = data?.response.version === "watch-detail-1" ? data.response.item : undefined;
  const context = item?.kind === "policy" ? item.summary?.value : item?.purpose?.value;
  return { title: `${item?.title ?? name} | The Valley Desk`,
    desc: (context ?? (route.kind === "policy" ? "Source-backed regional policy records" :
      "Technology with verified Delaware Valley connections")).slice(0, 320), canonicalPath, status };
}

/** The supplied reader is the in-process read-only handler, never a URL fetcher. */
export async function readWatchPage(request: Request, enabled: boolean,
  reader: (request: Request) => Promise<Response>): Promise<WatchPageResult | null> {
  const url = new URL(request.url);
  const route = parseWatchPageRoute(url.pathname, url.search);
  if (!route) return null;
  if (!enabled) return { route, status: 404, error: "not-found" };
  if (request.method !== "GET" && request.method !== "HEAD") return { route, status: 405, error: "method-not-allowed" };
  if (route.status !== 200 || !route.apiPath) return { route, status: route.status,
    error: route.status === 404 ? "not-found" : "invalid-query" };
  try {
    // HEAD needs the same accepted representation to compute status and metadata.
    const response = await reader(new Request(new URL(route.apiPath, url.origin), {
      method: "GET", headers: { Accept: "application/json" }, signal: request.signal,
    }));
    const deliveryAsOf = response.headers.get("X-Watch-Delivery-As-Of");
    const data = await decodeWatchResponse(response, route.kind, route.slug);
    return { route, status: 200, data, ...(CanonicalInstant.safeParse(deliveryAsOf).success ? { deliveryAsOf: deliveryAsOf! } : {}) };
  } catch (error) {
    const code = error instanceof WatchReadError ? error.code : "unavailable";
    return { route, status: watchErrorStatus(code), error: code };
  }
}
