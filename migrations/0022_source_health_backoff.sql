-- Public access failures are distinct from credential failures. The durable
-- cooldown fields keep every Worker isolate on the same retry schedule.

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
    'upstream-blocked',
    'backoff',
    'rate-limited',
    'upstream-failed',
    'parser-failed',
    'timed-out'
  )),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  item_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT,
  last_run_id TEXT NOT NULL,
  completeness TEXT NOT NULL DEFAULT 'partial'
    CHECK (completeness IN ('complete', 'partial', 'empty-unverified')),
  next_attempt_at TEXT NOT NULL,
  last_http_status INTEGER,
  requires_auth INTEGER NOT NULL DEFAULT 0 CHECK (requires_auth IN (0, 1)),
  FOREIGN KEY (last_run_id) REFERENCES ingest_runs(id)
);

INSERT INTO source_health_next (
  source_id, origin, source_type, source_url, state, complete, item_count,
  consecutive_failures, last_checked_at, last_success_at, last_error,
  last_run_id, completeness, next_attempt_at, last_http_status, requires_auth
)
SELECT
  source_id,
  origin,
  source_type,
  source_url,
  state,
  complete,
  item_count,
  consecutive_failures,
  last_checked_at,
  last_success_at,
  last_error,
  last_run_id,
  completeness,
  CASE
    WHEN state IN ('healthy', 'healthy-empty', 'disabled', 'misconfigured') THEN last_checked_at
    WHEN consecutive_failures <= 1 THEN datetime(last_checked_at, '+15 minutes')
    WHEN consecutive_failures = 2 THEN datetime(last_checked_at, '+1 hour')
    WHEN consecutive_failures = 3 THEN datetime(last_checked_at, '+6 hours')
    ELSE datetime(last_checked_at, '+1 day')
  END,
  NULL,
  -- The pre-0022 table used auth-failed for some public 401/403 responses.
  -- There was no credential-context bit to justify carrying that label forward;
  -- re-probe those sources instead of inferring an authentication requirement.
  0
FROM source_health;

DROP TABLE source_health;
ALTER TABLE source_health_next RENAME TO source_health;

CREATE INDEX source_health_state_idx ON source_health(state, last_checked_at DESC);
CREATE INDEX source_health_due_idx ON source_health(next_attempt_at, state);

PRAGMA foreign_keys = ON;
