import type { D1DatabaseLike } from "../ingest/persistence";
import { logOps } from "./ops";
import { operationalConditionLabel } from "./operational-presentation";
import type { OperationalConditionState } from "./operational-status";

export { OPERATIONAL_CONDITION_STATES } from "./operational-status";

export const OPS_ALERT_RECIPIENT = "clyons@ajhcs.org";
export const OPS_ALERT_SENDER = "alerts@thevalleydesk.org";
export const DEFAULT_ALERT_PACK_ID = "valley-desk";
export const ALERT_DETAIL_MAX_CHARS = 240;
export const ALERT_MAX_DETAIL_KEYS = 20;
export const ALERT_MAX_DIGEST_ROWS = 50;
export const ALERT_DEFAULT_THRESHOLD = 2;
export const ALERT_MAX_BACKOFF_MS = 24 * 60 * 60 * 1_000;
export const ALERT_REPEAT_BASE_MS = 6 * 60 * 60 * 1_000;

export type SendEmailBindingLike = {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
};

export type AlertSeverity = "info" | "warning" | "critical";
export type { OperationalConditionState } from "./operational-status";

export type OperationalAlertInput = {
  fingerprint: string;
  packId?: string;
  event: string;
  severity: AlertSeverity;
  /** Condition state is separate from the open/resolved incident lifecycle. */
  conditionState?: OperationalConditionState;
  institutionId?: string | null;
  subsystem?: string;
  groupKey?: string;
  details?: Record<string, unknown>;
  threshold?: number;
  now?: Date;
  /** Record the occurrence for the daily digest without claiming immediate mail. */
  notify?: boolean;
  /** Stable internal run ID; duplicate deliveries are not new conditions. */
  observationId?: string;
};

export type OperationalAlertRow = {
  fingerprint: string;
  pack_id: string;
  event: string;
  severity: AlertSeverity;
  state: "open" | "resolved";
  condition_state: OperationalConditionState;
  institution_id: string | null;
  subsystem: string;
  group_key: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  next_notify_at: string;
  last_notification_attempt_at: string | null;
  last_notified_at: string | null;
  notification_attempt_count: number;
  last_notification_error: string | null;
  detail_json: string;
  recovery_detail_json: string;
  recovery_count: number;
  last_recovered_at: string | null;
  resolved_at: string | null;
};

type AlertRecordResult = {
  row: OperationalAlertRow;
  claimed: boolean;
};

export type AlertRecoveryResult = {
  row: OperationalAlertRow | null;
  resolved: boolean;
};

type DigestRow = {
  recovery_count: number;
  last_recovered_at: string | null;
  fingerprint: string;
  pack_id: string;
  event: string;
  severity: AlertSeverity;
  condition_state: OperationalConditionState;
  institution_id: string | null;
  subsystem: string;
  group_key: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  detail_json: string;
};

type DigestRecord = {
  digest_date: string;
  pack_id: string;
  status: "pending" | "sent" | "failed";
  generated_at: string;
  next_attempt_at: string;
  attempt_count: number;
  sent_at: string | null;
  message_id: string | null;
  error: string | null;
  detail_json: string;
};

const SENSITIVE_KEY = /(authorization|token|secret|password|api[-_]?key|cookie|raw|mime|body|excerpt|content|subject|url|href|email)/i;

function stripControls(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return stripControls(raw)
    .replace(/\bauthorization\b\s*[:=]\s*bearer\s+\S+/gi, "authorization=[redacted]")
    .replace(/\b(bearer|authorization|token|secret|password|api[-_]?key)\b\s*[:=]?\s*\S+/gi, "$1=[redacted]")
    .slice(0, ALERT_DETAIL_MAX_CHARS) || "notification failed";
}

function safeField(value: unknown, max: number, fallback: string) {
  if (typeof value !== "string") return fallback;
  return stripControls(value).slice(0, max) || fallback;
}

function defaultConditionState(severity: AlertSeverity): OperationalConditionState {
  return severity === "critical" ? "failed" : severity === "warning" ? "degraded" : "healthy";
}

