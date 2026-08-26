PRAGMA foreign_keys = OFF;

CREATE TABLE source_health_next (
  source_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'events', 'social')),
  source_url TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'healthy',
    'healthy-empty',
    'disabled',
    'misconfigured',
    'auth-failed',
    'rate-limited',
    'upstream-failed',
    'parser-failed',
    'timed-out'
  )),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  item_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_run_id TEXT NOT NULL,
  FOREIGN KEY (last_run_id) REFERENCES ingest_runs(id)
);

INSERT INTO source_health_next (
  source_id, origin, source_type, source_url, state, complete, item_count,
  consecutive_failures, last_checked_at, last_success_at, last_error, last_run_id
)
SELECT
  source_id,
  origin,
  source_type,
  source_url,
  CASE state
    WHEN 'success' THEN CASE WHEN item_count > 0 THEN 'healthy' ELSE 'healthy-empty' END
    WHEN 'error' THEN 'upstream-failed'
    ELSE state
  END,
  complete,
  item_count,
  consecutive_failures,
  last_checked_at,
  last_success_at,
  last_error,
  last_run_id
FROM source_health;

DROP TABLE source_health;
ALTER TABLE source_health_next RENAME TO source_health;

CREATE INDEX source_health_state_idx ON source_health(state, last_checked_at DESC);

PRAGMA foreign_keys = ON;

