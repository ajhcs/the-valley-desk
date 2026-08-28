PRAGMA foreign_keys = ON;

-- Executive intelligence and reusable coverage-pack state. Review-only.
-- Role history is append-only: close with effective_to, never overwrite title.

CREATE TABLE covered_institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  org_ids_json TEXT NOT NULL DEFAULT '[]',
  regions_json TEXT NOT NULL DEFAULT '[]',
  coverage_tier TEXT NOT NULL CHECK (coverage_tier IN ('core', 'extended', 'inventory')),
  covered INTEGER NOT NULL CHECK (covered IN (0, 1)),
  in_box INTEGER NOT NULL CHECK (in_box IN (0, 1)),
  edge INTEGER NOT NULL CHECK (edge IN (0, 1)),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  website TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE coverage_sources (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'leadership-page',
    'about-page',
    'person-bio',
    'newsroom-bio',
    'linkedin-organization',
    'linkedin-person'
  )),
  url TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  precedence INTEGER NOT NULL CHECK (precedence >= 0 AND precedence <= 100),
  monitor INTEGER NOT NULL CHECK (monitor IN (0, 1)),
  cadence TEXT NOT NULL CHECK (cadence IN ('hourly', 'daily', 'weekly', 'inventory')),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'inventory-only', 'disabled')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (institution_id) REFERENCES covered_institutions(id),
  CHECK (
    kind NOT IN ('linkedin-organization', 'linkedin-person')
    OR (
      monitor = 0
      AND status = 'inventory-only'
      AND cadence = 'inventory'
    )
  ),
  CHECK (monitor = 0 OR status = 'enabled')
);

CREATE INDEX coverage_sources_institution_idx
  ON coverage_sources(institution_id, precedence DESC);
CREATE INDEX coverage_sources_monitor_idx
  ON coverage_sources(monitor, status, cadence);

CREATE TABLE covered_people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX covered_people_normalized_name_idx
  ON covered_people(normalized_name);

CREATE TABLE executive_roles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  source_id TEXT,
  evidence_url TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES covered_people(id),
  FOREIGN KEY (institution_id) REFERENCES covered_institutions(id),
  FOREIGN KEY (source_id) REFERENCES coverage_sources(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Current title occupancy is unique. History rows keep overlapping closed periods.
CREATE UNIQUE INDEX executive_roles_open_title_idx
  ON executive_roles(person_id, institution_id, normalized_title)
  WHERE effective_to IS NULL;

CREATE INDEX executive_roles_person_idx
  ON executive_roles(person_id, institution_id, effective_from DESC);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  final_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  normalized_text TEXT,
  byte_count INTEGER NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  extracted_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('success', 'unchanged', 'failed', 'blocked', 'hostile')),
  error TEXT,
  FOREIGN KEY (source_id) REFERENCES coverage_sources(id)
);

CREATE INDEX source_snapshots_source_idx
  ON source_snapshots(source_id, fetched_at DESC);

CREATE TABLE source_observations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT,
  institution_id TEXT,
  person_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'unchanged',
    'person-appeared',
    'person-departed',
    'title-changed',
    'hostile-content',
    'fetch-failed'
  )),
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'ignored')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  instruction_like INTEGER NOT NULL DEFAULT 0 CHECK (instruction_like IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES coverage_sources(id),
  FOREIGN KEY (snapshot_id) REFERENCES source_snapshots(id),
  FOREIGN KEY (institution_id) REFERENCES covered_institutions(id),
  FOREIGN KEY (person_id) REFERENCES covered_people(id)
);

CREATE INDEX source_observations_review_idx
  ON source_observations(status, created_at DESC);
CREATE INDEX source_observations_source_idx
  ON source_observations(source_id, created_at DESC);

CREATE TABLE scheduled_source_state (
  source_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN (
    'pending',
    'healthy',
    'unchanged',
    'hostile',
    'blocked',
    'disabled',
    'inventory-only',
    'misconfigured',
    'upstream-failed',
    'timed-out'
  )),
  last_hash TEXT,
  last_extracted_json TEXT,
  last_attempted_at TEXT,
  last_success_at TEXT,
  next_attempt_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error TEXT,
  FOREIGN KEY (source_id) REFERENCES coverage_sources(id)
);

CREATE INDEX scheduled_source_state_due_idx
  ON scheduled_source_state(next_attempt_at, state);
