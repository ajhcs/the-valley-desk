import { z } from "zod";
import { Sha256, WatchId } from "../content/watch-schema";
import { readBoundedText } from "./upstream";
import { decideEditorialProposal, decideSourceRulePolicyProposal, readEditorialProposal, stageEditorialProposal } from "./watch-editorial";
import type { EditorialRuntime } from "./watch-editorial";
import type { D1DatabaseLike } from "./persistence";
import { WatchStorageError } from "./watch-persistence";

function json(request: Request, body: unknown, status = 200) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/** Internal route: the caller authenticates and rate-limits before dispatch.
 * Only validated Access identity authorizes a human-review decision. */
export async function handleWatchEditorialApi(request: Request, db: D1DatabaseLike, pathname: string,
  namedOperator: string | null, runtime: EditorialRuntime) {
  const match = /^\/api\/watch-drafts(?:\/([^/]+)(\/(?:decision|source-rule))?)?$/.exec(pathname);
  if (!match) return json(request, { error: "not_found" }, 404);
  try {
    const id = match[1] ? WatchId.parse(decodeURIComponent(match[1])) : null;
    if (["GET", "HEAD"].includes(request.method) && !match[2]) {
      if (match[1]) {
        const draft = await readEditorialProposal(db, id!);
        return json(request, draft ?? { error: "watch-draft-not-found" }, draft ? 200 : 404);
      }
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some(key => key !== "after") || url.searchParams.getAll("after").length > 1)
        return json(request, { error: "watch-invalid-query" }, 400);
      const after = url.searchParams.get("after");
      if (after !== null) WatchId.parse(after);
      const result = await db.prepare(`SELECT d.id,d.subject_id AS subjectId,d.subject_revision AS subjectRevision,
        d.input_sha256 AS sha256,d.created_at AS createdAt,json_extract(d.payload_json,'$.draft.kind') AS kind
        FROM watch_editorial_drafts d LEFT JOIN watch_editorial_decisions r ON r.draft_id=d.id
        JOIN watch_subjects s ON s.id=d.subject_id AND s.input_revision=d.subject_revision AND s.input_sha256=d.input_sha256
        WHERE r.id IS NULL AND d.id>? ORDER BY d.id LIMIT 51`).bind(after ?? "").all<{ id: string }>();
      if (!Array.isArray(result.results) || ("success" in result && result.success === false))
        throw new Error("watch-queue-storage-unavailable");
      const rows = result.results;
      return json(request, { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null });
    }
    if (request.method !== "POST" || (match[1] && !match[2])) return json(request, { error: "method_not_allowed" }, 405);
    if (match[2] === "/decision" && !namedOperator) return json(request, { error: "named-operator-required" }, 403);
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? ""))
      return json(request, { error: "json-required" }, 415);
    const maximum = match[2] ? 4096 : 500_000;
    if (Number(request.headers.get("content-length")) > maximum) return json(request, { error: "payload_too_large" }, 413);
    let raw: string;
    try { raw = await readBoundedText(new Response(request.body), maximum); }
    catch { return json(request, { error: "payload_too_large" }, 413); }
    const body: unknown = JSON.parse(raw);
    if (!match[1]) return json(request, await stageEditorialProposal(db, body), 201);
    if (match[2] === "/source-rule") {
      const sourceRule = z.object({ sha256: Sha256 }).strict().parse(body);
      return json(request, await decideSourceRulePolicyProposal(db, { id: id!, ...sourceRule }, runtime));
    }
    const decision = z.object({ sha256: Sha256, action: z.enum(["accepted", "rejected"]) }).strict().parse(body);
    return json(request, await decideEditorialProposal(db, { id: id!, ...decision }, namedOperator!, runtime));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof URIError) return json(request, { error: "watch-invalid-request" }, 400);
    if (error instanceof WatchStorageError) return json(request, { error: error.message }, error.status);
    return json(request, { error: "watch-review-unavailable" }, 503);
  }
}