function sanitizedScalar(value: unknown): string | number | boolean | null | undefined {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return stripControls(value).slice(0, ALERT_DETAIL_MAX_CHARS);
}

/** Keep operational details deliberately narrower than general log sanitizing. */
export function sanitizeAlertDetails(input: Record<string, unknown> = {}) {
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= ALERT_MAX_DETAIL_KEYS || SENSITIVE_KEY.test(key)) continue;
    const safeKey = stripControls(key).slice(0, 80);
    if (!safeKey) continue;
    const safe = sanitizedScalar(value);
    if (safe === undefined) continue;
    out[safeKey] = safe;
    count += 1;
  }
  return out;
}

function safeDetailJson(input: Record<string, unknown> = {}) {
  return JSON.stringify(sanitizeAlertDetails(input));
}

function changedRows(result: unknown) {
  if (!result || typeof result !== "object") return 0;
  const direct = (result as { changes?: unknown }).changes;
  const nested = (result as { meta?: { changes?: unknown } }).meta?.changes;
  const value = typeof nested === "number" || typeof nested === "bigint" ? nested : direct;
  return typeof value === "number" || typeof value === "bigint" ? Number(value) : 0;
}

function utcDate(now: Date) {
  return now.toISOString().slice(0, 10);
}

function backoffMs(attempt: number) {
  return Math.min(ALERT_MAX_BACKOFF_MS, 15 * 60 * 1_000 * (2 ** Math.max(0, Math.min(attempt, 7))));
}

function alertBackoffMs(attempt: number) {
  // Send one sustained-incident reminder after the immediate transition,
  // then keep all later reminders to at most one per day.
  return attempt <= 0 ? ALERT_REPEAT_BASE_MS : ALERT_MAX_BACKOFF_MS;
}

function rowSelect() {
  return `
    SELECT fingerprint, pack_id, event, severity, state, occurrence_count,
           condition_state, institution_id, subsystem, group_key,
           first_seen_at, last_seen_at, next_notify_at,
           last_notification_attempt_at, last_notified_at,
           notification_attempt_count, last_notification_error, detail_json,
           recovery_detail_json,
           recovery_count, last_recovered_at,
           resolved_at
    FROM operational_alerts WHERE fingerprint = ?
  `;
}

/**
 * Record one occurrence, then atomically claim a notification slot. D1 is the
 * authority so duplicate Worker isolates cannot emit duplicate alerts.
 * Older failure observations cannot replace newer failure or recovery evidence.
 */
