-- Keep rejected social evidence out of the next bounded review window while
-- retaining the original packet and a bounded operator-visible reason.
PRAGMA foreign_keys = OFF;

CREATE TABLE social_evidence_packets_next (
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
    CHECK (status IN ('review', 'processed', 'ignored', 'rejected', 'quarantined')),
  quarantine_reason TEXT,
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

INSERT INTO social_evidence_packets_next (
  id, schema_version, platform, post_url, post_id, author_name,
  author_profile_url, author_json, post_json, attachments_json,
  linked_sources_json, entities_json, collector_analysis_json, evidence_hash,
  status, instruction_like, receive_count, posted_at, observed_at,
  first_seen_at, last_seen_at, processed_at, candidate_id
)
SELECT
  id, schema_version, platform, post_url, post_id, author_name,
  author_profile_url, author_json, post_json, attachments_json,
  linked_sources_json, entities_json, collector_analysis_json, evidence_hash,
  status, instruction_like, receive_count, posted_at, observed_at,
  first_seen_at, last_seen_at, processed_at, candidate_id
FROM social_evidence_packets;

DROP TABLE social_evidence_packets;
ALTER TABLE social_evidence_packets_next RENAME TO social_evidence_packets;

CREATE INDEX social_evidence_status_observed_idx
  ON social_evidence_packets (status, observed_at DESC);

CREATE INDEX social_evidence_author_idx
  ON social_evidence_packets (platform, author_profile_url, observed_at DESC);

-- Receipt streaks let the Worker signal the external routine to pause after
-- three consecutive failed/partial runs without making a duplicate run ID
-- increment the streak.
ALTER TABLE social_collector_runs ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_collector_runs ADD COLUMN paused_at TEXT;

PRAGMA foreign_keys = ON;
