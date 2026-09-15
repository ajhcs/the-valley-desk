import { ContentItem, type ContentItem as ContentItemType } from "../content/schema";
import { Entity } from "../content/entity";
import entityFixtures from "../../fixtures/entities.json";
import { mapSeedOrgIds } from "./org-map";
import { coveragePack } from "./coverage-pack";
import { rssSources } from "./origins";
import { officialSourceRegistry } from "./official-source-discovery";
import { normalizeSourceUrl, sourceIdentityKey } from "./identity";
import {
  extractArticleText,
  fetchAllowlistedArticlePage,
} from "./news-extraction";
import { looksInstructionLike } from "./untrusted-text";

/**
 * A mail/LinkedIn notification is only a pointer. It is never editorial
 * evidence by itself. This lane turns a pointer into a candidate only after
 * the URL and the fetched document have passed the first-party allowlist.
 */
export const SIGNAL_VERIFICATION_VERSION = "signal-verification-v1";
export const SIGNAL_MAX_DISCOVERIES = 20;
export const SIGNAL_MAX_POINTERS = 40;
export const SIGNAL_MAX_URLS_PER_DISCOVERY = 5;
export const SIGNAL_CONCURRENCY = 2;
export const SIGNAL_TIMEOUT_MS = 8_000;
export const SIGNAL_MAX_BYTES = 512_000;
export const SIGNAL_MAX_REDIRECTS = 3;
export const SIGNAL_FAILURE_BASE_MS = 6 * 60 * 60 * 1_000;
export const SIGNAL_FAILURE_MAX_MS = 7 * 24 * 60 * 60 * 1_000;
export const SIGNAL_DEADLINE_MS = 30_000;
export const SIGNAL_ERROR_MAX_CHARS = 1_000;

const seedEntities = Entity.array().parse(entityFixtures);

export type SignalVerificationState = "pending" | "processing" | "verified" | "rejected" | "failed";
export type SignalPointerState = "verified" | "rejected" | "failed";

export type OfficialSignalSource = {
  id: string;
  name: string;
  origin: string;
  url: string;
  host: string;
  /** Explicitly retained so matching is host + normalized path, not raw mail. */
  pathPrefix: string;
  orgIds: string[];
};

export type PendingSignalDiscovery = {
  id: string;
  category: string;
  trustState: "untrusted-pointer" | "authenticated-pointer";
  urls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  verificationAttemptCount: number;
};

export type SignalPointerVerification = {
  id: string;
  discoveryId: string;
  pointerUrl: string;
  normalizedUrl: string | null;
  sourceId: string | null;
  sourceOrigin: string | null;
  trustState: "untrusted-pointer" | "authenticated-pointer";
  state: SignalPointerState;
  attemptCount: number;
  attemptedAt: string;
  nextAttemptAt: string | null;
  finalUrl: string | null;
  contentHash: string | null;
  candidateIds: string[];
  error: string | null;
};

export type SignalVerificationResult = {
  outcome: "ok" | "degraded" | "failed";
  discoveries: number;
  pointers: number;
  fetched: number;
  verified: number;
  rejected: number;
  failed: number;
  candidates: ContentItemType[];
  error?: string;
};

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
};

type D1DatabaseLike = {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
};

type StoredPointerState = {
  discovery_id: string;
  pointer_url: string;
  state: SignalPointerState;
  attempt_count: number | null;
  next_attempt_at: string | null;
};

type DiscoveryRow = {
  id: string;
  category: string;
  trust_state: "untrusted-pointer" | "authenticated-pointer";
  urls_json: string;
  first_seen_at: string;
  last_seen_at: string;
  verification_attempt_count: number | null;
};

