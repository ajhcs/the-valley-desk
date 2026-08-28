-- Untrusted inbound signal provenance and durable operational notifications.
-- This migration is additive: existing email discoveries remain review-only
-- pointers, and old Worker versions can continue to read the original columns.

ALTER TABLE email_discoveries ADD COLUMN trust_state TEXT NOT NULL DEFAULT 'untrusted-pointer'
  CHECK (trust_state IN ('untrusted-pointer', 'authenticated-pointer'));

CREATE INDEX email_discoveries_trust_state_idx
  ON email_discoveries(trust_state, last_seen_at DESC);

CREATE TABLE operational_alerts (
  fingerprint TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL DEFAULT 'valley-desk',
  event TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  next_notify_at TEXT NOT NULL,
  last_notification_attempt_at TEXT,
  last_notified_at TEXT,
  notification_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (notification_attempt_count >= 0),
  last_notification_error TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  resolved_at TEXT
);

CREATE INDEX operational_alerts_due_idx
  ON operational_alerts(state, next_notify_at, severity);

CREATE INDEX operational_alerts_pack_idx
  ON operational_alerts(pack_id, last_seen_at DESC);

CREATE TABLE operational_digests (
  digest_date TEXT NOT NULL,
  pack_id TEXT NOT NULL DEFAULT 'valley-desk',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  generated_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  sent_at TEXT,
  message_id TEXT,
  error TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (digest_date, pack_id)
);

CREATE INDEX operational_digests_due_idx
  ON operational_digests(status, next_attempt_at);
