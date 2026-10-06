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
import { reviewLeadershipObservation } from "./executive-persistence";
import { resolvePublicOrigin } from "../lib/canonical";
import { SCHEMA_VERSION, buildShaFromEnv, logOps } from "../lib/ops";
import { buildRuntimeLeadershipCoverage } from "../lib/operational-status";
import { officialSourceRegistry } from "./official-source-discovery";
import { markEmailPdfExtractionFailed, persistEmailPdfPageEvidence } from "./email";
import { handlePolicyPdfApi } from "./policy-pdf";
import { handleWatchEditorialApi } from "./watch-editorial-api";
import { createWatchEditorialRuntime } from "./watch-editorial-runtime";
import { handleRepresentativeReview } from "./representative-api";
import { resolveRepresentativeSourcePolicy } from "./representative-runtime";
import { regionalEvidenceReviewPayload } from "./regional-evidence-review";
import { tupleKey } from "../content/watch-schema";
import { syncPublishedEventCalendar } from "./event-calendar-runtime";

type ReviewEnv = {
  EVENT_CALENDAR_COLLECTION_ENABLED?: string;
  VALLEY_DESK_DB: D1DatabaseLike;
  REVIEW_API_TOKEN?: string;
  BUILD_SHA?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  PUBLIC_ORIGIN?: string;
};

export type ReviewApiOptions = {
  /** Set only after trusted platform identity or signature-verified Access JWT validation. */
  trustedAccessEmail?: string;
  /** Re-map an Access-only prefix (for example /ops/api) to /api routes. */
  routePrefix?: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const POST_RATE_LIMIT = 20;
const POST_RATE_WINDOW_MS = 10 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BYTES = 8_192;
const MAX_PDF_EXTRACTION_JSON_BYTES = 512_000;

type SourceHealthStatusRow = {
  source_id: string;
  origin: string;
  source_type: string;
  source_url: string | null;
  state: string;
  complete: number;
  item_count: number;
  consecutive_failures: number;
  last_checked_at: string;
  last_success_at: string | null;
  last_error: string | null;
  next_attempt_at: string | null;
  last_http_status: number | null;
  requires_auth: number;
  last_fallback_url: string | null;
  last_primary_success_at?: string | null;
  last_fallback_success_at?: string | null;
  institution_ids_json: string | null;
};

type CoverageStatusRow = {
  id: string;
  short_name: string;
  official_source_status: string;
};

type RuntimeLeadershipSourceRow = {
  source_id: string;
  cadence: string | null;
  institution_id: string;
  state: string | null;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_attempt_at: string | null;
  consecutive_failures: number | null;
  last_error: string | null;
};

function boundedText(value: unknown, max = 240) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function boundedStringArray(value: unknown, max = 8) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, max)
      : [];
  } catch {
    return [];
  }
}

function boundedCount(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, 50_000) : 0;
}

function boundedCollectorPlatforms(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = undefined; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return Object.fromEntries(["linkedin", "x"].flatMap((platform) => {
    const candidate = record[platform];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const reason = boundedText(row.reason, 500);
    return [[platform, {
      state: boundedText(row.state, 32) ?? "unknown",
      accessVerified: row.accessVerified === true,
      targetsChecked: boundedCount(row.targetsChecked),
      postsSeen: boundedCount(row.postsSeen),
      accepted: boundedCount(row.accepted),
      duplicates: boundedCount(row.duplicates),
      failures: boundedCount(row.failures),
      ...(reason ? { reason } : {}),
    }]];
  }));
}

function boundedCollectorFailureReasons(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = undefined; }
  }
  return Array.isArray(parsed)
    ? parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => boundedText(entry, 500))
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 20)
    : [];
}

function normalizedCollectorRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return {
    ...row,
    platforms: boundedCollectorPlatforms(row.platforms_json),
    failureReasons: boundedCollectorFailureReasons(row.failure_reasons_json),
  };
}

function sourceFailureAgeMs(row: SourceHealthStatusRow, nowMs: number) {
  if (["healthy", "healthy-empty", "disabled", "misconfigured"].includes(row.state)) return null;
  const lastSuccessMs = row.last_success_at ? Date.parse(row.last_success_at) : NaN;
  return Number.isFinite(lastSuccessMs) ? Math.max(0, nowMs - lastSuccessMs) : null;
}

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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readRequestTextBounded(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream may have been cancelled */ }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function isAuthorized(request: Request, env: ReviewEnv, trustedAccessEmail?: string) {
  if (trustedAccessEmail === "clyons@ajhcs.org") return true;
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
  return /^\/api\/(?:policy-background|policy-pdf|policy-versions|policy-provisions)(?:\/|$)/.test(pathname)
    || /^\/api\/(?:watch-drafts|representative-drafts)(?:\/|$)/.test(pathname)
    || pathname === "/api/automation/status"
    || pathname === "/api/automation/status/review"
    || pathname === "/api/automation/status/regional-review"
    || pathname.startsWith("/api/executive-observations")
    || pathname.startsWith("/api/email-pdf-attachments")
    || pathname.startsWith("/api/review-queue");
}

