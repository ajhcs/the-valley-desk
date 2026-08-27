-- Review-only inbound email discovery. Do not store raw MIME or auto-publish.

CREATE TABLE email_discoveries (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  envelope_to TEXT NOT NULL,
  from_address TEXT,
  from_domain TEXT NOT NULL,
  subject TEXT,
  category TEXT NOT NULL CHECK (category IN ('linkedin', 'page', 'newsletter', 'unknown')),
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'ignored')),
  url_count INTEGER NOT NULL DEFAULT 0,
  urls_json TEXT NOT NULL DEFAULT '[]',
  excerpt TEXT,
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0 AND raw_size <= 512000),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  instruction_like INTEGER NOT NULL DEFAULT 0 CHECK (instruction_like IN (0, 1)),
  receive_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX email_discoveries_message_id_idx
  ON email_discoveries(envelope_to, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX email_discoveries_status_idx
  ON email_discoveries(status, last_seen_at DESC);

CREATE INDEX email_discoveries_category_idx
  ON email_discoveries(category, last_seen_at DESC);

CREATE INDEX email_discoveries_sender_age_idx
  ON email_discoveries(from_domain, first_seen_at DESC);

CREATE INDEX email_discoveries_first_seen_idx
  ON email_discoveries(first_seen_at DESC);

CREATE INDEX email_discoveries_last_seen_idx
  ON email_discoveries(last_seen_at DESC);
