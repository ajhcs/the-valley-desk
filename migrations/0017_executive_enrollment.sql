PRAGMA foreign_keys = ON;

-- Newly discovered names are retained even when they are not present in the
-- seed registry. They stay pending until the same institution-scoped identity
-- is corroborated by the autonomous leadership policy. This ledger is not a
-- publication queue and contains no reader-facing copy.
CREATE TABLE executive_enrollment_candidates (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  latest_title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  complete_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (complete_snapshot_count >= 0),
  independent_source_count INTEGER NOT NULL DEFAULT 0 CHECK (independent_source_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enrolled', 'ambiguous', 'rejected')),
  enrolled_person_id TEXT,
  last_evidence_at TEXT,
  note TEXT,
  FOREIGN KEY (institution_id) REFERENCES covered_institutions(id),
  FOREIGN KEY (enrolled_person_id) REFERENCES covered_people(id),
  UNIQUE (institution_id, normalized_name),
  CHECK (status <> 'enrolled' OR enrolled_person_id IS NOT NULL)
);

CREATE INDEX executive_enrollment_status_idx
  ON executive_enrollment_candidates(status, last_seen_at DESC);
CREATE INDEX executive_enrollment_institution_idx
  ON executive_enrollment_candidates(institution_id, normalized_name);
