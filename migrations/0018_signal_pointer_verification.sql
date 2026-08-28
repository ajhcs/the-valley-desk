-- Bounded verification of untrusted email/LinkedIn notification pointers.
-- The parent discovery remains review-only; this state records what happened
-- when a pointer was checked against the official public source registry.

ALTER TABLE email_discoveries ADD COLUMN verification_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (verification_state IN ('pending', 'processing', 'verified', 'rejected', 'failed'));
ALTER TABLE email_discoveries ADD COLUMN verification_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (verification_attempt_count >= 0);
ALTER TABLE email_discoveries ADD COLUMN verification_attempted_at TEXT;
ALTER TABLE email_discoveries ADD COLUMN verification_next_attempt_at TEXT;
ALTER TABLE email_discoveries ADD COLUMN verification_error TEXT;
ALTER TABLE email_discoveries ADD COLUMN verified_url_count INTEGER NOT NULL DEFAULT 0
  CHECK (verified_url_count >= 0);
ALTER TABLE email_discoveries ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0
  CHECK (candidate_count >= 0);
ALTER TABLE email_discoveries ADD COLUMN verified_at TEXT;

CREATE INDEX email_discoveries_verification_due_idx
  ON email_discoveries(verification_state, verification_next_attempt_at, first_seen_at);

CREATE TABLE signal_pointer_verifications (
  id TEXT PRIMARY KEY,
  discovery_id TEXT NOT NULL,
  pointer_url TEXT NOT NULL,
  normalized_url TEXT,
  source_id TEXT,
  source_origin TEXT,
  trust_state TEXT NOT NULL CHECK (trust_state IN ('untrusted-pointer', 'authenticated-pointer')),
  state TEXT NOT NULL CHECK (state IN ('verified', 'rejected', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  attempted_at TEXT NOT NULL,
  next_attempt_at TEXT,
  final_url TEXT,
  content_hash TEXT,
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  UNIQUE(discovery_id, pointer_url),
  FOREIGN KEY (discovery_id) REFERENCES email_discoveries(id) ON DELETE CASCADE
);

CREATE INDEX signal_pointer_verifications_discovery_idx
  ON signal_pointer_verifications(discovery_id, attempted_at DESC);

CREATE INDEX signal_pointer_verifications_due_idx
  ON signal_pointer_verifications(state, next_attempt_at, attempted_at);
