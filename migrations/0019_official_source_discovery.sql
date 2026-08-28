PRAGMA foreign_keys = ON;

-- Official-source discovery schedule, snapshots, and review-only candidate
-- provenance. Raw HTML is never stored. Converted ContentItems remain review
-- until the existing evidence editor and two-pass verifier decide.

CREATE TABLE official_source_schedule (
  source_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN (
    'pending',
    'success',
    'unchanged',
    'failed',
    'blocked',
    'hostile',
    'disabled'
  )),
  last_hash TEXT,
  last_attempted_at TEXT,
  last_success_at TEXT,
  next_attempt_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error TEXT
);

CREATE INDEX official_source_schedule_due_idx
  ON official_source_schedule(next_attempt_at, state);

CREATE TABLE official_source_snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  final_url TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  byte_count INTEGER NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial', 'unknown')),
  state TEXT NOT NULL CHECK (state IN ('success', 'unchanged', 'failed', 'blocked', 'hostile')),
  source_title TEXT,
  error TEXT,
  instruction_like INTEGER NOT NULL DEFAULT 0 CHECK (instruction_like IN (0, 1))
);

CREATE INDEX official_source_snapshots_source_idx
  ON official_source_snapshots(source_id, fetched_at DESC);

CREATE TABLE official_source_candidates (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT,
  institution_id TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'news', 'policy', 'finance', 'filing', 'product', 'procurement', 'events'
  )),
  region TEXT NOT NULL CHECK (region IN ('PA', 'NJ', 'DE', 'regional', 'federal')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source_page_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  trust TEXT NOT NULL CHECK (trust IN ('first-party', 'regulatory', 'association')),
  product_ids_json TEXT NOT NULL DEFAULT '[]',
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status = 'review'),
  instruction_like INTEGER NOT NULL DEFAULT 0 CHECK (instruction_like IN (0, 1)),
  -- Bounded normalized detail evidence only. Never store upstream HTML.
  detail_title TEXT,
  detail_text TEXT,
  detail_fetched_at TEXT,
  detail_hash TEXT,
  detail_state TEXT CHECK (detail_state IS NULL OR detail_state IN ('success', 'failed', 'blocked', 'hostile')),
  detail_error TEXT,
  event_starts_at TEXT,
  event_ends_at TEXT,
  venue TEXT,
  city TEXT,
  relevance_decision TEXT CHECK (relevance_decision IN ('accept', 'review', 'reject')),
  relevance_score INTEGER CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 100)),
  relevance_confidence REAL CHECK (relevance_confidence IS NULL OR (relevance_confidence >= 0 AND relevance_confidence <= 1)),
  relevance_reasons_json TEXT NOT NULL DEFAULT '[]',
  relevance_evidence_json TEXT NOT NULL DEFAULT '[]',
  content_item_id TEXT,
  UNIQUE(source_id, url),
  FOREIGN KEY (snapshot_id) REFERENCES official_source_snapshots(id)
);

CREATE INDEX official_source_candidates_review_idx
  ON official_source_candidates(status, last_seen_at DESC);

CREATE INDEX official_source_candidates_source_idx
  ON official_source_candidates(source_id, discovered_at DESC);

CREATE INDEX official_source_candidates_content_idx
  ON official_source_candidates(content_item_id)
  WHERE content_item_id IS NOT NULL;

CREATE INDEX official_source_candidates_detail_idx
  ON official_source_candidates(detail_state, detail_fetched_at DESC);
