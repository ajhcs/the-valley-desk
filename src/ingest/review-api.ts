import type { D1DatabaseLike } from "./persistence";
import { ContentItem, canPublish } from "../content/schema";
import { retainPublishedIdentity } from "../content/merge";
import { EDITOR_POLICY_VERSION } from "./editor";

type ReviewEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
  REVIEW_API_TOKEN?: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function tokenMatches(expected: string, actual: string) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

async function isAuthorized(request: Request, env: ReviewEnv) {
  if (!env.REVIEW_API_TOKEN) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return tokenMatches(env.REVIEW_API_TOKEN, auth.slice(7));
}

function boundedLimit(url: URL) {
  const parsed = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
}

export async function handleReviewApi(request: Request, env: ReviewEnv) {
  if (!(await isAuthorized(request, env))) return json({ error: "not_found" }, 404);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/automation/status") {
    const run = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, started_at, finished_at, state, item_count, notes_json, error
      FROM ingest_runs ORDER BY started_at DESC LIMIT 1
    `).first();
    const counts = await env.VALLEY_DESK_DB.prepare(`
      SELECT queue_status, COUNT(*) AS count
      FROM content_candidates GROUP BY queue_status
    `).all();
    const publications = await env.VALLEY_DESK_DB.prepare(
      "SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM published_content",
    ).first();
    const sources = await env.VALLEY_DESK_DB.prepare(`
      SELECT source_id, origin, source_type, source_url, state, complete, item_count,
             consecutive_failures, last_checked_at, last_success_at, last_error
      FROM source_health ORDER BY source_type, source_id
    `).all();
    const reconciliation = await env.VALLEY_DESK_DB.prepare(`
      SELECT action, COUNT(*) AS count, MAX(reconciled_at) AS reconciled_at
      FROM publication_reconciliations GROUP BY action
    `).all();
    return json({
      run,
      queue: counts.results ?? [],
      publications,
      sources: sources.results ?? [],
      reconciliation: reconciliation.results ?? [],
    });
  }

  if (request.method === "GET" && url.pathname === "/api/review-queue") {
    const status = url.searchParams.get("status") ?? "review";
    if (!new Set(["review", "approved", "rejected"]).has(status)) {
      return json({ error: "invalid_status" }, 400);
    }
    const rows = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, kind, title, source_origin, source_url, item_status, queue_status,
             relevance_score, content_json, enrichment_json, first_seen_at, last_seen_at
      FROM content_candidates
      WHERE queue_status = ?
      ORDER BY COALESCE(relevance_score, -1) DESC, last_seen_at DESC
      LIMIT ?
    `).bind(status, boundedLimit(url)).all();
    return json({ items: rows.results ?? [] });
  }

  const decisionMatch = /^\/api\/review-queue\/([^/]+)\/decision$/.exec(url.pathname);
  if (request.method === "POST" && decisionMatch) {
    let body: { decision?: unknown; note?: unknown };
    try {
      body = await request.json() as { decision?: unknown; note?: unknown };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return json({ error: "invalid_decision" }, 400);
    }
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
      return json({ error: "invalid_note" }, 400);
    }
    const id = decodeURIComponent(decisionMatch[1]);
    const decidedAt = new Date().toISOString();
    const reviewer = request.headers.get("cf-access-authenticated-user-email") ?? "review-api-token";
    let approvedContent: ReturnType<typeof ContentItem.parse> | undefined;
    let rejectedContent: ReturnType<typeof ContentItem.parse> | undefined;
    if (body.decision === "approved") {
      const row = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM content_candidates WHERE id = ? AND queue_status = 'review'",
      ).bind(id).first<{ content_json: string }>();
      if (!row) return json({ error: "candidate_not_reviewable" }, 409);
      const parsed = ContentItem.safeParse({
        ...JSON.parse(row.content_json),
        status: "published",
        publishedAt: JSON.parse(row.content_json).publishedAt || decidedAt,
        featured: false,
      });
      if (!parsed.success || !canPublish(parsed.success ? parsed.data : { kind: "", status: "" })) {
        return json({ error: "candidate_not_publishable", issues: parsed.success ? [] : parsed.error.issues }, 409);
      }
      approvedContent = parsed.data;
      const live = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM published_content WHERE candidate_id = ? LIMIT 1",
      ).bind(id).first<{ content_json: string }>();
      if (live) {
        const previous = ContentItem.safeParse(JSON.parse(live.content_json));
        if (previous.success) {
          approvedContent = ContentItem.parse(retainPublishedIdentity(previous.data, approvedContent));
        }
      }
    } else {
      const row = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM content_candidates WHERE id = ? AND queue_status IN ('review', 'approved')",
      ).bind(id).first<{ content_json: string }>();
      if (!row) return json({ error: "candidate_not_reviewable" }, 409);
      const parsed = ContentItem.safeParse({
        ...JSON.parse(row.content_json),
        status: "unpublished",
        featured: false,
      });
      if (!parsed.success) return json({ error: "candidate_not_publishable", issues: parsed.error.issues }, 409);
      rejectedContent = parsed.data;
    }
    const reviewableStatus = approvedContent ? "= 'review'" : "IN ('review', 'approved')";
    const statements = [
      env.VALLEY_DESK_DB.prepare(`
        UPDATE content_candidates
        SET queue_status = ?, reviewed_at = ?, item_status = ?, content_json = COALESCE(?, content_json)
        WHERE id = ? AND queue_status ${reviewableStatus}
      `).bind(
        body.decision,
        decidedAt,
        approvedContent ? "published" : "unpublished",
        JSON.stringify(approvedContent ?? rejectedContent),
        id,
      ),
      env.VALLEY_DESK_DB.prepare(`
        INSERT INTO candidate_decisions (candidate_id, decision, note, reviewer, decided_at)
        SELECT id, ?, ?, ?, ? FROM content_candidates
        WHERE id = ? AND queue_status = ? AND reviewed_at = ?
      `).bind(
        body.decision,
        body.note?.trim() || null,
        reviewer,
        decidedAt,
        id,
        body.decision,
        decidedAt,
      ),
    ];
    if (approvedContent) {
      statements.push(env.VALLEY_DESK_DB.prepare(`
        INSERT INTO published_content (
          candidate_id, id, kind, slug, content_json, policy_version, decision_json,
          first_published_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          kind = excluded.kind,
          slug = published_content.slug,
          content_json = excluded.content_json,
          policy_version = excluded.policy_version,
          decision_json = excluded.decision_json,
          updated_at = excluded.updated_at
      `).bind(
        id,
        approvedContent.id,
        approvedContent.kind,
        approvedContent.slug,
        JSON.stringify(approvedContent),
        EDITOR_POLICY_VERSION,
        JSON.stringify({ action: "publish", rule: "human-approval" }),
        approvedContent.publishedAt || decidedAt,
        decidedAt,
      ));
      for (const alias of approvedContent.previousSlugs ?? []) {
        if (!alias || alias === approvedContent.slug) continue;
        statements.push(env.VALLEY_DESK_DB.prepare(`
          INSERT INTO content_slug_aliases (alias_slug, kind, content_id, candidate_id, created_at)
          SELECT ?, p.kind, p.id, p.candidate_id, ?
          FROM published_content p
          WHERE p.candidate_id = ? AND p.slug != ?
          ON CONFLICT(kind, alias_slug) DO UPDATE SET
            content_id = excluded.content_id,
            candidate_id = excluded.candidate_id
          WHERE content_slug_aliases.content_id = excluded.content_id
        `).bind(alias, decidedAt, id, alias));
      }
    } else {
      statements.push(env.VALLEY_DESK_DB.prepare(`
        INSERT INTO publication_reconciliations (
          candidate_id, source_id, action, missing_count, reason, run_id, reconciled_at
        )
        SELECT c.id, 'human-review', 'withdrawn', c.missing_count,
               'Withdrawn by authenticated review decision', c.last_run_id, ?
        FROM content_candidates c
        JOIN published_content p ON p.candidate_id = c.id
        WHERE c.id = ?
      `).bind(decidedAt, id));
      statements.push(env.VALLEY_DESK_DB.prepare(
        "DELETE FROM published_content WHERE candidate_id = ?",
      ).bind(id));
    }
    const [result] = await env.VALLEY_DESK_DB.batch(statements);
    return json({
      id,
      decision: body.decision,
      result,
      note: approvedContent
        ? "Approved candidate is now live in the dynamic site and feeds."
        : "Candidate rejected and removed from live publication if present.",
    });
  }

  return json({ error: "not_found" }, 404);
}
