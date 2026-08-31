import type { D1DatabaseLike } from "../ingest/persistence";
import { logOps } from "./ops";

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

export type OperationalAlertInput = {
  fingerprint: string;
  packId?: string;
  event: string;
  severity: AlertSeverity;
  details?: Record<string, unknown>;
  threshold?: number;
  now?: Date;
  /** Record the occurrence for the daily digest without claiming immediate mail. */
  notify?: boolean;
};

export type OperationalAlertRow = {
  fingerprint: string;
  pack_id: string;
  event: string;
  severity: AlertSeverity;
  state: "open" | "resolved";
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  next_notify_at: string;
  last_notification_attempt_at: string | null;
  last_notified_at: string | null;
  notification_attempt_count: number;
  last_notification_error: string | null;
  detail_json: string;
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
  fingerprint: string;
  pack_id: string;
  event: string;
  severity: AlertSeverity;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
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
  // Runs are hourly. Keep a continuing incident from generating an email on
  // every run; the daily digest remains the bounded status channel.
  return Math.min(ALERT_MAX_BACKOFF_MS, ALERT_REPEAT_BASE_MS * (2 ** Math.max(0, Math.min(attempt, 3))));
}

function rowSelect() {
  return `
    SELECT fingerprint, pack_id, event, severity, state, occurrence_count,
           first_seen_at, last_seen_at, next_notify_at,
           last_notification_attempt_at, last_notified_at,
           notification_attempt_count, last_notification_error, detail_json,
           recovery_count, last_recovered_at,
           resolved_at
    FROM operational_alerts WHERE fingerprint = ?
  `;
}

/**
 * Record one occurrence, then atomically claim a notification slot. D1 is the
 * authority so duplicate Worker isolates cannot emit duplicate alerts.
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
  const threshold = Math.max(1, Math.min(100, Math.trunc(input.threshold ?? ALERT_DEFAULT_THRESHOLD)));
  const detailJson = safeDetailJson(input.details);
  await db.prepare(`
    INSERT INTO operational_alerts (
      fingerprint, pack_id, event, severity, state, occurrence_count,
      first_seen_at, last_seen_at, next_notify_at, detail_json
    ) VALUES (?, ?, ?, ?, 'open', 1, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      pack_id = excluded.pack_id,
      event = excluded.event,
      severity = excluded.severity,
      state = 'open',
      occurrence_count = CASE
        WHEN operational_alerts.state = 'resolved' THEN 1
        ELSE operational_alerts.occurrence_count + 1
      END,
      last_seen_at = excluded.last_seen_at,
      detail_json = excluded.detail_json,
      next_notify_at = CASE
        WHEN operational_alerts.state = 'resolved' THEN excluded.next_notify_at
        ELSE operational_alerts.next_notify_at
      END,
      recovery_count = 0,
      resolved_at = NULL
  `).bind(
    fingerprint,
    packId,
    event,
    severity,
    nowIso,
    nowIso,
    nowIso,
    detailJson,
  ).run();

  const before = await db.prepare(rowSelect()).bind(fingerprint).first<OperationalAlertRow>();
  if (!before) throw new Error("Operational alert row was not persisted");
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
 * therefore cannot silence a still-degraded source. D1 owns this counter so
 * recovery remains safe across Worker isolates and retries.
 */
export async function resolveOperationalAlertWithTransition(
  db: D1DatabaseLike,
  fingerprint: string,
  now = new Date(),
  requiredSuccesses = 2,
) {
  const safeFingerprint = stripControls(fingerprint).slice(0, 240);
  const required = Math.max(1, Math.min(20, Math.trunc(requiredSuccesses) || 1));
  const nowIso = now.toISOString();
  await db.prepare(`
    UPDATE operational_alerts
    SET recovery_count = MIN(?, recovery_count + 1),
        last_recovered_at = ?
    WHERE fingerprint = ? AND state = 'open'
  `).bind(required, nowIso, safeFingerprint).run();
  const resolution = await db.prepare(`
    UPDATE operational_alerts
    SET state = 'resolved', resolved_at = ?, last_notification_error = NULL
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

export async function resolveOperationalAlert(
  db: D1DatabaseLike,
  fingerprint: string,
  now = new Date(),
  requiredSuccesses = 2,
) {
  return (await resolveOperationalAlertWithTransition(db, fingerprint, now, requiredSuccesses)).row;
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
    `event: ${row.event}`,
    `pack: ${row.pack_id}`,
    `occurrences: ${row.occurrence_count}`,
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
    `recovered_at: ${row.resolved_at ?? row.last_recovered_at ?? row.last_seen_at}`,
    `recovery_checks: ${row.recovery_count}`,
    `details: ${row.detail_json}`,
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
      message: error instanceof Error ? error.message : "email send failed",
    }, "warn");
    return { outcome: "failed" as const, row: result.row };
  }
}

function digestSelect() {
  return `
    SELECT fingerprint, pack_id, event, severity, occurrence_count,
           first_seen_at, last_seen_at
    FROM operational_alerts
    WHERE pack_id = ? AND state = 'open' AND last_seen_at >= ?
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             last_seen_at DESC LIMIT ?
  `;
}

function digestText(date: string, rows: DigestRow[]) {
  const lines = ["The Valley Desk daily operational digest", `date: ${date}`, `alerts: ${rows.length}`];
  for (const row of rows) {
    lines.push(`- ${row.severity} ${row.event} (${row.occurrence_count} occurrences; last ${row.last_seen_at})`);
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
  const dayStart = `${date}T00:00:00.000Z`;
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
  const rows = await db.prepare(digestSelect()).bind(safePackId, dayStart, ALERT_MAX_DIGEST_ROWS).all<DigestRow>();
  const digestRows = rows.results ?? [];
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
