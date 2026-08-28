CREATE TABLE IF NOT EXISTS social_evidence_packets (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'x')),
  post_url TEXT NOT NULL,
  post_id TEXT,
  author_name TEXT NOT NULL,
  author_profile_url TEXT NOT NULL,
  author_json TEXT NOT NULL,
  post_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  linked_sources_json TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '{}',
  collector_analysis_json TEXT NOT NULL DEFAULT '{}',
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review'
    CHECK (status IN ('review', 'processed', 'ignored', 'rejected')),
  instruction_like INTEGER NOT NULL DEFAULT 0 CHECK (instruction_like IN (0, 1)),
  receive_count INTEGER NOT NULL DEFAULT 1 CHECK (receive_count >= 1),
  posted_at TEXT,
  observed_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  processed_at TEXT,
  candidate_id TEXT,
  UNIQUE (platform, post_url)
);

CREATE INDEX IF NOT EXISTS social_evidence_status_observed_idx
  ON social_evidence_packets (status, observed_at DESC);

CREATE INDEX IF NOT EXISTS social_evidence_author_idx
  ON social_evidence_packets (platform, author_profile_url, observed_at DESC);