export async function recordOperationalAlert(
  db: D1DatabaseLike,
  input: OperationalAlertInput,
): Promise<AlertRecordResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const fingerprint = stripControls(input.fingerprint).slice(0, 240) || "unknown";
  const packId = stripControls(input.packId ?? "").slice(0, 120) || DEFAULT_ALERT_PACK_ID;
  const event = stripControls(input.event).slice(0, 120) || "unknown";
  const severity = input.severity;
  const conditionState = input.conditionState ?? defaultConditionState(severity);
  const institutionId = input.institutionId == null
    ? null
    : safeField(input.institutionId, 120, "");
  const subsystem = safeField(input.subsystem, 80, "automation");
  const groupKey = safeField(input.groupKey, 240, `${packId}:${subsystem}:${event}`);
  const threshold = Math.max(1, Math.min(100, Math.trunc(input.threshold ?? ALERT_DEFAULT_THRESHOLD)));
  const observationId = safeField(input.observationId, 240, "") || null;
  const details = { ...input.details };
  delete details.observationId;
  const detailJson = safeDetailJson(observationId ? { observationId, ...details } : details);
  const recorded = await db.prepare(`
    INSERT INTO operational_alerts (
      fingerprint, pack_id, event, severity, state, occurrence_count,
      condition_state, institution_id, subsystem, group_key,
      first_seen_at, last_seen_at, next_notify_at, detail_json
    ) VALUES (?, ?, ?, ?, 'open', 1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      pack_id = excluded.pack_id,
      event = excluded.event,
      severity = excluded.severity,
      state = 'open',
      condition_state = excluded.condition_state,
      institution_id = excluded.institution_id,
      subsystem = excluded.subsystem,
      group_key = excluded.group_key,
      occurrence_count = CASE
        WHEN operational_alerts.state = 'resolved' THEN 1
        WHEN json_extract(excluded.detail_json, '$.observationId') IS NOT NULL
          AND excluded.last_seen_at = operational_alerts.last_seen_at
          THEN operational_alerts.occurrence_count
        ELSE operational_alerts.occurrence_count + 1
      END,
      last_seen_at = excluded.last_seen_at,
      detail_json = excluded.detail_json,
      next_notify_at = CASE
        WHEN operational_alerts.state = 'resolved' THEN excluded.next_notify_at
        ELSE operational_alerts.next_notify_at
      END,
      last_notification_attempt_at = CASE
        WHEN operational_alerts.state = 'resolved' THEN NULL
        ELSE operational_alerts.last_notification_attempt_at
      END,
      last_notified_at = CASE
        WHEN operational_alerts.state = 'resolved' THEN NULL
        ELSE operational_alerts.last_notified_at
      END,
      notification_attempt_count = CASE
        WHEN operational_alerts.state = 'resolved' THEN 0
        ELSE operational_alerts.notification_attempt_count
      END,
      last_notification_error = CASE
        WHEN operational_alerts.state = 'resolved' THEN NULL
        ELSE operational_alerts.last_notification_error
      END,
      recovery_count = 0,
      recovery_detail_json = '{}',
      resolved_at = NULL
    WHERE excluded.last_seen_at >= operational_alerts.last_seen_at
      AND (operational_alerts.last_recovered_at IS NULL
        OR excluded.last_seen_at >= operational_alerts.last_recovered_at)
      AND (? IS NULL OR COALESCE(json_extract(operational_alerts.detail_json, '$.observationId'), '') != ?)
  `).bind(
    fingerprint,
    packId,
    event,
    severity,
    conditionState,
    institutionId,
    subsystem,
    groupKey,
    nowIso,
    nowIso,
    nowIso,
    detailJson,
    observationId,
    observationId,
  ).run();

  const before = await db.prepare(rowSelect()).bind(fingerprint).first<OperationalAlertRow>();
  if (!before) throw new Error("Operational alert row was not persisted");
  // A rejected stale condition cannot claim mail for the retained newer row.
  if (changedRows(recorded) === 0) return { row: before, claimed: false };
  if (input.notify === false) return { row: before, claimed: false };
  const due = Date.parse(before.next_notify_at) <= now.getTime();
  const eligible = before.state === "open"
    && before.occurrence_count >= threshold
    && due;
  if (!eligible) return { row: before, claimed: false };

  const attemptAt = nowIso;
  const next = new Date(now.getTime() + alertBackoffMs(before.notification_attempt_count)).toISOString();
  const claimed = await db.prepare(`
    UPDATE operational_alerts
    SET last_notification_attempt_at = ?,
        next_notify_at = ?,
        notification_attempt_count = notification_attempt_count + 1
    WHERE fingerprint = ?
      AND state = 'open'
      AND occurrence_count >= ?
      AND next_notify_at <= ?
  `).bind(attemptAt, next, fingerprint, threshold, nowIso).run();
  const row = await db.prepare(rowSelect()).bind(fingerprint).first<OperationalAlertRow>();
  if (!row) throw new Error("Operational alert row disappeared after claim");
  return { row, claimed: changedRows(claimed) > 0 };
}

export async function markOperationalAlertSent(
  db: D1DatabaseLike,
  fingerprint: string,
  now: Date,
) {
  return db.prepare(`
    UPDATE operational_alerts
    SET last_notified_at = ?, last_notification_error = NULL
    WHERE fingerprint = ?
  `).bind(now.toISOString(), fingerprint).run();
}