function clipError(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, SIGNAL_ERROR_MAX_CHARS);
}

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, dec: string) => String.fromCodePoint(Number(dec)));
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\b[^>]+(?:name|property)\\s*=\\s*["']${escaped}["'][^>]+content\\s*=\\s*["']([^"']*)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta\\b[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*>`, "i"));
  return match ? htmlText(match[1] ?? "") : "";
}

function firstMatch(html: string, expression: RegExp) {
  const match = expression.exec(html);
  return match ? htmlText(match[1] ?? "") : "";
}

function titleFromHtml(html: string) {
  return metaContent(html, "og:title")
    || metaContent(html, "twitter:title")
    || firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
    || firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
}

function descriptionFromHtml(html: string) {
  return metaContent(html, "description") || metaContent(html, "og:description");
}

function dateFromHtml(html: string) {
  const value = metaContent(html, "article:published_time")
    || metaContent(html, "datePublished")
    || firstMatch(html, /<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/i);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "signal";
}

function normalizedHostname(value: string) {
  return value.replace(/^www\./i, "").replace(/\.$/, "").toLowerCase();
}

function pathFromNormalized(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return path || "/";
  } catch {
    return "";
  }
}

function sourcePathPrefix(url: string) {
  // The registry URL is an official origin, not a raw URL supplied by email.
  // Root is intentional for newsroom domains: their RSS/leadership URL often
  // lives below a feed path while linked article pages live beside it.
  const path = pathFromNormalized(url);
  if (!path || /(?:^|\/)(?:feed|rss|atom)(?:\/|$)/i.test(path)) return "/";
  return path === "/" ? "/" : path;
}

function orgIdsForCoverageSource(sourceId: string) {
  const source = coveragePack.sources.find((row) => row.id === sourceId);
  if (!source) return [];
  return coveragePack.institutions.find((row) => row.id === source.institutionId)?.orgIds ?? [];
}

