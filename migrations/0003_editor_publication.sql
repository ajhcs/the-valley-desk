CREATE TABLE published_content (
  candidate_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  first_published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, slug),
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id)
);

CREATE INDEX published_content_kind_slug_idx ON published_content(kind, slug);
CREATE INDEX published_content_updated_idx ON published_content(updated_at DESC);

ALTER TABLE candidate_decisions ADD COLUMN method TEXT NOT NULL DEFAULT 'human';
ALTER TABLE candidate_decisions ADD COLUMN provider TEXT;
ALTER TABLE candidate_decisions ADD COLUMN model TEXT;
ALTER TABLE candidate_decisions ADD COLUMN policy_version TEXT;
ALTER TABLE candidate_decisions ADD COLUMN confidence REAL;
ALTER TABLE candidate_decisions ADD COLUMN evidence_json TEXT;
ALTER TABLE candidate_decisions ADD COLUMN metadata_json TEXT;

CREATE TABLE automation_locks (
  name TEXT PRIMARY KEY,
  owner_run_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