/**
 * Record a healthy observation without sending a recovery email. An alert is
 * resolved only after consecutive healthy observations; one flaky success
 * therefore cannot silence a still-degraded source. Success must postdate the
 * failure boundary; failure wins equal timestamps. D1 owns this counter so
 * recovery remains safe across Worker isolates and retries.
 */
export async function resolveOperationalAlertWithTransition(
  db: D1DatabaseLike,
  fingerprint: string,
  now = new Date(),
  requiredSuccesses = 2,
  recoveryDetails: Record<string, unknown> = {},
) {
  const safeFingerprint = stripControls(fingerprint).slice(0, 240);
  const required = Math.max(1, Math.min(20, Math.trunc(requiredSuccesses) || 1));
  const nowIso = now.toISOString();
  const observationId = safeField(recoveryDetails.observationId, 240, nowIso);
  const observationDetails = { ...recoveryDetails };
  delete observationDetails.observationId;
  await db.prepare(`
    UPDATE operational_alerts
    SET condition_state = 'healthy',
        recovery_count = MIN(?, recovery_count + 1),
        last_recovered_at = ?,
        recovery_detail_json = ?
    WHERE fingerprint = ? AND state = 'open'
      AND COALESCE(json_extract(recovery_detail_json, '$.observationId'), last_recovered_at, '') != ?
      AND (last_recovered_at IS NULL OR last_recovered_at < ?)
      AND last_seen_at < ?
  `).bind(required, nowIso, safeDetailJson({ observationId, ...observationDetails }), safeFingerprint, observationId, nowIso, nowIso).run();
  const resolution = await db.prepare(`
    UPDATE operational_alerts
    SET state = 'resolved', condition_state = 'resolved', resolved_at = ?, last_notification_error = NULL
    WHERE fingerprint = ? AND state = 'open' AND recovery_count >= ?
  `).bind(nowIso, safeFingerprint, required).run();
  const resolved = changedRows(resolution) > 0;
  const row = await db.prepare(rowSelect()).bind(safeFingerprint).first<OperationalAlertRow>();
  if (resolved && row?.state === "resolved") {
    logOps("ops-alert", {
      outcome: "resolved",
      fingerprint: safeFingerprint,
      recoveryCount: row.recovery_count,
    });
  }
  return { row, resolved };
}

/** Interrupt an open streak only at or after its latest failure/recovery boundary. */
export async function interruptOperationalAlertRecovery(
  db: D1DatabaseLike,
  fingerprint: string,
  conditionState: Exclude<OperationalConditionState, "healthy" | "resolved">,
  now: Date,
  details: Record<string, unknown> = {},
) {
  const nowIso = now.toISOString();
  return db.prepare(`
    UPDATE operational_alerts
    SET condition_state = ?, recovery_count = 0, recovery_detail_json = '{}',
        last_seen_at = ?, detail_json = ?, occurrence_count = occurrence_count + 1
    WHERE fingerprint = ? AND state = 'open' AND last_seen_at <= ?
      AND (last_recovered_at IS NULL OR last_recovered_at <= ?)
  `).bind(conditionState, nowIso, safeDetailJson(details), stripControls(fingerprint).slice(0, 240), nowIso, nowIso).run();
}

export async function resolveOperationalAlert(
  db: D1DatabaseLike,
  fingerprint: string,
  now = new Date(),
  requiredSuccesses = 2,
  recoveryDetails: Record<string, unknown> = {},
) {
  return (await resolveOperationalAlertWithTransition(db, fingerprint, now, requiredSuccesses, recoveryDetails)).row;
}

export async function markOperationalAlertFailed(
  db: D1DatabaseLike,
  fingerprint: string,
  error: unknown,
) {
  const message = safeErrorMessage(error);
  return db.prepare(`
    UPDATE operational_alerts SET last_notification_error = ? WHERE fingerprint = ?
  `).bind(message || "notification failed", fingerprint).run();
}

function alertSubject(row: OperationalAlertRow) {
  return `[The Valley Desk] ${row.severity.toUpperCase()}: ${row.event}`.slice(0, 180);
}

