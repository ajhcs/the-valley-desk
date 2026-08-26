ALTER TABLE content_candidates ADD COLUMN missing_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_candidates ADD COLUMN last_missing_at TEXT;

CREATE TABLE source_health (
  source_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'events', 'social')),
  source_url TEXT,
  state TEXT NOT NULL CHECK (state IN ('success', 'error')),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  item_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_run_id TEXT NOT NULL,
  FOREIGN KEY (last_run_id) REFERENCES ingest_runs(id)
);

CREATE INDEX source_health_state_idx ON source_health(state, last_checked_at DESC);

CREATE TABLE publication_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('missing', 'withdrawn')),
  missing_count INTEGER NOT NULL,
  reason TEXT NOT NULL,
  run_id TEXT NOT NULL,
  reconciled_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id),
  FOREIGN KEY (run_id) REFERENCES ingest_runs(id)
);

CREATE INDEX publication_reconciliations_candidate_idx
  ON publication_reconciliations(candidate_id, reconciled_at DESC);
