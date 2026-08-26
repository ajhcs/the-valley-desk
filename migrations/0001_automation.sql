PRAGMA foreign_keys = ON;

CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  notes_json TEXT,
  error TEXT
);

CREATE TABLE content_candidates (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source_origin TEXT NOT NULL,
  source_external_id TEXT,
  source_url TEXT,
  item_status TEXT NOT NULL,
  queue_status TEXT NOT NULL DEFAULT 'review'
    CHECK (queue_status IN ('review', 'approved', 'rejected')),
  content_json TEXT NOT NULL,
  enrichment_json TEXT,
  relevance_score INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_run_id TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (last_run_id) REFERENCES ingest_runs(id)
);

CREATE INDEX content_candidates_queue_idx
  ON content_candidates(queue_status, relevance_score DESC, last_seen_at DESC);
CREATE INDEX content_candidates_source_idx
  ON content_candidates(source_origin, source_external_id);
CREATE INDEX ingest_runs_started_idx ON ingest_runs(started_at DESC);