function alertText(row: OperationalAlertRow) {
  return [
    "The Valley Desk operational alert",
    `severity: ${row.severity}`,
    `condition_state: ${operationalConditionLabel(row.condition_state, row.state)}`,
    `event: ${row.event}`,
    `pack: ${row.pack_id}`,
    `subsystem: ${row.subsystem}`,
    `group_key: ${row.group_key}`,
    `institution: ${row.institution_id ?? "pack-wide"}`,
    `occurrences: ${row.occurrence_count}`,
    "occurrence_unit: condition-evaluations",
    `first_seen: ${row.first_seen_at}`,
    `last_seen: ${row.last_seen_at}`,
    `details: ${row.detail_json}`,
    "ops: /ops",
  ].join("\n");
}

function recoverySubject(row: OperationalAlertRow) {
  return `[The Valley Desk] RECOVERED: ${row.event}`.slice(0, 180);
}

function recoveryText(row: OperationalAlertRow) {
  return [
    "The Valley Desk operational alert recovered",
    `event: ${row.event}`,
    `pack: ${row.pack_id}`,
    `subsystem: ${row.subsystem}`,
    `group_key: ${row.group_key}`,
    `institution: ${row.institution_id ?? "pack-wide"}`,
    `recovered_at: ${row.resolved_at ?? row.last_recovered_at ?? row.last_seen_at}`,
    `recovery_checks: ${row.recovery_count}`,
    `recovery_observation: ${row.recovery_detail_json}`,
    `prior_failure: ${row.detail_json}`,
    "ops: /ops",
  ].join("\n");
}

/** Send one fixed-recipient notice for an atomically claimed recovery. */
export async function dispatchOperationalRecovery(
  db: D1DatabaseLike,
  binding: SendEmailBindingLike | undefined,
  row: OperationalAlertRow,
) {
  if (!binding) {
    await markOperationalAlertFailed(db, row.fingerprint, "NOTIFY_OPS binding unavailable");
    logOps("ops-alert", { outcome: "recovery-unconfigured", fingerprint: row.fingerprint });
    return { outcome: "unconfigured" as const, row };
  }
  try {
    const sent = await binding.send({
      to: OPS_ALERT_RECIPIENT,
      from: OPS_ALERT_SENDER,
      subject: recoverySubject(row),
      text: recoveryText(row),
    });
    logOps("ops-alert", { outcome: "recovery-sent", fingerprint: row.fingerprint });
    return { outcome: "sent" as const, row, messageId: sent.messageId };
  } catch (error) {
    await markOperationalAlertFailed(db, row.fingerprint, error);
    logOps("ops-alert", {
      outcome: "recovery-failed",
      fingerprint: row.fingerprint,
      message: safeErrorMessage(error),
    }, "warn");
    return { outcome: "failed" as const, row };
  }
}

/** Send only sanitized, fixed-recipient operational mail. */
export async function dispatchOperationalAlert(
  db: D1DatabaseLike,
  binding: SendEmailBindingLike | undefined,
  input: OperationalAlertInput,
) {
  const result = await recordOperationalAlert(db, input);
  if (!result.claimed) return { outcome: "deduped" as const, row: result.row };
  if (!binding) {
    await markOperationalAlertFailed(db, result.row.fingerprint, "NOTIFY_OPS binding unavailable");
    logOps("ops-alert", { outcome: "unconfigured", fingerprint: result.row.fingerprint });
    return { outcome: "unconfigured" as const, row: result.row };
  }
  try {
    const sent = await binding.send({
      to: OPS_ALERT_RECIPIENT,
      from: OPS_ALERT_SENDER,
      subject: alertSubject(result.row),
      text: alertText(result.row),
    });
    await markOperationalAlertSent(db, result.row.fingerprint, input.now ?? new Date());
    logOps("ops-alert", { outcome: "sent", fingerprint: result.row.fingerprint, severity: result.row.severity });
    return { outcome: "sent" as const, row: result.row, messageId: sent.messageId };
  } catch (error) {
    await markOperationalAlertFailed(db, result.row.fingerprint, error);
    logOps("ops-alert", {
      outcome: "failed",
      fingerprint: result.row.fingerprint,
      message: safeErrorMessage(error),
    }, "warn");
    return { outcome: "failed" as const, row: result.row };
  }
}

