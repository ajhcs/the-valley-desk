import { z } from "zod";
import { RepresentativeContractError } from "../content/watch-representatives";
import { readBoundedText } from "./upstream";
import { readRepresentatives, readRepresentativeDraft, decideRepresentativeDraft, RepresentativeStorageError } from "./representative-persistence";
import type { RepresentativeSourcePolicy } from "./representative-persistence";
import type { D1DatabaseLike } from "./persistence";

type Environment = { VALLEY_DESK_DB?: D1DatabaseLike; WATCH_PUBLIC_ENABLED?: string };
function json(request: Request, status: number, value: unknown) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "cdn-cache-control": "no-store",
    "x-robots-tag": "noindex" } });
}
function failed(request: Request, failure: unknown) {
  const status = failure instanceof z.ZodError ? 400 : failure instanceof RepresentativeStorageError ? failure.status :
    failure instanceof RepresentativeContractError && /cursor|future-as-of/.test(failure.code) ? 400 : 503;
  return json(request, status, { error: { code: status === 400 ? "representative-invalid-query" : "representative-unavailable" } });
}
export async function handleRepresentativeRead(request: Request, env: Environment, policy: RepresentativeSourcePolicy) {
  if (new URL(request.url).pathname !== "/api/v2/watch/representatives") return json(request, 404, { error: { code: "not-found" } });
  if (!["GET", "HEAD"].includes(request.method)) return json(request, 405, { error: { code: "read-only" } });
  if (env.WATCH_PUBLIC_ENABLED !== "true" || !env.VALLEY_DESK_DB) return json(request, 503, { error: { code: "representative-unavailable" } });
  try {
    const url = new URL(request.url), values: Record<string, unknown> = Object.create(null);
    if (url.search.length > 4096) throw new z.ZodError([]);
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(values, key)) throw new z.ZodError([]);
      values[key] = key === "limit" && /^[1-9][0-9]?$/.test(value) ? Number(value) : value;
    }
    return json(request, 200, await readRepresentatives(env.VALLEY_DESK_DB, values, policy));
  } catch (error) { return failed(request, error); }
}
/** authorize is a server-owned function using the existing bearer/Access boundary.
 * Request headers/body are never themselves an authenticated reviewer identity. */
export async function handleRepresentativeReview(request: Request, env: Environment, policy: RepresentativeSourcePolicy,
  authorize: (request: Request) => Promise<string | null>) {
  const reviewerId = await authorize(request);
  if (!reviewerId) return json(request, 404, { error: { code: "not-found" } });
  const match = /^\/api\/representative-drafts\/([a-zA-Z0-9_-]+)(\/decision)?$/.exec(new URL(request.url).pathname);
  if (!match) return json(request, 404, { error: { code: "not-found" } });
  if (!env.VALLEY_DESK_DB) return json(request, 503, { error: { code: "representative-unavailable" } });
  try {
    if (!match[2] && ["GET", "HEAD"].includes(request.method)) {
      const { row, draft } = await readRepresentativeDraft(env.VALLEY_DESK_DB, match[1]);
      return json(request, 200, { draft, sha256: row.payload_sha256, createdAt: row.created_at });
    }
    if (match[2] && request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json(request, 415, { error: { code: "json-required" } });
      const body = JSON.parse(await readBoundedText(new Response(request.body), 4096));
      const decision = z.object({ sha256: z.string(), decision: z.enum(["accepted", "rejected"]) }).strict().parse(body);
      return json(request, 200, await decideRepresentativeDraft(env.VALLEY_DESK_DB, { id: match[1], ...decision }, reviewerId, policy));
    }
    return json(request, 405, { error: { code: "method-not-allowed" } });
  } catch (error) { return failed(request, error); }
}
