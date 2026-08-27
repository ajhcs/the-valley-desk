import type { D1DatabaseLike } from "./persistence";
import { ContentItem, canPublish } from "../content/schema";
import { retainPublishedIdentity } from "../content/merge";
import {
  OVERRIDABLE_CODES,
  PUBLICATION_POLICY_VERSION,
  SAFETY_CODES,
  parsePublicationOverride,
  validateForPublication,
} from "../content/publication";
import { EDITOR_POLICY_VERSION } from "./editor";
import { resolvePublicOrigin } from "../lib/canonical";
import { SCHEMA_VERSION, buildShaFromEnv, logOps } from "../lib/ops";

type ReviewEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
  REVIEW_API_TOKEN?: string;
  BUILD_SHA?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  PUBLIC_ORIGIN?: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const POST_RATE_LIMIT = 20;
const POST_RATE_WINDOW_MS = 10 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BYTES = 8_192;

type GuardState = {
  posts: Map<string, number[]>;
  idempotency: Map<string, { expiresAt: number; status: number; body: unknown }>;
  postLimit: number;
  windowMs: number;
};

const guards: GuardState = {
  posts: new Map(),
  idempotency: new Map(),
  postLimit: POST_RATE_LIMIT,
  windowMs: POST_RATE_WINDOW_MS,
};

export function configureReviewGuardsForTests(options?: { postLimit?: number; windowMs?: number }) {
  guards.posts.clear();
  guards.idempotency.clear();
  guards.postLimit = options?.postLimit ?? POST_RATE_LIMIT;
  guards.windowMs = options?.windowMs ?? POST_RATE_WINDOW_MS;
}

function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
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

function isJsonContentType(request: Request) {
  const value = request.headers.get("content-type") ?? "";
  return /^application\/json\s*(;|$)/i.test(value);
}

function clientKey(request: Request, token: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  return `${token}:${ip}`;
}

function rateLimitPost(request: Request, token: string) {
  const now = Date.now();
  const key = clientKey(request, token);
  const hits = (guards.posts.get(key) ?? []).filter((stamp) => stamp > now - guards.windowMs);
  if (hits.length >= guards.postLimit) {
    guards.posts.set(key, hits);
    return false;
  }
  hits.push(now);
  guards.posts.set(key, hits);
  return true;
}

function rememberIdempotent(token: string, key: string, status: number, body: unknown) {
  guards.idempotency.set(`${token}:${key}`, {
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    status,
    body,
  });
}

function readIdempotent(token: string, key: string) {
  const cached = guards.idempotency.get(`${token}:${key}`);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    guards.idempotency.delete(`${token}:${key}`);
    return undefined;
  }
  return cached;
}

export function isReviewApiPath(pathname: string) {
  return pathname === "/api/automation/status"
    || pathname === "/api/automation/status/review"
    || pathname.startsWith("/api/review-queue");
}

async function statusPayload(env: ReviewEnv, detailed: boolean) {
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
  const emailDiscoveries = await env.VALLEY_DESK_DB.prepare(`
      SELECT category, status, COUNT(*) AS count
      FROM email_discoveries GROUP BY category, status
    `).all();
  const payload: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    buildSha: buildShaFromEnv(env),
    publicOrigin: resolvePublicOrigin(env.PUBLIC_ORIGIN),
    run,
    queue: counts.results ?? [],
    publications,
    sources: sources.results ?? [],
    reconciliation: reconciliation.results ?? [],
    emailDiscoveries: emailDiscoveries.results ?? [],
  };
  if (!detailed) return payload;
  const review = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, kind, title, source_origin, source_url, item_status, queue_status,
             relevance_score, first_seen_at, last_seen_at
      FROM content_candidates
      WHERE queue_status = 'review'
      ORDER BY COALESCE(relevance_score, -1) DESC, last_seen_at DESC
      LIMIT 20
    `).all();
  const decisions = await env.VALLEY_DESK_DB.prepare(`
      SELECT candidate_id, decision, reviewer, decided_at
      FROM candidate_decisions
      ORDER BY decided_at DESC
      LIMIT 20
  `).all();
  const emailQueue = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, message_id, envelope_to, from_address, from_domain, subject, category, status,
             url_count, urls_json, excerpt, truncated, instruction_like, receive_count,
             first_seen_at, last_seen_at
      FROM email_discoveries
      WHERE status = 'review'
      ORDER BY last_seen_at DESC
      LIMIT 50
    `).all();
  payload.review = { items: review.results ?? [] };
  payload.decisions = decisions.results ?? [];
  payload.emailReview = { items: emailQueue.results ?? [] };
  return payload;
}