function pushSource(
  out: OfficialSignalSource[],
  seen: Set<string>,
  row: { id: string; name?: string; origin?: string; url: string; orgIds?: readonly string[] },
) {
  const normalized = normalizeSourceUrl(row.url);
  if (!normalized) return;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return;
    const host = normalizedHostname(parsed.hostname);
    const key = `${host}${sourcePathPrefix(normalized)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: row.id,
      name: row.name ?? row.origin ?? row.id,
      origin: row.origin ?? row.id,
      url: normalized,
      host,
      pathPrefix: sourcePathPrefix(normalized),
      orgIds: [...new Set(row.orgIds ?? [])],
    });
  } catch {
    // The source registries are validated at module load; keep this lane
    // fail-closed if a future fixture is malformed.
  }
}

/** Official public source registry used by pointer verification. */
export function officialSignalSources(): OfficialSignalSource[] {
  const out: OfficialSignalSource[] = [];
  const seen = new Set<string>();
  for (const source of rssSources()) {
    for (const url of [source.url, ...(source.fallbacks ?? [])]) {
      pushSource(out, seen, {
        id: `rss:${source.id}`,
        name: source.name,
        origin: source.origin ?? source.name,
        url,
        orgIds: source.orgIds,
      });
    }
  }
  for (const source of coveragePack.sources) {
    if (!source.monitor || source.status !== "enabled") continue;
    pushSource(out, seen, {
      id: source.id,
      name: source.id,
      origin: source.id,
      url: source.url,
      orgIds: orgIdsForCoverageSource(source.id),
    });
  }
  for (const source of officialSourceRegistry.sources) {
    if (source.status !== "enabled") continue;
    const institution = source.institutionId
      ? coveragePack.institutions.find((row) => row.id === source.institutionId)
      : undefined;
    pushSource(out, seen, {
      id: source.id,
      name: source.name,
      origin: source.id,
      url: source.url,
      orgIds: institution?.orgIds ?? [],
    });
  }
  return out;
}

function pathMatches(candidatePath: string, prefix: string) {
  return prefix === "/" || candidatePath === prefix || candidatePath.startsWith(`${prefix}/`);
}

/** Normalize and match a pointer against a registry origin. Never follows it. */
export function matchOfficialSignalSource(
  raw: string | undefined | null,
  sources = officialSignalSources(),
): { url: string; source: OfficialSignalSource } | undefined {
  const normalized = normalizePublicSignalUrl(raw);
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return undefined;
  }
  const host = normalizedHostname(parsed.hostname);
  const path = pathFromNormalized(normalized);
  const source = sources.find((row) => row.host === host && pathMatches(path, row.pathPrefix));
  return source ? { url: normalized, source } : undefined;
}

export function normalizePublicSignalUrl(raw: string | undefined | null) {
  if (!raw) return undefined;
  // normalizeSourceUrl intentionally upgrades legacy HTTP article links for
  // ordinary content identity. Inbound pointers are stricter: an HTTP URL is
  // never admitted or upgraded because the mail path did not prove it.
  try {
    const supplied = new URL(raw.trim());
    if (supplied.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    const host = normalizedHostname(parsed.hostname);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return undefined;
    if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1" || host === "169.254.169.254") return undefined;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return undefined;
    if (!host.includes(".")) return undefined;
    parsed.hostname = host;
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    const result = parsed.toString();
    return result.length <= 500 ? result : undefined;
  } catch {
    return undefined;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseUrls(raw: string) {
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is string => typeof value === "string").slice(0, SIGNAL_MAX_URLS_PER_DISCOVERY);
  } catch {
    return [];
  }
}

function backoffMs(attemptCount: number) {
  const safe = Math.max(1, Math.trunc(attemptCount) || 1);
  return Math.min(SIGNAL_FAILURE_MAX_MS, SIGNAL_FAILURE_BASE_MS * (2 ** (safe - 1)));
}

function dueAt(value: string | null, now: Date) {
  if (!value) return true;
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed <= now.getTime();
}

async function readPending(db: D1DatabaseLike, now: Date, limit: number): Promise<PendingSignalDiscovery[]> {
  const rows = await db.prepare(`
    SELECT id, category, trust_state, urls_json, first_seen_at, last_seen_at,
           verification_attempt_count
    FROM email_discoveries
    WHERE status = 'review'
      AND trust_state = 'authenticated-pointer'
      AND auth_state = 'authenticated'
      AND auth_provenance_json IS NOT NULL
      AND LENGTH(auth_provenance_sha256) = 64
      AND verification_state IN ('pending', 'failed')
      AND (verification_next_attempt_at IS NULL OR verification_next_attempt_at <= ?)
    ORDER BY first_seen_at ASC, id ASC
    LIMIT ?
  `).bind(now.toISOString(), Math.max(1, Math.min(SIGNAL_MAX_DISCOVERIES, Math.trunc(limit) || SIGNAL_MAX_DISCOVERIES))).all<DiscoveryRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    category: row.category,
    trustState: row.trust_state,
    urls: parseUrls(row.urls_json),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    verificationAttemptCount: Number(row.verification_attempt_count ?? 0),
  }));
}

async function readPointerStates(db: D1DatabaseLike, discoveryIds: string[]) {
  const out = new Map<string, StoredPointerState>();
  if (!discoveryIds.length) return out;
  const placeholders = discoveryIds.map(() => "?").join(", ");
  const rows = await db.prepare(`
    SELECT discovery_id, pointer_url, state, attempt_count, next_attempt_at
    FROM signal_pointer_verifications
    WHERE discovery_id IN (${placeholders})
  `).bind(...discoveryIds).all<StoredPointerState>();
  for (const row of rows.results ?? []) out.set(`${row.discovery_id}\0${row.pointer_url}`, row);
  return out;
}

function candidateFromDocument(
  source: OfficialSignalSource,
  url: string,
  html: string,
  fetchedAt: string,
): ContentItemType | undefined {
  const title = titleFromHtml(html).slice(0, 300);
  const dek = descriptionFromHtml(html).slice(0, 500);
  const extraction = extractArticleText(html);
  const body = extraction?.text?.trim() ?? "";
  if (!title || body.length < 280) return undefined;
  // Source text is data. It is never executed or used as a prompt. Holding
  // instruction-like pages avoids routing prompt injection into the model.
  if (looksInstructionLike(title, dek, body)) return undefined;
  const orgs = [...new Set([
    ...source.orgIds,
    ...mapSeedOrgIds(`${title} ${dek} ${body}`, seedEntities),
  ])];
  const urlKey = slugify(new URL(url).hostname + new URL(url).pathname).slice(0, 80);
  const item = {
    id: `signal-${source.id.replace(/[^a-z0-9-]+/gi, "-")}-${urlKey}`.toLowerCase().slice(0, 180),
    slug: slugify(`${source.origin}-${title}`),
    kind: "news" as const,
    title,
    dek: dek || body.slice(0, 240),
    body,
    status: "review" as const,
    publishedAt: dateFromHtml(html),
    updatedAt: fetchedAt,
    topics: [],
    orgs,
    region: "regional" as const,
    authors: [],
    source: {
      kind: "ingest" as const,
      origin: source.origin,
      url,
      fetchedAt,
      externalId: url,
    },
    citations: [{ name: source.name, url }],
    relatedEventIds: [],
    relatedVoiceIds: [],
    featured: false,
  };
  try {
    return ContentItem.parse(item);
  } catch {
    return undefined;
  }
}

function pointerId(discoveryId: string, url: string) {
  return `${SIGNAL_VERIFICATION_VERSION}:${discoveryId}:${url}`;
}

async function persistPointer(
  db: D1DatabaseLike,
  row: SignalPointerVerification,
) {
  await db.prepare(`
    INSERT INTO signal_pointer_verifications (
      id, discovery_id, pointer_url, normalized_url, source_id, source_origin,
      trust_state, state, attempt_count, attempted_at, next_attempt_at,
      final_url, content_hash, candidate_ids_json, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discovery_id, pointer_url) DO UPDATE SET
      normalized_url = excluded.normalized_url,
      source_id = excluded.source_id,
      source_origin = excluded.source_origin,
      trust_state = excluded.trust_state,
      state = excluded.state,
      attempt_count = excluded.attempt_count,
      attempted_at = excluded.attempted_at,
      next_attempt_at = excluded.next_attempt_at,
      final_url = excluded.final_url,
      content_hash = excluded.content_hash,
      candidate_ids_json = excluded.candidate_ids_json,
      error = excluded.error
  `).bind(
    row.id,
    row.discoveryId,
    row.pointerUrl,
    row.normalizedUrl,
    row.sourceId,
    row.sourceOrigin,
    row.trustState,
    row.state,
    row.attemptCount,
    row.attemptedAt,
    row.nextAttemptAt,
    row.finalUrl,
    row.contentHash,
    JSON.stringify(row.candidateIds).slice(0, 2_000),
    row.error,
  ).run();
}

async function updateDiscovery(
  db: D1DatabaseLike,
  discovery: PendingSignalDiscovery,
  state: SignalVerificationState,
  now: Date,
  details: { error?: string; verified: number; candidates: number; retry?: boolean },
) {
  const attemptCount = discovery.verificationAttemptCount + 1;
  const next = details.retry ? new Date(now.getTime() + backoffMs(attemptCount)).toISOString() : null;
  await db.prepare(`
    UPDATE email_discoveries
    SET verification_state = ?, verification_attempt_count = ?,
        verification_attempted_at = ?, verification_next_attempt_at = ?,
        verification_error = ?, verified_url_count = ?, candidate_count = ?,
        verified_at = CASE WHEN ? = 'verified' THEN ? ELSE verified_at END
    WHERE id = ?
  `).bind(
    state,
    attemptCount,
    now.toISOString(),
    next,
    details.error ? clipError(details.error) : null,
    details.verified,
    details.candidates,
    state,
    state === "verified" ? now.toISOString() : null,
    discovery.id,
  ).run();
}

async function processOne(
  db: D1DatabaseLike,
  discovery: PendingSignalDiscovery,
  states: Map<string, StoredPointerState>,
  sources: OfficialSignalSource[],
  fetchImpl: typeof fetch,
  now: Date,
): Promise<{ fetched: number; verified: number; rejected: number; failed: number; candidates: ContentItemType[] }> {
  const candidates: ContentItemType[] = [];
  let fetched = 0;
  let verified = 0;
  let rejected = 0;
  let failed = 0;
  const seenIdentity = new Set<string>();
  const pointers = discovery.urls.slice(0, SIGNAL_MAX_URLS_PER_DISCOVERY);
  for (const raw of pointers) {
    const matched = matchOfficialSignalSource(raw, sources);
    const pointerUrl = normalizePublicSignalUrl(raw) ?? String(raw).slice(0, 500);
    const previous = states.get(`${discovery.id}\0${pointerUrl}`);
    if (previous && (previous.state === "verified" || previous.state === "rejected")) {
      continue;
    }
    const attemptedAt = now.toISOString();
    const attemptCount = Number(previous?.attempt_count ?? 0) + 1;
    if (!matched) {
      rejected += 1;
      await persistPointer(db, {
        id: pointerId(discovery.id, pointerUrl),
        discoveryId: discovery.id,
        pointerUrl,
        normalizedUrl: normalizePublicSignalUrl(raw) ?? null,
        sourceId: null,
        sourceOrigin: null,
        trustState: discovery.trustState,
        state: "rejected",
        attemptCount,
        attemptedAt,
        nextAttemptAt: null,
        finalUrl: null,
        contentHash: null,
        candidateIds: [],
        error: "Pointer did not match an official public source registry host/path",
      });
      continue;
    }
    if (previous?.state === "failed" && !dueAt(previous.next_attempt_at, now)) continue;
    const fetchedPage = await fetchAllowlistedArticlePage({
      url: matched.url,
      fetchImpl,
      allowedHosts: new Set(sources.map((source) => source.host)),
      maxBytes: SIGNAL_MAX_BYTES,
      timeoutMs: SIGNAL_TIMEOUT_MS,
      maxRedirects: SIGNAL_MAX_REDIRECTS,
    });
    if (!fetchedPage.ok) {
      failed += 1;
      await persistPointer(db, {
        id: pointerId(discovery.id, pointerUrl),
        discoveryId: discovery.id,
        pointerUrl,
        normalizedUrl: matched.url,
        sourceId: matched.source.id,
        sourceOrigin: matched.source.origin,
        trustState: discovery.trustState,
        state: "failed",
        attemptCount,
        attemptedAt,
        nextAttemptAt: new Date(now.getTime() + backoffMs(attemptCount)).toISOString(),
        finalUrl: null,
        contentHash: null,
        candidateIds: [],
        error: fetchedPage.error,
      });
      continue;
    }
    fetched += 1;
    const finalMatch = matchOfficialSignalSource(fetchedPage.url, sources);
    if (!finalMatch) {
      rejected += 1;
      await persistPointer(db, {
        id: pointerId(discovery.id, pointerUrl),
        discoveryId: discovery.id,
        pointerUrl,
        normalizedUrl: matched.url,
        sourceId: matched.source.id,
        sourceOrigin: matched.source.origin,
        trustState: discovery.trustState,
        state: "rejected",
        attemptCount,
        attemptedAt,
        nextAttemptAt: null,
        finalUrl: fetchedPage.url,
        contentHash: await sha256(fetchedPage.body),
        candidateIds: [],
        error: "Final URL did not match the official source registry",
      });
      continue;
    }
    const candidate = candidateFromDocument(finalMatch.source, finalMatch.url, fetchedPage.body, attemptedAt);
    if (!candidate) {
      rejected += 1;
      await persistPointer(db, {
        id: pointerId(discovery.id, pointerUrl),
        discoveryId: discovery.id,
        pointerUrl,
        normalizedUrl: matched.url,
        sourceId: finalMatch.source.id,
        sourceOrigin: finalMatch.source.origin,
        trustState: discovery.trustState,
        state: "rejected",
        attemptCount,
        attemptedAt,
        nextAttemptAt: null,
        finalUrl: fetchedPage.url,
        contentHash: await sha256(fetchedPage.body),
        candidateIds: [],
        error: "Official page did not yield a safe article candidate",
      });
      continue;
    }
    const identity = sourceIdentityKey(candidate);
    if (!seenIdentity.has(identity)) {
      seenIdentity.add(identity);
      candidates.push(candidate);
    }
    verified += 1;
    await persistPointer(db, {
      id: pointerId(discovery.id, pointerUrl),
      discoveryId: discovery.id,
      pointerUrl,
      normalizedUrl: matched.url,
      sourceId: finalMatch.source.id,
      sourceOrigin: finalMatch.source.origin,
      trustState: discovery.trustState,
      state: "verified",
      attemptCount,
      attemptedAt,
      nextAttemptAt: null,
      finalUrl: fetchedPage.url,
      contentHash: await sha256(fetchedPage.body),
      candidateIds: [candidate.id],
      error: null,
    });
  }
  const retry = failed > 0;
  const state: SignalVerificationState = verified > 0 ? "verified" : retry ? "failed" : "rejected";
  await updateDiscovery(db, discovery, state, now, {
    error: failed > 0 ? "One or more official pointers could not be fetched" : undefined,
    verified,
    candidates: candidates.length,
    retry,
  });
  return { fetched, verified, rejected, failed, candidates };
}

/**
 * Consume a bounded number of pending pointers. Fetches are sequential per
 * discovery, globally bounded by the caller's small pointer cap, and every
 * result remains review-only until the ordinary editor/two-pass pipeline.
 */
export async function verifyPendingSignalPointers(
  db: D1DatabaseLike,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  options: { discoveryLimit?: number; pointerLimit?: number; deadlineMs?: number } = {},
): Promise<SignalVerificationResult> {
  const discoveries = await readPending(db, now, options.discoveryLimit ?? SIGNAL_MAX_DISCOVERIES);
  if (!discoveries.length) {
    return { outcome: "ok", discoveries: 0, pointers: 0, fetched: 0, verified: 0, rejected: 0, failed: 0, candidates: [] };
  }
  const pointerLimit = Math.max(1, Math.min(SIGNAL_MAX_POINTERS, Math.trunc(options.pointerLimit ?? SIGNAL_MAX_POINTERS) || SIGNAL_MAX_POINTERS));
  const boundedDiscoveries: PendingSignalDiscovery[] = [];
  let remainingPointers = pointerLimit;
  for (const discovery of discoveries) {
    if (remainingPointers <= 0) break;
    const urls = discovery.urls.slice(0, Math.min(SIGNAL_MAX_URLS_PER_DISCOVERY, remainingPointers));
    if (!urls.length) continue;
    boundedDiscoveries.push({ ...discovery, urls });
    remainingPointers -= urls.length;
  }
  const states = await readPointerStates(db, boundedDiscoveries.map((row) => row.id));
  const sources = officialSignalSources();
  const deadline = Date.now() + Math.max(1_000, Math.trunc(options.deadlineMs ?? SIGNAL_DEADLINE_MS));
  const candidates: ContentItemType[] = [];
  let pointers = 0;
  let fetched = 0;
  let verified = 0;
  let rejected = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < boundedDiscoveries.length) {
      if (Date.now() >= deadline) return;
      const discovery = boundedDiscoveries[next++];
      pointers += discovery.urls.length;
      const result = await processOne(db, discovery, states, sources, fetchImpl, now);
      fetched += result.fetched;
      verified += result.verified;
      rejected += result.rejected;
      failed += result.failed;
      candidates.push(...result.candidates);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIGNAL_CONCURRENCY, boundedDiscoveries.length) }, worker));
  const unique = new Map<string, ContentItemType>();
  for (const candidate of candidates) unique.set(sourceIdentityKey(candidate), candidate);
  return {
    outcome: failed > 0 ? "degraded" : "ok",
    discoveries: boundedDiscoveries.length,
    pointers: Math.min(pointerLimit, pointers),
    fetched,
    verified,
    rejected,
    failed,
    candidates: [...unique.values()],
  };
}
