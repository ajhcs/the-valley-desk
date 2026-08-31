-- Keep the last successful fallback visible to operators, and retain the
-- external Vale run receipt separately from social evidence packets.
ALTER TABLE source_health ADD COLUMN last_fallback_url TEXT;

CREATE TABLE IF NOT EXISTS social_collector_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  collector TEXT NOT NULL CHECK (collector = 'vale'),
  manifest_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failed')),
  accounts_checked INTEGER NOT NULL DEFAULT 0 CHECK (accounts_checked >= 0),
  posts_seen INTEGER NOT NULL DEFAULT 0 CHECK (posts_seen >= 0),
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  duplicates INTEGER NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  platforms_json TEXT NOT NULL DEFAULT '{}',
  failure_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS social_collector_runs_outcome_idx
  ON social_collector_runs (collector, outcome, finished_at DESC);
