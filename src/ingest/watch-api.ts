import { z } from "zod";
import type { D1DatabaseLike } from "./persistence";
import { readWatchDirectory, readWatchSubjectRevision, WatchStorageError } from "./watch-persistence";

type WatchReadEnvironment = { VALLEY_DESK_DB?: D1DatabaseLike; WATCH_PUBLIC_ENABLED?: string };
const PREFIX = "/api/v2/watch/";
export function isWatchReadPath(path: string) { return path.startsWith(PREFIX); }

function response(request: Request, status: number, payload: unknown, additional: Record<string, string> = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(payload), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "cdn-cache-control": "no-store", "x-robots-tag": "noindex", "access-control-allow-origin": "*",
    ...additional,
  } });
}
function error(request: Request, status: number, code: string, message: string) {
  return response(request, status, { error: { code, message } });
}

/** Public reads only. Release qualification must precede enabling this flag;
 * it never converts observations or model output into accepted revisions. */
export async function handleWatchRead(request: Request, env: WatchReadEnvironment): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response(request, 405, { error: { code: "watch-method-not-allowed", message: "Read-only endpoint." } }, { allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  const match = /^\/api\/v2\/watch\/(policy|technology)(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) return error(request, 404, "watch-not-found", "Watch resource not found.");
  if (env.WATCH_PUBLIC_ENABLED !== "true") return error(request, 503, "watch-not-enabled", "Watch data is not yet available.");
  if (!env.VALLEY_DESK_DB) return error(request, 503, "watch-unavailable", "Watch data is temporarily unavailable.");
  const kind = match[1] as "policy" | "technology";
  try {
    const values: Record<string, string> = Object.create(null);
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(values, key) || ["kind", "__proto__", "constructor", "prototype"].includes(key)) {
        return error(request, 400, "watch-invalid-query", "Each supported filter may appear only once.");
      }
      values[key] = value;
    }
    if (!match[2]) {
      const result = await readWatchDirectory(env.VALLEY_DESK_DB, { kind, ...values });
      return response(request, 200, result, { "x-watch-data-state": "unknown" });
    }
    const query = z.object({ lookup: z.enum(["id", "slug"]).default("id") }).strict().parse(values);
    let identity: string;
    try { identity = decodeURIComponent(match[2]); }
    catch { return error(request, 400, "watch-invalid-query", "Invalid subject identifier."); }
    const detail = await readWatchSubjectRevision(env.VALLEY_DESK_DB, kind, identity, query.lookup);
    if (!detail) return error(request, 404, "watch-not-found", "Accepted Watch subject not found.");
    return response(request, 200, detail, { "x-watch-data-state": "unknown" });
  } catch (failure) {
    if (failure instanceof z.ZodError) return error(request, 400, "watch-invalid-query", "Choose supported filters and bounded values.");
    if (failure instanceof WatchStorageError) return error(request, failure.status, failure.code,
      failure.status === 410 ? "This result snapshot has expired. Start a new search." : "Watch data could not be returned.");
    // Database details and private review/source data never enter the response.
    return error(request, 503, "watch-unavailable", "Watch data is temporarily unavailable.");
  }
}