async function statusPayload(env: ReviewEnv, detailed: boolean) {
  const nowMs = Date.now();
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
      SELECT * FROM source_health ORDER BY source_type, source_id
    `).all<SourceHealthStatusRow>();
  const sourceHealth = (sources.results ?? []).map((row) => ({
    source_id: row.source_id,
    origin: row.origin,
    source_type: row.source_type,
    source_url: row.source_url,
    state: row.state,
    complete: row.complete,
    item_count: row.item_count,
    consecutive_failures: row.consecutive_failures,
    last_checked_at: row.last_checked_at,
    last_success_at: row.last_success_at,
    last_primary_success_at: row.last_primary_success_at ?? null,
    last_fallback_success_at: row.last_fallback_success_at ?? null,
    last_error: boundedText(row.last_error),
    next_attempt_at: row.next_attempt_at,
    last_http_status: row.last_http_status,
    requires_auth: row.requires_auth,
    last_fallback_url: row.last_fallback_url,
    institution_ids: boundedStringArray(row.institution_ids_json),
    failure_age_ms: sourceFailureAgeMs(row, nowMs),
  }));
  const reconciliation = await env.VALLEY_DESK_DB.prepare(`
      SELECT action, COUNT(*) AS count, MAX(reconciled_at) AS reconciled_at
      FROM publication_reconciliations GROUP BY action
    `).all();
  const emailDiscoveries = await env.VALLEY_DESK_DB.prepare(`
      SELECT category, status, COUNT(*) AS count
      FROM email_discoveries GROUP BY category, status
    `).all();
  let signalVerification: Record<string, unknown> = { available: false };
  try {
    const states = await env.VALLEY_DESK_DB.prepare(`
      SELECT verification_state, COUNT(*) AS count
      FROM email_discoveries GROUP BY verification_state ORDER BY verification_state
    `).all();
    const pointers = await env.VALLEY_DESK_DB.prepare(`
      SELECT state, COUNT(*) AS count
      FROM signal_pointer_verifications GROUP BY state ORDER BY state
    `).all();
    const authentication = await env.VALLEY_DESK_DB.prepare(`
      SELECT auth_state, COUNT(*) AS count,
             MIN(CASE WHEN auth_state IN ('pending', 'failed') THEN first_seen_at END) AS oldest_pending_at,
             MAX(auth_attempted_at) AS last_attempted_at
      FROM email_discoveries GROUP BY auth_state ORDER BY auth_state
    `).all();
    signalVerification = {
      available: true,
      discoveries: states.results ?? [],
      pointers: pointers.results ?? [],
      emailAuthentication: authentication.results ?? [],
    };
  } catch (error) {
    signalVerification = {
      available: false,
      error: error instanceof Error ? error.message : "Signal verification schema unavailable",
    };
  }
  let officialSourceDiscovery: Record<string, unknown> = { available: false };
  try {
    const policySourceIds = officialSourceRegistry.sources
      .filter((source) => source.category === "policy" && source.status === "enabled")
      .map((source) => source.id);
    const policyPlaceholders = policySourceIds.map(() => "?").join(",");
    const windowEnd = new Date(nowMs).toISOString();
    const windowStart = new Date(nowMs - 30 * 86_400_000).toISOString();
    const schedules = await env.VALLEY_DESK_DB.prepare(`
      SELECT state, COUNT(*) AS count
      FROM official_source_schedule GROUP BY state ORDER BY state
    `).all();
    const snapshots = await env.VALLEY_DESK_DB.prepare(`
      SELECT state, COUNT(*) AS count
      FROM official_source_snapshots GROUP BY state ORDER BY state
    `).all();
    const candidates = await env.VALLEY_DESK_DB.prepare(`
      SELECT status, relevance_decision, COUNT(*) AS count
      FROM official_source_candidates
      GROUP BY status, relevance_decision
      ORDER BY status, relevance_decision
    `).all();
    const policySources = await env.VALLEY_DESK_DB.prepare(`
      SELECT COUNT(*) AS monitored,
        SUM(CASE WHEN state NOT IN ('pending', 'disabled') THEN 1 ELSE 0 END) AS attempted,
        SUM(CASE WHEN state IN ('success', 'unchanged') THEN 1 ELSE 0 END) AS healthy
      FROM official_source_schedule WHERE source_id IN (${policyPlaceholders})
    `).bind(...policySourceIds).first<{ monitored: number; attempted: number; healthy: number }>();
    const policyCandidates = await env.VALLEY_DESK_DB.prepare(`
      SELECT COUNT(*) AS discovered,
        SUM(CASE WHEN detail_disposition = 'active' THEN 1 ELSE 0 END) AS actionable,
        SUM(CASE WHEN detail_disposition = 'filtered' THEN 1 ELSE 0 END) AS filtered,
        SUM(CASE WHEN detail_disposition = 'active' AND published_at IS NOT NULL THEN 1 ELSE 0 END) AS dated,
        SUM(CASE WHEN detail_disposition = 'active' AND detail_state = 'success' THEN 1 ELSE 0 END) AS detail_complete,
        SUM(CASE WHEN detail_disposition = 'active' AND relevance_decision = 'accept' THEN 1 ELSE 0 END) AS relevance_accepted,
        SUM(CASE WHEN detail_disposition = 'active' AND content_item_id IS NOT NULL THEN 1 ELSE 0 END) AS converted,
        SUM(CASE WHEN detail_disposition = 'active' AND p.candidate_id IS NOT NULL THEN 1 ELSE 0 END) AS published,
        SUM(CASE WHEN detail_disposition = 'active' AND m.candidate_id IS NOT NULL THEN 1 ELSE 0 END) AS brief_or_blocker,
        AVG(CASE WHEN p.first_published_at IS NOT NULL AND c.published_at IS NOT NULL
          THEN MAX(0, (julianday(p.first_published_at) - julianday(c.published_at)) * 24) END) AS average_publication_hours
      FROM official_source_candidates c
      LEFT JOIN published_content p ON p.candidate_id = c.content_item_id
      LEFT JOIN (
        SELECT candidate_id, MIN(recorded_at) AS first_milestone_at
        FROM policy_review_milestones GROUP BY candidate_id
      ) m ON m.candidate_id = c.content_item_id
      WHERE c.category = 'policy' AND c.discovered_at >= ? AND c.discovered_at < ?
    `).bind(windowStart, windowEnd).first<Record<string, number | null>>();
    const policySourcePerformance = await env.VALLEY_DESK_DB.prepare(`
      SELECT s.source_id, s.state, s.last_success_at, s.next_attempt_at, s.last_error,
        MAX(c.discovered_at) AS last_discovery_at,
        MAX(CASE WHEN c.relevance_decision = 'accept' THEN c.discovered_at END) AS last_substantive_discovery_at,
        SUM(CASE WHEN c.detail_disposition = 'active' AND c.detail_state IN ('failed', 'blocked') THEN 1 ELSE 0 END) AS actionable_detail_failures,
        SUM(CASE WHEN c.detail_disposition = 'filtered' THEN 1 ELSE 0 END) AS filtered_candidates,
        SUM(CASE WHEN c.relevance_decision IN ('reject', 'review') THEN 1 ELSE 0 END) AS relevance_holds,
        AVG(CASE WHEN c.published_at IS NOT NULL
          THEN MAX(0, (julianday(c.discovered_at) - julianday(c.published_at)) * 24) END) AS average_detection_hours,
        MIN(CASE WHEN c.content_item_id IS NOT NULL AND m.first_milestone_at IS NULL
          THEN c.discovered_at END) AS oldest_unresolved_review_at,
        AVG(CASE WHEN m.first_milestone_at IS NOT NULL AND c.published_at IS NOT NULL
          THEN MAX(0, (julianday(m.first_milestone_at) - julianday(c.published_at)) * 24) END) AS average_brief_or_blocker_hours
      FROM official_source_schedule s
      LEFT JOIN official_source_candidates c ON c.source_id = s.source_id AND c.category = 'policy'
      LEFT JOIN (
        SELECT candidate_id, MIN(recorded_at) AS first_milestone_at
        FROM policy_review_milestones GROUP BY candidate_id
      ) m ON m.candidate_id = c.content_item_id
      WHERE s.source_id IN (${policyPlaceholders})
      GROUP BY s.source_id, s.state, s.last_success_at, s.next_attempt_at, s.last_error
      ORDER BY s.source_id
    `).bind(...policySourceIds).all();
    const policyBenchmarks = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, instrument_id, first_public_at, correspondence_at, detected_at,
             brief_or_blocker_at, miss_reason, source_urls_json,
             CASE WHEN detected_at IS NOT NULL
               THEN MAX(0, (julianday(detected_at) - julianday(first_public_at)) * 24) END AS detection_hours,
             CASE WHEN brief_or_blocker_at IS NOT NULL
               THEN MAX(0, (julianday(brief_or_blocker_at) - julianday(first_public_at)) * 24) END AS brief_or_blocker_hours
      FROM policy_benchmark_leads ORDER BY correspondence_at DESC LIMIT 20
    `).all();
    const metric = (numerator: number, denominator: number) => ({
      numerator,
      denominator,
      value: denominator > 0 ? numerator / denominator : null,
    });
    const discovered = Number(policyCandidates?.discovered ?? 0);
    const actionable = Number(policyCandidates?.actionable ?? 0);
    const dated = Number(policyCandidates?.dated ?? 0);
    const detailComplete = Number(policyCandidates?.detail_complete ?? 0);
    const relevanceAccepted = Number(policyCandidates?.relevance_accepted ?? 0);
    const converted = Number(policyCandidates?.converted ?? 0);
    const published = Number(policyCandidates?.published ?? 0);
    const attempted = Number(policySources?.attempted ?? 0);
    const healthy = Number(policySources?.healthy ?? 0);
    const zeroOutputReason = published > 0 ? null
      : actionable === 0 ? (discovered === 0 ? "no-policy-discoveries" : "all-policy-discoveries-filtered")
        : dated === 0 ? "no-source-publication-dates"
          : detailComplete === 0 ? "no-complete-detail-evidence"
            : relevanceAccepted === 0 ? "no-relevance-accepted-candidates"
              : converted === 0 ? "no-editorial-conversions"
                : "no-policy-publications";
    officialSourceDiscovery = {
      available: true,
      schedules: schedules.results ?? [],
      snapshots: snapshots.results ?? [],
      candidates: candidates.results ?? [],
      policyMetrics: {
        windowStart,
        windowEnd,
        definitions: {
          sourceCoverage: "healthy-or-unchanged policy schedules / attempted policy schedules",
          publicationDateCoverage: "policy candidates with source-authored published_at / policy candidates discovered in window",
          detailCoverage: "policy candidates with successful bounded detail evidence / policy candidates discovered in window",
          conversionRate: "converted policy candidates / relevance-accepted policy candidates",
          publicationRate: "published policy candidates / converted policy candidates",
          publicationTimelinessHours: "average non-negative hours from source-authored publication/development time to first publication",
          detectionTarget: "source-authored publication/development to discovery: <= 1 hour",
          briefOrBlockerTarget: "source-authored publication/development to a cited brief or persisted explicit blocker: <= 2 hours",
        },
        sources: {
          registered: policySourceIds.length,
          monitored: Number(policySources?.monitored ?? 0),
          attempted,
          healthy,
        },
        candidates: {
          discovered,
          actionable,
          filtered: Number(policyCandidates?.filtered ?? 0),
          dated,
          detailComplete,
          relevanceAccepted,
          converted,
          published,
          briefOrBlocker: Number(policyCandidates?.brief_or_blocker ?? 0),
        },
        rates: {
          sourceCoverage: metric(healthy, attempted),
          publicationDateCoverage: metric(dated, actionable),
          detailCoverage: metric(detailComplete, actionable),
          conversionRate: metric(converted, relevanceAccepted),
          publicationRate: metric(published, converted),
        },
        averagePublicationHours: policyCandidates?.average_publication_hours ?? null,
        perSource: policySourcePerformance.results ?? [],
        missedLeadBenchmarks: policyBenchmarks.results ?? [],
        zeroOutputReason,
      },
    };
  } catch (error) {
    officialSourceDiscovery = {
      available: false,
      error: error instanceof Error ? error.message : "Official source discovery schema unavailable",
    };
  }
  let executiveIntelligence: Record<string, unknown> = { available: false };
  try {
    const coverage = await env.VALLEY_DESK_DB.prepare(`
      SELECT id, name, short_name, covered, official_source_status, official_source_note
      FROM covered_institutions
      WHERE covered = 1
      ORDER BY short_name
    `).all<CoverageStatusRow & { name: string; covered: number; official_source_note: string | null }>();
    const sourceStates = await env.VALLEY_DESK_DB.prepare(`
      SELECT state, COUNT(*) AS count
      FROM scheduled_source_state GROUP BY state ORDER BY state
    `).all();
    const runtimeSources = await env.VALLEY_DESK_DB.prepare(`
      SELECT c.id AS source_id, c.institution_id, c.cadence, s.state,
             s.last_attempted_at, s.last_success_at, s.next_attempt_at,
             s.consecutive_failures, s.last_error
      FROM coverage_sources c
      LEFT JOIN scheduled_source_state s ON s.source_id = c.id
      WHERE c.monitor = 1 AND c.status = 'enabled'
      ORDER BY c.institution_id, c.id
    `).all<RuntimeLeadershipSourceRow>();
    const observations = await env.VALLEY_DESK_DB.prepare(`
      SELECT verification_status, COUNT(*) AS count
      FROM source_observations GROUP BY verification_status ORDER BY verification_status
    `).all();
    const configured = (coverage.results ?? []).map((row) => ({
      institutionId: row.id,
      shortName: row.short_name,
      configuredStatus: row.official_source_status === "active" ? "active" as const : "degraded" as const,
      sourceIds: (runtimeSources.results ?? [])
        .filter((source) => source.institution_id === row.id)
        .map((source) => source.source_id),
    }));
    const runtimeCoverage = buildRuntimeLeadershipCoverage(
      configured,
      (runtimeSources.results ?? []).map((source) => ({
        sourceId: source.source_id,
        institutionId: source.institution_id,
        cadence: source.cadence,
        state: source.state,
        lastAttemptedAt: source.last_attempted_at,
        lastSuccessAt: source.last_success_at,
        nextAttemptAt: source.next_attempt_at,
        consecutiveFailures: source.consecutive_failures ?? 0,
        lastError: boundedText(source.last_error),
      })),
      new Date(nowMs),
    ).map((row) => ({
      ...row,
      sourceStates: row.sourceStates.map((source) => ({
        sourceId: source.sourceId,
        state: source.state,
        rawState: source.rawState,
        cadence: source.cadence,
        freshnessBudgetMs: source.freshnessBudgetMs,
        freshUntilAt: source.freshUntilAt,
        coverageCurrent: source.coverageCurrent,
        lastSuccessAt: source.lastSuccessAt,
        lastAttemptedAt: source.lastAttemptedAt,
        nextRetryAt: source.nextRetryAt,
        failureAgeMs: source.failureAgeMs,
        consecutiveFailures: source.consecutiveFailures,
        reason: boundedText(source.reason),
      })),
    }));
    executiveIntelligence = {
      available: true,
      coverage: coverage.results ?? [],
      sourceStates: sourceStates.results ?? [],
      observations: observations.results ?? [],
      runtimeCoverage,
    };
  } catch (error) {
    executiveIntelligence = {
      available: false,
      error: error instanceof Error ? error.message : "Executive intelligence schema unavailable",
    };
  }
  let socialEvidence: Record<string, unknown> = { available: false };
  try {
    const packets = await env.VALLEY_DESK_DB.prepare(`
      SELECT status, COUNT(*) AS count, MAX(last_seen_at) AS last_seen_at,
             MAX(processed_at) AS last_processed_at
      FROM social_evidence_packets
      GROUP BY status ORDER BY status
    `).all();
    socialEvidence = { available: true, packets: packets.results ?? [] };
  } catch (error) {
    socialEvidence = {
      available: false,
      error: error instanceof Error ? error.message : "Social evidence schema unavailable",
    };
  }
  let valeCollector: Record<string, unknown> = {
    available: false,
    collector: "vale",
    latest: null,
    lastSuccessful: null,
  };
  try {
    const [latest, lastSuccessful] = await Promise.all([
      env.VALLEY_DESK_DB.prepare(`
        SELECT id, manifest_version, manifest_hash, started_at, finished_at, outcome,
               accounts_checked, posts_seen, accepted, duplicates, failures,
               platforms_json, failure_reasons_json, consecutive_failures, paused_at
        FROM social_collector_runs
        WHERE collector = 'vale'
        ORDER BY finished_at DESC, id DESC LIMIT 1
      `).first(),
      env.VALLEY_DESK_DB.prepare(`
        SELECT id, manifest_version, manifest_hash, started_at, finished_at, outcome,
               accounts_checked, posts_seen, accepted, duplicates, failures,
               platforms_json, failure_reasons_json, consecutive_failures, paused_at
        FROM social_collector_runs
        WHERE collector = 'vale' AND outcome = 'success'
        ORDER BY finished_at DESC, id DESC LIMIT 1
      `).first(),
    ]);
    valeCollector = {
      available: true,
      collector: "vale",
      latest: normalizedCollectorRow(latest),
      lastSuccessful: normalizedCollectorRow(lastSuccessful),
    };
  } catch (error) {
    valeCollector = {
      available: false,
      collector: "vale",
      latest: null,
      lastSuccessful: null,
      error: error instanceof Error ? error.message : "Social collector schema unavailable",
    };
  }
  let modelHealth: Record<string, unknown> = { available: false };
  try {
    const attempts = await env.VALLEY_DESK_DB.prepare(`
      SELECT enrichment_outcome AS outcome, COUNT(*) AS count,
             MAX(enrichment_attempted_at) AS last_attempted_at
      FROM content_candidates
      WHERE enrichment_attempted_at IS NOT NULL
      GROUP BY enrichment_outcome ORDER BY enrichment_outcome
    `).all();
    modelHealth = { available: true, attempts: attempts.results ?? [] };
  } catch (error) {
    modelHealth = {
      available: false,
      error: error instanceof Error ? error.message : "Editor model health unavailable",
    };
  }
  let alerts: Record<string, unknown> = { available: false, open: [] };
  try {
    const open = await env.VALLEY_DESK_DB.prepare(`
      SELECT fingerprint, event, severity, state, condition_state,
             institution_id, subsystem, group_key, occurrence_count,
             first_seen_at, last_seen_at, next_notify_at,
             last_notification_attempt_at, last_notified_at,
             notification_attempt_count, last_notification_error,
             recovery_count, last_recovered_at, resolved_at, detail_json,
             recovery_detail_json
      FROM operational_alerts
      WHERE state = 'open'
      ORDER BY group_key,
               CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               last_seen_at DESC
      LIMIT 50
    `).all();
    alerts = { available: true, open: open.results ?? [] };
  } catch (error) {
    alerts = {
      available: false,
      open: [],
      error: error instanceof Error ? error.message : "Operational alert schema unavailable",
    };
  }
  const payload: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    buildSha: buildShaFromEnv(env),
    publicOrigin: resolvePublicOrigin(env.PUBLIC_ORIGIN),
    run,
    queue: counts.results ?? [],
    publications,
      sources: sourceHealth,
    reconciliation: reconciliation.results ?? [],
    emailDiscoveries: emailDiscoveries.results ?? [],
    signalVerification,
    officialSourceDiscovery,
    executiveIntelligence,
    socialEvidence,
    valeCollector,
    modelHealth,
    alerts,
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
      SELECT id, message_id, envelope_to, from_address, from_domain, subject, category, status, trust_state,
             url_count, urls_json, excerpt, truncated, instruction_like, receive_count,
             auth_state, auth_attempt_count, auth_attempted_at, auth_next_attempt_at, auth_error,
             auth_provenance_sha256,
             first_seen_at, last_seen_at, verification_state,
             verification_attempt_count, verification_attempted_at,
             verification_next_attempt_at, verification_error,
             verified_url_count, candidate_count, verified_at
      FROM email_discoveries
      WHERE status = 'review' OR auth_state IN ('pending', 'failed', 'exhausted', 'rejected')
      ORDER BY last_seen_at DESC
      LIMIT 50
    `).all();
  const emailPdfAttachments = await env.VALLEY_DESK_DB.prepare(`
      SELECT a.id, a.discovery_id, a.filename, a.mime_type, a.byte_count, a.sha256,
             a.extraction_state, a.extraction_error, a.page_count, a.extraction_method,
             a.extraction_receipt_sha256, a.extracted_by, a.created_at, a.extracted_at
      FROM email_pdf_attachments a
      JOIN email_discoveries e ON e.id = a.discovery_id
      WHERE e.status = 'review' OR a.extraction_state IN ('pending', 'failed')
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 50
    `).all();
  let signalQueue: Record<string, unknown> = { items: [] };
  try {
    const rows = await env.VALLEY_DESK_DB.prepare(`
      SELECT v.id, v.discovery_id, v.pointer_url, v.normalized_url,
             v.source_id, v.source_origin, v.trust_state, v.state,
             v.attempt_count, v.attempted_at, v.next_attempt_at,
             v.final_url, v.content_hash, v.candidate_ids_json, v.error
      FROM signal_pointer_verifications v
      ORDER BY v.attempted_at DESC
      LIMIT 100
    `).all();
    signalQueue = { items: rows.results ?? [] };
  } catch (error) {
    signalQueue = {
      items: [],
      error: error instanceof Error ? error.message : "Signal verification schema unavailable",
    };
  }
  payload.review = { items: review.results ?? [] };
  payload.decisions = decisions.results ?? [];
  payload.emailReview = {
    items: emailQueue.results ?? [],
    pdfAttachments: emailPdfAttachments.results ?? [],
  };
  payload.signalReview = signalQueue;
  try {
    const pendingObservations = await env.VALLEY_DESK_DB.prepare(`
      SELECT o.id, o.source_id, o.snapshot_id, o.institution_id, o.person_id,
             o.kind, o.status, o.verification_status, o.payload_json,
             o.instruction_like, o.created_at, o.reviewed_at, o.reviewed_by,
             o.review_note, s.final_url, s.extraction_status
      FROM source_observations o
      LEFT JOIN source_snapshots s ON s.id = o.snapshot_id
      WHERE o.verification_status = 'unverified'
      ORDER BY o.created_at DESC
      LIMIT 100
    `).all();
    payload.executiveReview = { items: pendingObservations.results ?? [] };
  } catch (error) {
    payload.executiveReview = {
      items: [],
      error: error instanceof Error ? error.message : "Executive intelligence schema unavailable",
    };
  }
  return payload;
}

export async function handleReviewApi(request: Request, env: ReviewEnv, options: ReviewApiOptions = {}) {
  if (!(await isAuthorized(request, env, options.trustedAccessEmail))) return json({ error: "not_found" }, 404);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = options.routePrefix && (url.pathname === options.routePrefix || url.pathname.startsWith(`${options.routePrefix}/`))
    ? `/api${url.pathname.slice(options.routePrefix.length)}`
    : url.pathname;

  if (/^\/api\/(?:watch-drafts|representative-drafts)(?:\/|$)/.test(pathname)) {
    if (method === "POST" && !rateLimitPost(request, env.REVIEW_API_TOKEN ?? options.trustedAccessEmail ?? ""))
      return json({ error: "rate_limited" }, 429);
    const namedOperator = options.trustedAccessEmail === "clyons@ajhcs.org" ? options.trustedAccessEmail : null;
    if (pathname.startsWith("/api/watch-drafts")) return handleWatchEditorialApi(request, env.VALLEY_DESK_DB,
      pathname, namedOperator, createWatchEditorialRuntime(env.VALLEY_DESK_DB));
    if (method === "POST" && !namedOperator) return json({ error: "named-operator-required" }, 403);
    try {
      const canonicalUrl = new URL(request.url); canonicalUrl.pathname = pathname;
      const policy = await resolveRepresentativeSourcePolicy(env.VALLEY_DESK_DB);
      const reviewer = await tupleKey("watch-reviewer-v1", [namedOperator ?? "review-api-token"]);
      return handleRepresentativeReview(new Request(canonicalUrl, request), env, policy, async () => reviewer);
    } catch { return json({ error: "representative-unavailable" }, 503); }
  }

  if (/^\/api\/(?:policy-background|policy-pdf|policy-versions|policy-provisions)(?:\/|$)/.test(pathname)) {
    // Page uploads have their own byte/page/artifact bounds. Capture and review
    // retain the existing mutation rate guard; a 79-page document isn't 79 captures.
    if (method === "POST" && /\/(?:capture|review)$/.test(pathname) && !rateLimitPost(request, env.REVIEW_API_TOKEN ?? "")) {
      return json({ error: "rate_limited" }, 429);
    }
    return handlePolicyPdfApi(request, env.VALLEY_DESK_DB, pathname, options.trustedAccessEmail ?? "review-api-token");
  }

  if (pathname === "/api/automation/status/regional-review") {
    if (method !== "GET" && method !== "HEAD")
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    try {
      const payload = await regionalEvidenceReviewPayload(env.VALLEY_DESK_DB, new Date().toISOString());
      return method === "HEAD" ? new Response(null, { headers: JSON_HEADERS }) : json(payload);
    } catch {
      return json({ error: "regional-evidence-review-unavailable", status: "unavailable", reviewOnly: true }, 503);
    }
  }

  if (pathname === "/api/automation/status" || pathname === "/api/automation/status/review") {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
    const detailed = pathname === "/api/automation/status/review";
    return json(await statusPayload(env, detailed));
  }

  const pdfContentMatch = /^\/api\/email-pdf-attachments\/([^/]+)\/content$/.exec(pathname);
  if (pdfContentMatch) {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
    let attachmentId = "";
    try {
      attachmentId = decodeURIComponent(pdfContentMatch[1]);
    } catch {
      return json({ error: "invalid_attachment_id" }, 400);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(attachmentId)) {
      return json({ error: "invalid_attachment_id" }, 400);
    }
    const attachment = await env.VALLEY_DESK_DB.prepare(`
      SELECT a.byte_count, a.sha256, e.status, e.trust_state, e.auth_state,
             e.auth_provenance_json, e.auth_provenance_sha256
      FROM email_pdf_attachments a
      JOIN email_discoveries e ON e.id = a.discovery_id
      WHERE a.id = ?
    `).bind(attachmentId).first<{
      byte_count: number;
      sha256: string;
      status: string;
      trust_state: string;
      auth_state: string;
      auth_provenance_json: string | null;
      auth_provenance_sha256: string | null;
    }>();
    if (!attachment) return json({ error: "attachment_not_found" }, 404);
    if (attachment.status !== "review"
      || attachment.trust_state !== "authenticated-pointer"
      || attachment.auth_state !== "authenticated"
      || !attachment.auth_provenance_json
      || !/^[a-f0-9]{64}$/.test(attachment.auth_provenance_sha256 ?? "")) {
      return json({ error: "attachment_not_authenticated" }, 409);
    }
    if (!Number.isInteger(attachment.byte_count) || attachment.byte_count <= 0 || attachment.byte_count > 3_000_000) {
      return json({ error: "attachment_corrupt" }, 409);
    }
    const baseHeaders = {
      "content-type": "application/pdf",
      "content-length": String(attachment.byte_count),
      "content-disposition": `attachment; filename="${attachmentId}.pdf"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      etag: `"sha256-${attachment.sha256}"`,
    };
    if (method === "HEAD") return new Response(null, { status: 200, headers: baseHeaders });
    const chunks = await env.VALLEY_DESK_DB.prepare(`
      SELECT chunk_index, bytes
      FROM email_pdf_attachment_chunks
      WHERE attachment_id = ?
      ORDER BY chunk_index
    `).bind(attachmentId).all<{ chunk_index: number; bytes: ArrayBuffer | Uint8Array | number[] }>();
    const rows = chunks.results ?? [];
    const normalized: Uint8Array[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.chunk_index !== index) return json({ error: "attachment_corrupt" }, 409);
      const value = row.bytes as unknown;
      if (value instanceof ArrayBuffer) {
        normalized.push(new Uint8Array(value));
        continue;
      }
      if (ArrayBuffer.isView(value)) {
        normalized.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        continue;
      }
      if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        normalized.push(Uint8Array.from(value));
        continue;
      }
      return json({ error: "attachment_corrupt" }, 409);
    }
    const received = normalized.reduce((total, chunk) => total + chunk.byteLength, 0);
    if (received !== attachment.byte_count) return json({ error: "attachment_corrupt" }, 409);
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of normalized) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (await sha256Bytes(bytes) !== attachment.sha256) return json({ error: "attachment_corrupt" }, 409);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, { status: 200, headers: baseHeaders });
  }

  const pdfExtractionMatch = /^\/api\/email-pdf-attachments\/([^/]+)\/extraction$/.exec(pathname);
  if (pdfExtractionMatch) {
    if (method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    if (!isJsonContentType(request)) return json({ error: "unsupported_media_type" }, 415);
    const token = env.REVIEW_API_TOKEN ?? "";
    if (!rateLimitPost(request, token)) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    let attachmentId = "";
    try {
      attachmentId = decodeURIComponent(pdfExtractionMatch[1]);
    } catch {
      return json({ error: "invalid_attachment_id" }, 400);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(attachmentId)) {
      return json({ error: "invalid_attachment_id" }, 400);
    }
    const raw = await readRequestTextBounded(request, MAX_PDF_EXTRACTION_JSON_BYTES);
    if (raw === null) return json({ error: "payload_too_large" }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.attachmentId !== attachmentId
      || typeof body.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.artifactSha256)
      || body.extractor !== "pypdf-manual-v1"
      || (body.outcome !== "complete" && body.outcome !== "failed")) {
      return json({ error: "invalid_extraction_receipt" }, 400);
    }
    const attachment = await env.VALLEY_DESK_DB.prepare(`
      SELECT a.sha256, a.extraction_state, e.status, e.trust_state, e.auth_state,
             e.auth_provenance_json, e.auth_provenance_sha256
      FROM email_pdf_attachments a
      JOIN email_discoveries e ON e.id = a.discovery_id
      WHERE a.id = ?
    `).bind(attachmentId).first<{
      sha256: string;
      extraction_state: string;
      status: string;
      trust_state: string;
      auth_state: string;
      auth_provenance_json: string | null;
      auth_provenance_sha256: string | null;
    }>();
    if (!attachment) return json({ error: "attachment_not_found" }, 404);
    if (attachment.status !== "review"
      || attachment.trust_state !== "authenticated-pointer"
      || attachment.auth_state !== "authenticated"
      || !attachment.auth_provenance_json
      || !/^[a-f0-9]{64}$/.test(attachment.auth_provenance_sha256 ?? "")) {
      return json({ error: "attachment_not_authenticated" }, 409);
    }
    if (attachment.sha256 !== body.artifactSha256) return json({ error: "artifact_checksum_mismatch" }, 409);
    if (attachment.extraction_state !== "pending") {
      return json({ id: attachmentId, extractionState: attachment.extraction_state, idempotent: true });
    }
    const receiptSha256 = await sha256Hex(raw);
    const extractedBy = options.trustedAccessEmail ?? "review-api-token";
    const audit = { method: "pypdf-manual-v1", receiptSha256, extractedBy };
    try {
      if (body.outcome === "complete") {
        if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > 500) {
          return json({ error: "invalid_extraction_pages" }, 400);
        }
        const pages = body.pages.map((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid page");
          const page = value as Record<string, unknown>;
          const pageText = typeof page.text === "string" ? page.text : "";
          if (!Number.isInteger(page.pageNumber)
            || pageText.length === 0 || pageText.length > 32_000
            || !Array.isArray(page.evidenceSpans)
            || page.evidenceSpans.length > 20
            || page.evidenceSpans.some((span) => typeof span !== "string" || span.length < 3
              || span.length > 1_000 || !pageText.includes(span))) {
            throw new Error("invalid page");
          }
          return {
            pageNumber: page.pageNumber as number,
            text: pageText,
            evidenceSpans: page.evidenceSpans as string[],
          };
        });
        await persistEmailPdfPageEvidence(env.VALLEY_DESK_DB, attachmentId, pages, new Date(), audit);
      } else {
        const errorCode = boundedText(body.errorCode, 100);
        if (!errorCode || !new Set(["image-only", "malformed-or-unsupported-pdf", "evidence-not-found"]).has(errorCode)) {
          return json({ error: "invalid_extraction_error" }, 400);
        }
        await markEmailPdfExtractionFailed(env.VALLEY_DESK_DB, attachmentId, errorCode, new Date(), audit);
      }
    } catch {
      return json({ error: "invalid_extraction_pages" }, 400);
    }
    logOps("email-pdf-extraction", {
      outcome: body.outcome,
      attachmentId,
      extractedBy,
      receiptSha256,
    });
    return json({
      id: attachmentId,
      extractionState: body.outcome === "complete" ? "complete" : "failed",
      receiptSha256,
      idempotent: false,
    });
  }

  if (pathname === "/api/executive-observations") {
    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });
    }
    const status = url.searchParams.get("status") ?? "unverified";
    if (!new Set(["unverified", "verified", "ignored"]).has(status)) {
      return json({ error: "invalid_status" }, 400);
    }
    try {
      const rows = await env.VALLEY_DESK_DB.prepare(`
        SELECT o.id, o.source_id, o.snapshot_id, o.institution_id, o.person_id,
               o.kind, o.status, o.verification_status, o.payload_json,
               o.instruction_like, o.created_at, o.reviewed_at, o.reviewed_by,
               o.review_note, s.final_url, s.extraction_status
        FROM source_observations o
        LEFT JOIN source_snapshots s ON s.id = o.snapshot_id
        WHERE o.verification_status = ?
        ORDER BY o.created_at DESC
        LIMIT ?
      `).bind(status, boundedLimit(url)).all();
      return json({ items: rows.results ?? [] });
    } catch (error) {
      return json({ error: "executive_intelligence_unavailable" }, 503);
    }
  }

  const executiveDecisionMatch = /^\/api\/executive-observations\/([^/]+)\/decision$/.exec(pathname);
  if (executiveDecisionMatch) {
    if (method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    }
    if (!isJsonContentType(request)) return json({ error: "unsupported_media_type" }, 415);
    const token = env.REVIEW_API_TOKEN ?? "";
    if (!rateLimitPost(request, token)) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (idempotencyKey) {
      if (idempotencyKey.length > 128) return json({ error: "invalid_idempotency_key" }, 400);
      const cached = readIdempotent(token, idempotencyKey);
      if (cached) return json(cached.body, cached.status);
    }
    let id = "";
    try {
      id = decodeURIComponent(executiveDecisionMatch[1]);
    } catch {
      return json({ error: "invalid_observation_id" }, 400);
    }
    let raw = "";
    try {
      raw = await request.text();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (raw.length > MAX_JSON_BYTES) return json({ error: "payload_too_large" }, 413);
    let body: { decision?: unknown; note?: unknown };
    try {
      body = JSON.parse(raw) as { decision?: unknown; note?: unknown };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (body.decision !== "verified" && body.decision !== "ignored") {
      return json({ error: "invalid_decision" }, 400);
    }
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1_000)) {
      return json({ error: "invalid_note" }, 400);
    }
    const reviewer = options.trustedAccessEmail ?? "review-api-token";
    try {
      const result = await reviewLeadershipObservation(
        env.VALLEY_DESK_DB,
        id,
        body.decision,
        reviewer,
        typeof body.note === "string" ? body.note : undefined,
      );
      const payload = { ...result, idempotent: result.idempotent ?? false };
      if (idempotencyKey) rememberIdempotent(token, idempotencyKey, 200, payload);
      logOps("leadership-review", { outcome: body.decision, observationId: id, reviewer });
      return json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Executive observation could not be reviewed";
      return json({ error: "observation_not_reviewable", message }, 409);
    }
  }

  if (pathname === "/api/review-queue") {
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

  const decisionMatch = /^\/api\/review-queue\/([^/]+)\/decision$/.exec(pathname);
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
    // Never trust cf-access-* request headers. Access callers pass the
    // identity only after trustedOpsIdentity() validates ctx.access.
    const reviewer = options.trustedAccessEmail ?? "review-api-token";
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
    if (env.EVENT_CALENDAR_COLLECTION_ENABLED === "true" && (approvedContent?.kind === "event" || rejectedContent?.kind === "event")) {
      try { await syncPublishedEventCalendar(env.VALLEY_DESK_DB, new Date(), env.PUBLIC_ORIGIN); }
      catch { logOps("event-calendar", { outcome: "synchronization-pending", candidateId: id }, "warn"); }
    }
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