function digestSelect() {
  return `
    SELECT fingerprint, pack_id, event, severity, occurrence_count,
           condition_state, institution_id, subsystem, group_key,
           first_seen_at, last_seen_at, detail_json, recovery_count, last_recovered_at
    FROM operational_alerts
    WHERE pack_id = ? AND state = 'open'
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             last_seen_at DESC LIMIT ?
  `;
}

function digestDetailText(detailJson: string) {
  try {
    const details = JSON.parse(detailJson) as Record<string, unknown>;
    const keys = [
      "sourceId", "stage", "errorClass", "httpStatus", "lastSuccessAt",
      "failureAgeMs", "currentFallback", "nextRetryAt", "affectedCoverage",
      "collectionAgeMs", "observedAt", "primaryState", "primaryLastSuccessAt", "fallbackLastSuccessAt", "servingPath",
    ];
    return keys
      .filter((key) => Object.prototype.hasOwnProperty.call(details, key))
      .map((key) => `${key}=${stripControls(String(details[key])).slice(0, ALERT_DETAIL_MAX_CHARS)}`)
      .join(", ");
  } catch {
    return "";
  }
}

function digestSourceId(detailJson: string) {
  try {
    const details = JSON.parse(detailJson) as Record<string, unknown>;
    return typeof details.sourceId === "string" ? stripControls(details.sourceId).slice(0, 120) : "";
  } catch {
    return "";
  }
}

function severityRank(severity: AlertSeverity) {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}

function conditionRank(condition: OperationalConditionState) {
  return condition === "failed" ? 6
    : condition === "blocked" ? 5
      : condition === "degraded" ? 4
        : condition === "backoff" ? 3
          : condition === "healthy" ? 2
            : 1;
}

function digestText(date: string, rows: DigestRow[]) {
  const groups = new Map<string, DigestRow[]>();
  for (const row of rows) {
    const group = groups.get(row.group_key) ?? [];
    group.push(row);
    groups.set(row.group_key, group);
  }
  const lines = ["The Valley Desk daily operational digest", `date: ${date}`, `alerts: ${rows.length}`, `groups: ${groups.size}`];
  for (const groupRows of groups.values()) {
    const first = groupRows[0]!;
    const severity = groupRows.reduce((current, row) => (
      severityRank(row.severity) > severityRank(current) ? row.severity : current
    ), first.severity);
    const conditionStates = [...new Set(groupRows.map((row) => row.condition_state))]
      .sort((left, right) => conditionRank(right) - conditionRank(left))
      .map((state) => operationalConditionLabel(state));
    const events = [...new Set(groupRows.map((row) => row.event))].join("+");
    const sourceIds = [...new Set(groupRows.map((row) => digestSourceId(row.detail_json)).filter(Boolean))].join(",");
    const details = groupRows.map((row) => [
      digestDetailText(row.detail_json),
      ...(row.condition_state === "healthy" ? [
        `recoveryChecks=${row.recovery_count}, lastHealthyObservationAt=${row.last_recovered_at ?? "unknown"}`,
      ] : []),
    ].filter(Boolean).join(", ")).filter(Boolean).join(" | ");
    const occurrenceCount = groupRows.reduce((total, row) => total + row.occurrence_count, 0);
    const occurrenceUnit = "condition evaluations";
    const lastSeenAt = groupRows.map((row) => row.last_seen_at).sort().at(-1) ?? first.last_seen_at;
    const scope = first.institution_id ?? first.group_key;
    lines.push(`- ${conditionStates.join("/")} ${severity} ${first.subsystem}/${scope} ${events} (${occurrenceCount} ${occurrenceUnit}; last ${lastSeenAt}${sourceIds ? `; sources=${sourceIds}` : ""}${details ? `; ${details}` : ""})`);
  }
  lines.push("ops: /ops");
  return lines.join("\n");
}

