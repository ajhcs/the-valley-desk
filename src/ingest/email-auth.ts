import {
  extractEmailAddress,
  handleInboundEmail,
  persistEmailAuthenticationOutcome,
  type EmailAuthenticationProvenance,
  type EmailEnv,
  type EmailHandlerResult,
  type InboundEmailMessage,
} from "./email";
import type { D1DatabaseLike } from "./persistence";
import { logOps } from "../lib/ops";

export const EMAIL_AUTH_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
export const EMAIL_AUTH_LOOKBACK_MS = 10 * 60_000;
export const EMAIL_AUTH_LOOKAHEAD_MS = 60_000;
export const EMAIL_AUTH_EVENT_SKEW_MS = 2 * 60_000;
export const EMAIL_AUTH_TIMEOUT_MS = 5_000;
export const EMAIL_AUTH_RESPONSE_MAX_BYTES = 256_000;
export const EMAIL_AUTH_PENDING_LIMIT = 20;
export const EMAIL_AUTH_MAX_ATTEMPTS = 8;
const EMAIL_AUTH_RETRY_BASE_MS = 5 * 60_000;
const EMAIL_AUTH_RETRY_MAX_MS = 6 * 60 * 60_000;

export type EmailAuthenticationResolverEnv = {
  VALLEY_DESK_DB: D1DatabaseLike;
  /** Zone-scoped secret with only Analytics Read permission. */
  CF_EMAIL_ANALYTICS_TOKEN?: string;
  /** Cloudflare zone identifier for thevalleydesk.org. */
  CF_EMAIL_ZONE_ID?: string;
  /** Exact Email Routing rule UUID that invokes this Worker. */
  CF_EMAIL_ROUTING_RULE_ID?: string;
};

export type CloudflareEmailAuthenticationResult =
  | { outcome: "authenticated"; provenance: EmailAuthenticationProvenance }
  | { outcome: "rejected"; reason: string; provenance?: EmailAuthenticationProvenance }
  | { outcome: "pending"; reason: string }
  | { outcome: "unavailable"; reason: string };

type RoutingEvent = {
  datetime: string;
  from: string;
  to: string;
  status: string;
  eventType: string;
  action: string;
  ruleMatched: string;
  messageId: string;
  sessionId: string;
  dkim: string;
  dmarc: string;
  spf: string;
  isSpam: number;
  isLastEvent: number;
};

type PendingAuthenticationRow = {
  id: string;
  message_id: string | null;
  envelope_to: string;
  from_address: string | null;
  first_seen_at: string;
  auth_attempt_count: number;
};

const EMAIL_ROUTING_AUTH_QUERY = `query EmailRoutingAuthentication($zoneTag: string!, $start: Time!, $end: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      emailRoutingAdaptive(
        filter: { datetime_geq: $start, datetime_leq: $end }
        limit: 200
        orderBy: [datetime_DESC]
      ) {
        datetime
        from
        to
        status
        eventType
        action
        ruleMatched
        messageId
        sessionId
        dkim
        dmarc
        spf
        isSpam
        isLastEvent
      }
    }
  }
}`;

function normalizedId(value: string) {
  return value.trim().replace(/^<|>$/g, "");
}

function normalizedAuthResult(value: string): EmailAuthenticationProvenance["spf"] {
  const normalized = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "pass" || normalized === "fail" || normalized === "neutral"
    || normalized === "none" || normalized === "temperror" || normalized === "permerror") {
    return normalized;
  }
  return "none";
}

function normalizedDmarc(value: string): EmailAuthenticationProvenance["dmarc"] {
  const normalized = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "pass" || normalized === "fail" || normalized === "bestguesspass" || normalized === "none") {
    return normalized;
  }
  return "none";
}

function isRoutingEvent(value: unknown): value is RoutingEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["datetime", "from", "to", "status", "eventType", "action", "ruleMatched", "messageId", "sessionId", "dkim", "dmarc", "spf"]
    .every((key) => typeof row[key] === "string")
    && typeof row.isSpam === "number"
    && typeof row.isLastEvent === "number";
}

