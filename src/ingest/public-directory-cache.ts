/**
 * A short-lived edge cache for directory responses. A cached response is reused only while the
 * data version it was built from is unchanged, so a removal or a data load takes effect on the
 * next request. The version reads every removal table in full (they hold hundreds of rows), the
 * study visibility switch and the stored whole-directory totals written after each load.
 */
export type CacheStore = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};
type Db = { prepare(sql: string): { all(): Promise<{ results?: unknown[]; success?: boolean }> } };

export const cacheSeconds = 300;
const keyOrigin = "https://directory-cache.invalid";
const original = "x-directory-cache-control";
const nonceHeader = "x-directory-nonce";
// The edge cache does not vary on custom request headers, so the variant is part of the key and
// the Vary header is set aside while stored.
const varyHeader = "x-directory-vary";

const versionSql = `SELECT
  (SELECT group_concat(github_id) FROM (SELECT github_id FROM public_directory_removals ORDER BY github_id)) projects,
  (SELECT group_concat(id) FROM (SELECT id FROM publication_removals ORDER BY id)) publications,
  (SELECT group_concat(id) FROM (SELECT id FROM study_removals ORDER BY id)) studies,
  (SELECT group_concat(enabled) FROM study_visibility) visibility,
  (SELECT first FROM research_summary_kinds WHERE scope_field='data' AND scope_value='' AND kind='directory') revision,
  (SELECT group_concat(kind||':'||n||':'||works||':'||coalesce(added,'')||':'||coalesce(last,''),'|')
     FROM (SELECT * FROM research_summary_kinds WHERE scope_field='' AND scope_value='' ORDER BY kind)) totals`;

async function digest(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The data version, or undefined when it cannot be read; callers then skip the cache. */
export async function dataVersion(db: Db | undefined, build: string) {
  if (!db) return undefined;
  try {
    const result = await db.prepare(versionSql).all();
    const [row] = result.results ?? [];
    if (result.success === false || !row) return undefined;
    return digest(build + "\n" + JSON.stringify(row));
  } catch {
    return undefined;
  }
}

export function cacheKey(request: Request, version: string, variant: string) {
  const url = new URL(request.url);
  return new Request(`${keyOrigin}/${version}/${variant}${url.pathname}${url.search}`);
}

/** Restores a cached response for this request, giving cached HTML this request's nonce. */
export async function fromCache(cached: Response, nonce: string | undefined) {
  const headers = new Headers(cached.headers);
  const control = headers.get(original);
  const stored = headers.get(nonceHeader);
  const vary = headers.get(varyHeader);
  headers.delete(original);
  headers.delete(nonceHeader);
  headers.delete(varyHeader);
  if (vary) headers.set("vary", vary);
  headers.delete("age");
  if (control) {
    headers.set("cache-control", control);
    headers.set("cdn-cache-control", control);
  }
  headers.set("x-directory-cache", "hit");
  let body: BodyInit | null = cached.body;
  if (stored && nonce && (headers.get("content-type") ?? "").includes("text/html")) {
    body = (await cached.text()).replaceAll(stored, nonce);
  }
  return new Response(body, { status: cached.status, headers });
}

/** A copy of a fresh response that the edge cache will keep for `cacheSeconds`. */
export async function forCache(response: Response, nonce: string | undefined) {
  const headers = new Headers(response.headers);
  headers.set(original, response.headers.get("cache-control") ?? "no-store");
  if (nonce) headers.set(nonceHeader, nonce);
  headers.set("cache-control", `public, max-age=${cacheSeconds}`);
  headers.delete("cdn-cache-control");
  headers.delete("set-cookie");
  const vary = headers.get("vary");
  if (vary) headers.set(varyHeader, vary);
  headers.delete("vary");
  return new Response(await response.clone().arrayBuffer(), { status: response.status, headers });
}

export function defaultCache(): CacheStore | undefined {
  const store = (globalThis as { caches?: { default?: CacheStore } }).caches?.default;
  return store;
}