/** At-most-once-per-day digest claim, with bounded retry after send failure. */
export async function dispatchOperationalDigest(
  db: D1DatabaseLike,
  binding: SendEmailBindingLike | undefined,
  now = new Date(),
  packId = DEFAULT_ALERT_PACK_ID,
) {
  const safePackId = stripControls(packId).slice(0, 120) || DEFAULT_ALERT_PACK_ID;
  const date = utcDate(now);
  const nowIso = now.toISOString();
  const existing = await db.prepare(`SELECT digest_date, pack_id, status, generated_at, next_attempt_at,
      attempt_count, sent_at, message_id, error, detail_json
      FROM operational_digests WHERE digest_date = ? AND pack_id = ?`).bind(date, safePackId).first<DigestRecord>();
  if (existing?.status === "sent" || (existing && Date.parse(existing.next_attempt_at) > now.getTime())) {
    return { outcome: "deduped" as const, date };
  }
  if (!existing) {
    await db.prepare(`INSERT INTO operational_digests
      (digest_date, pack_id, status, generated_at, next_attempt_at, detail_json)
      VALUES (?, ?, 'pending', ?, ?, '{}')
      ON CONFLICT(digest_date, pack_id) DO NOTHING`).bind(date, safePackId, nowIso, nowIso).run();
  }
  const claimed = await db.prepare(`UPDATE operational_digests
      SET status = 'pending', generated_at = ?, next_attempt_at = ?,
          attempt_count = attempt_count + 1, error = NULL
      WHERE digest_date = ? AND pack_id = ? AND status != 'sent' AND next_attempt_at <= ?`
  ).bind(nowIso, new Date(now.getTime() + backoffMs(existing?.attempt_count ?? 0)).toISOString(), date, safePackId, nowIso).run();
  if (changedRows(claimed) === 0) return { outcome: "deduped" as const, date };
  const rows = await db.prepare(digestSelect()).bind(safePackId, ALERT_MAX_DIGEST_ROWS).all<DigestRow>();
  const digestRows = rows.results ?? [];
  const digestSnapshot = JSON.stringify({
    generatedAt: nowIso,
    fingerprints: digestRows.map((row) => row.fingerprint),
  });
  await db.prepare(`UPDATE operational_digests SET detail_json = ?
    WHERE digest_date = ? AND pack_id = ?`).bind(digestSnapshot, date, safePackId).run();
  if (!binding) {
    await db.prepare("UPDATE operational_digests SET status = 'failed', error = ? WHERE digest_date = ? AND pack_id = ?")
      .bind("NOTIFY_OPS binding unavailable", date, safePackId).run();
    return { outcome: "unconfigured" as const, date, count: digestRows.length };
  }
  try {
    const sent = await binding.send({
      to: OPS_ALERT_RECIPIENT,
      from: OPS_ALERT_SENDER,
      subject: `[The Valley Desk] daily ops digest ${date}`,
      text: digestText(date, digestRows),
    });
    await db.prepare(`UPDATE operational_digests SET status = 'sent', sent_at = ?, message_id = ?, error = NULL
      WHERE digest_date = ? AND pack_id = ?`).bind(nowIso, sent.messageId ?? null, date, safePackId).run();
    logOps("ops-digest", { outcome: "sent", packId: safePackId, date, count: digestRows.length });
    return { outcome: "sent" as const, date, count: digestRows.length, messageId: sent.messageId };
  } catch (error) {
    const message = safeErrorMessage(error);
    await db.prepare("UPDATE operational_digests SET status = 'failed', error = ? WHERE digest_date = ? AND pack_id = ?")
      .bind(message || "email send failed", date, safePackId).run();
    logOps("ops-digest", { outcome: "failed", packId: safePackId, date, message: message || "email send failed" }, "warn");
    return { outcome: "failed" as const, date, count: digestRows.length };
  }
}