function routingEvents(value: unknown): RoutingEvent[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const viewer = (data as { viewer?: unknown }).viewer;
  if (!viewer || typeof viewer !== "object") return [];
  const zones = (viewer as { zones?: unknown }).zones;
  if (!Array.isArray(zones) || zones.length !== 1 || !zones[0] || typeof zones[0] !== "object") return [];
  const events = (zones[0] as { emailRoutingAdaptive?: unknown }).emailRoutingAdaptive;
  return Array.isArray(events) ? events.filter(isRoutingEvent) : [];
}

async function readJsonBounded(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > EMAIL_AUTH_RESPONSE_MAX_BYTES) {
    throw new Error("Cloudflare email analytics response exceeded the declared size limit");
  }
  if (!response.body) throw new Error("Cloudflare email analytics response had no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > EMAIL_AUTH_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Cloudflare email analytics response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may have been cancelled after crossing the limit.
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function configured(env: EmailAuthenticationResolverEnv) {
  const token = env.CF_EMAIL_ANALYTICS_TOKEN?.trim();
  const zoneId = env.CF_EMAIL_ZONE_ID?.trim();
  const ruleId = env.CF_EMAIL_ROUTING_RULE_ID?.trim();
  if (!token || !zoneId || !ruleId) return null;
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) return null;
  if (!/^[a-f0-9-]{16,64}$/i.test(ruleId)) return null;
  return { token, zoneId, ruleId };
}

function safeReason(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
    || "Cloudflare email authentication lookup failed";
}