export async function handleReviewApi(request: Request, env: ReviewEnv) {
  if (!(await isAuthorized(request, env))) return json({ error: "not_found" }, 404);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === "/api/automation/status" || url.pathname === "/api/automation/status/review") {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
    const detailed = url.pathname === "/api/automation/status/review";
    return json(await statusPayload(env, detailed));
  }

  if (url.pathname === "/api/review-queue") {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
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
  if (decisionMatch) {
    if (method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    }
    if (!isJsonContentType(request)) {
      return json({ error: "unsupported_media_type" }, 415);
    }
    const token = env.REVIEW_API_TOKEN ?? "";
    if (!rateLimitPost(request, token)) {
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (idempotencyKey) {
      if (idempotencyKey.length > 128) return json({ error: "invalid_idempotency_key" }, 400);
      const cached = readIdempotent(token, idempotencyKey);
      if (cached) return json(cached.body, cached.status);
    }
    let raw = "";
    try {
      raw = await request.text();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (raw.length > MAX_JSON_BYTES) return json({ error: "payload_too_large" }, 413);
    let body: { decision?: unknown; note?: unknown; overrides?: unknown };
    try {
      body = JSON.parse(raw) as { decision?: unknown; note?: unknown; overrides?: unknown };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return json({ error: "invalid_decision" }, 400);
    }
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
      return json({ error: "invalid_note" }, 400);
    }
    const note = typeof body.note === "string" ? body.note : undefined;
    let overrides = null;
    if (body.overrides !== undefined) {
      if (body.decision !== "approved") return json({ error: "invalid_overrides" }, 400);
      overrides = parsePublicationOverride(body.overrides, note);
      if (!overrides) return json({ error: "invalid_overrides" }, 400);
      if (overrides.codes.some((code) => SAFETY_CODES.has(code) || !OVERRIDABLE_CODES.has(code))) {
        return json({ error: "invalid_overrides" }, 400);
      }
    }
    let id = "";
    try {
      id = decodeURIComponent(decisionMatch[1]);
    } catch {
      return json({ error: "invalid_candidate_id" }, 400);
    }
    const current = await env.VALLEY_DESK_DB.prepare(
      "SELECT queue_status FROM content_candidates WHERE id = ?",
    ).bind(id).first<{ queue_status: string }>();
    if (current?.queue_status === body.decision) {
      const payload = {
        id,
        decision: body.decision,
        idempotent: true,
        note: "Decision already applied.",
      };
      if (idempotencyKey) rememberIdempotent(token, idempotencyKey, 200, payload);
      return json(payload);
    }
    const decidedAt = new Date().toISOString();
    const reviewer = request.headers.get("cf-access-authenticated-user-email") ?? "review-api-token";
    let approvedContent: ReturnType<typeof ContentItem.parse> | undefined;
    let rejectedContent: ReturnType<typeof ContentItem.parse> | undefined;
    if (body.decision === "approved") {
      const row = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM content_candidates WHERE id = ? AND queue_status = 'review'",
      ).bind(id).first<{ content_json: string }>();
      if (!row) return json({ error: "candidate_not_reviewable" }, 409);
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(row.content_json) as Record<string, unknown>;
      } catch {
        return json({ error: "candidate_not_publishable", issues: [] }, 409);
      }
      const parsed = ContentItem.safeParse({
        ...raw,
        status: "published",
        publishedAt: raw.publishedAt || decidedAt,
        verifiedAt: raw.verifiedAt || decidedAt,
        featured: false,
      });
      if (!parsed.success || !canPublish(parsed.data)) {
        return json({ error: "candidate_not_publishable", issues: parsed.success ? [] : parsed.error.issues }, 409);
      }
      const verdict = validateForPublication(parsed.data, {
        mode: "strict",
        surface: "human-approval",
        now: new Date(decidedAt),
        overrides: overrides ? { ...overrides, reviewer } : null,
      });
      if (!verdict.ok) {
        return json({ error: "candidate_not_publishable", issues: verdict.blocking }, 409);
      }
      approvedContent = parsed.data;
      const live = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM published_content WHERE candidate_id = ? LIMIT 1",
      ).bind(id).first<{ content_json: string }>();
      if (live) {
        let previous: ReturnType<typeof ContentItem.safeParse> | null = null;
        try {
          previous = ContentItem.safeParse(JSON.parse(live.content_json));
        } catch {
          previous = null;
        }
        if (previous?.success) {
          approvedContent = ContentItem.parse(retainPublishedIdentity(previous.data, approvedContent));
        }
      }
    } else {
      const row = await env.VALLEY_DESK_DB.prepare(
        "SELECT content_json FROM content_candidates WHERE id = ? AND queue_status IN ('review', 'approved')",
      ).bind(id).first<{ content_json: string }>();
      if (!row) return json({ error: "candidate_not_reviewable" }, 409);
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(row.content_json) as Record<string, unknown>;
      } catch {
        return json({ error: "candidate_not_publishable", issues: [] }, 409);
      }
      const parsed = ContentItem.safeParse({
        ...raw,
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
        note?.trim() || overrides?.note || null,
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
        )
        SELECT c.id, ?, ?, ?, ?, ?, ?, ?, ?
        FROM content_candidates c
        WHERE c.id = ? AND c.queue_status = 'approved' AND c.reviewed_at = ?
        ON CONFLICT(candidate_id) DO UPDATE SET
          kind = excluded.kind,
          slug = published_content.slug,
          content_json = excluded.content_json,
          policy_version = excluded.policy_version,
          decision_json = excluded.decision_json,
          updated_at = excluded.updated_at
      `).bind(
        approvedContent.id,
        approvedContent.kind,
        approvedContent.slug,
        JSON.stringify(approvedContent),
        EDITOR_POLICY_VERSION,
        JSON.stringify({
          action: "publish",
          rule: "human-approval",
          policyVersion: PUBLICATION_POLICY_VERSION,
          overrides: overrides ?? undefined,
        }),
        approvedContent.publishedAt || decidedAt,
        decidedAt,
        id,
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
    const payload = {
      id,
      decision: body.decision,
      result,
      note: approvedContent
        ? "Approved candidate is now live in the dynamic site and feeds."
        : "Candidate rejected and removed from live publication if present.",
    };
    if (idempotencyKey) rememberIdempotent(token, idempotencyKey, 200, payload);
    logOps("publication", {
      outcome: body.decision,
      candidateId: id,
      method: "human-review",
    });
    return json(payload);
  }

  return json({ error: "not_found" }, 404);
}