export async function resolveCloudflareEmailAuthentication(input: {
  env: EmailAuthenticationResolverEnv;
  envelopeFrom: string;
  envelopeTo: string;
  messageId: string | null;
  observedAt?: Date;
  eventStart?: Date;
  fetchImpl?: typeof fetch;
}): Promise<CloudflareEmailAuthenticationResult> {
  const config = configured(input.env);
  if (!config) return { outcome: "unavailable", reason: "Cloudflare email analytics is not configured" };
  const messageId = normalizedId(input.messageId ?? "");
  const from = extractEmailAddress(input.envelopeFrom);
  const to = extractEmailAddress(input.envelopeTo);
  if (!messageId || !from || !to) return { outcome: "rejected", reason: "Email correlation fields are invalid" };
  const now = input.observedAt ?? new Date();
  const start = input.eventStart ?? new Date(now.getTime() - EMAIL_AUTH_LOOKBACK_MS);
  const end = new Date(now.getTime() + EMAIL_AUTH_LOOKAHEAD_MS);
  const fetchImpl = input.fetchImpl ?? ((request, init) => globalThis.fetch(request, init));
  let response: Response;
  try {
    response = await fetchImpl(EMAIL_AUTH_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: EMAIL_ROUTING_AUTH_QUERY,
        variables: { zoneTag: config.zoneId, start: start.toISOString(), end: end.toISOString() },
      }),
      signal: AbortSignal.timeout(EMAIL_AUTH_TIMEOUT_MS),
    });
  } catch (error) {
    return { outcome: "pending", reason: safeReason(error) };
  }
  if (!response.ok) {
    return { outcome: "pending", reason: `Cloudflare email analytics returned HTTP ${response.status}` };
  }
  let payload: unknown;
  try {
    payload = await readJsonBounded(response);
  } catch (error) {
    return { outcome: "pending", reason: safeReason(error) };
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { errors?: unknown }).errors)) {
    return { outcome: "pending", reason: "Cloudflare email analytics returned GraphQL errors" };
  }
  const exact = routingEvents(payload).filter((event) => (
    event.eventType.toLowerCase() === "incoming"
    && event.ruleMatched.toLowerCase() === config.ruleId.toLowerCase()
    && normalizedId(event.messageId) === messageId
    && extractEmailAddress(event.from) === from
    && extractEmailAddress(event.to) === to
  ));
  if (exact.length === 0) {
    return { outcome: "pending", reason: "No matching Cloudflare Email Routing analytics event is visible yet" };
  }
  const sessions = new Set(exact.map((event) => event.sessionId.trim()).filter(Boolean));
  if (sessions.size !== 1) return { outcome: "rejected", reason: "Cloudflare email analytics correlation was ambiguous" };
  const event = exact[0];
  const eventAt = Date.parse(event.datetime);
  if (!Number.isFinite(eventAt)
    || Math.abs(eventAt - now.getTime()) > EMAIL_AUTH_EVENT_SKEW_MS
    || event.action.trim().toLowerCase() !== "worker"
    || event.isLastEvent !== 1
    || !/^[^\s\u0000-\u001F\u007F]{4,200}$/.test(event.sessionId.trim())) {
    return { outcome: "rejected", reason: "Cloudflare email analytics returned invalid or stale receipt fields" };
  }
  const authTuples = new Set(exact.map((candidate) => JSON.stringify({
    spf: normalizedAuthResult(candidate.spf),
    dkim: normalizedAuthResult(candidate.dkim),
    dmarc: normalizedDmarc(candidate.dmarc),
    isSpam: candidate.isSpam !== 0,
  })));
  if (authTuples.size !== 1) return { outcome: "rejected", reason: "Cloudflare email authentication results conflicted" };
  const provenance: EmailAuthenticationProvenance = {
    source: "cloudflare-email-routing-adaptive",
    receiptId: `session:${event.sessionId.trim()}`,
    sessionId: event.sessionId.trim(),
    routeRuleId: event.ruleMatched,
    observedAt: event.datetime,
    envelopeFrom: from,
    envelopeTo: to,
    messageId: input.messageId!.trim(),
    eventType: "incoming",
    action: event.action,
    spf: normalizedAuthResult(event.spf),
    dkim: normalizedAuthResult(event.dkim),
    dmarc: normalizedDmarc(event.dmarc),
    isSpam: event.isSpam !== 0,
  };
  if (provenance.isSpam) return { outcome: "rejected", reason: "Cloudflare classified the email as spam", provenance };
  if (provenance.dmarc !== "pass" || (provenance.spf !== "pass" && provenance.dkim !== "pass")) {
    return { outcome: "rejected", reason: "Cloudflare email authentication did not meet policy", provenance };
  }
  return { outcome: "authenticated", provenance };
}

function retryDelay(attempt: number) {
  return Math.min(EMAIL_AUTH_RETRY_MAX_MS, EMAIL_AUTH_RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
}

async function pendingRows(db: D1DatabaseLike, now: Date) {
  const rows = await db.prepare(`
    SELECT id, message_id, envelope_to, from_address, first_seen_at, auth_attempt_count
    FROM email_discoveries
    WHERE auth_state IN ('pending', 'failed')
      AND status = 'ignored'
      AND (auth_next_attempt_at IS NULL OR auth_next_attempt_at <= ?)
    ORDER BY first_seen_at ASC, id ASC
    LIMIT ?
  `).bind(now.toISOString(), EMAIL_AUTH_PENDING_LIMIT).all<PendingAuthenticationRow>();
  return rows.results ?? [];
}

export async function resolvePendingEmailAuthentication(
  env: EmailAuthenticationResolverEnv,
  fetchImpl: typeof fetch = (request, init) => globalThis.fetch(request, init),
  now = new Date(),
) {
  if (!configured(env)) return { outcome: "unavailable" as const, attempted: 0, authenticated: 0, rejected: 0, failed: 0 };
  const rows = await pendingRows(env.VALLEY_DESK_DB, now);
  let authenticated = 0;
  let rejected = 0;
  let failed = 0;
  for (const row of rows) {
    const attempt = Number(row.auth_attempt_count ?? 0) + 1;
    const firstSeen = new Date(row.first_seen_at);
    const validFirstSeen = Number.isFinite(firstSeen.getTime());
    const result = await resolveCloudflareEmailAuthentication({
      env,
      envelopeFrom: row.from_address ?? "",
      envelopeTo: row.envelope_to,
      messageId: row.message_id,
      // The event timestamp stays close to receipt time even if Analytics is
      // eventually consistent. Keep every retry's query window narrow so a
      // busy zone cannot crowd the target out of the bounded result set.
      observedAt: validFirstSeen ? firstSeen : now,
      eventStart: validFirstSeen ? new Date(firstSeen.getTime() - EMAIL_AUTH_LOOKAHEAD_MS) : undefined,
      fetchImpl,
    });
    if (result.outcome === "authenticated") {
      await persistEmailAuthenticationOutcome(env.VALLEY_DESK_DB, row.id, {
        state: "authenticated",
        attemptedAt: now.toISOString(),
        attemptCount: attempt,
        provenance: result.provenance,
        correlation: {
          envelopeFrom: row.from_address ?? "",
          envelopeTo: row.envelope_to,
          messageId: row.message_id ?? "",
        },
      });
      authenticated += 1;
      continue;
    }
    if (result.outcome === "rejected") {
      await persistEmailAuthenticationOutcome(env.VALLEY_DESK_DB, row.id, {
        state: "rejected",
        attemptedAt: now.toISOString(),
        attemptCount: attempt,
        error: result.reason,
        provenance: result.provenance,
        correlation: {
          envelopeFrom: row.from_address ?? "",
          envelopeTo: row.envelope_to,
          messageId: row.message_id ?? "",
        },
      });
      rejected += 1;
      continue;
    }
    const exhausted = attempt >= EMAIL_AUTH_MAX_ATTEMPTS;
    await persistEmailAuthenticationOutcome(env.VALLEY_DESK_DB, row.id, {
      state: exhausted ? "exhausted" : "failed",
      attemptedAt: now.toISOString(),
      attemptCount: attempt,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelay(attempt)).toISOString(),
      error: result.reason,
      correlation: {
        envelopeFrom: row.from_address ?? "",
        envelopeTo: row.envelope_to,
        messageId: row.message_id ?? "",
      },
    });
    failed += 1;
  }
  const summary = { outcome: "ok" as const, attempted: rows.length, authenticated, rejected, failed };
  logOps("email-auth", summary, failed > 0 ? "warn" : "info");
  return summary;
}

export async function handleCloudflareInboundEmail(
  message: InboundEmailMessage,
  env: EmailAuthenticationResolverEnv & EmailEnv,
  fetchImpl: typeof fetch = (request, init) => globalThis.fetch(request, init),
  now = new Date(),
): Promise<EmailHandlerResult> {
  const messageId = message.headers.get("message-id") ?? message.headers.get("Message-ID");
  const auth = await resolveCloudflareEmailAuthentication({
    env,
    envelopeFrom: message.from,
    envelopeTo: message.to,
    messageId,
    observedAt: now,
    fetchImpl,
  });
  if (auth.outcome === "unavailable") {
    message.setReject("Sender authentication unavailable");
    return { outcome: "rejected", reason: auth.reason };
  }
  if (auth.outcome === "rejected") {
    message.setReject("Sender authentication required");
    return { outcome: "rejected", reason: auth.reason };
  }
  return handleInboundEmail({
    from: message.from,
    to: message.to,
    headers: message.headers,
    raw: message.raw,
    rawSize: message.rawSize,
    setReject: (reason) => message.setReject(reason),
    authProvenance: auth.outcome === "authenticated" ? auth.provenance : undefined,
    authenticationPending: auth.outcome === "pending",
    authenticationError: auth.outcome === "pending" ? auth.reason : undefined,
    authenticationAttemptedAt: now.toISOString(),
  }, env);
}
