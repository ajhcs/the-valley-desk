PRAGMA foreign_keys = ON;

-- Additive verification and coverage metadata. Existing 0012 rows remain valid.
ALTER TABLE covered_institutions ADD COLUMN official_source_status TEXT NOT NULL DEFAULT 'degraded'
  CHECK (official_source_status IN ('active', 'degraded', 'inventory-only'));
ALTER TABLE covered_institutions ADD COLUMN official_source_note TEXT;

ALTER TABLE covered_people ADD COLUMN known_title TEXT;
ALTER TABLE covered_people ADD COLUMN source_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE covered_people ADD COLUMN linkedin_url TEXT;

ALTER TABLE source_snapshots ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'unrecognized'
  CHECK (extraction_status IN ('complete', 'empty-unverified', 'challenge', 'partial', 'unrecognized'));

ALTER TABLE source_observations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'verified', 'ignored'));
ALTER TABLE source_observations ADD COLUMN reviewed_at TEXT;
ALTER TABLE source_observations ADD COLUMN reviewed_by TEXT;
ALTER TABLE source_observations ADD COLUMN review_note TEXT;

ALTER TABLE executive_roles ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'verified'));
ALTER TABLE executive_roles ADD COLUMN verified_at TEXT;
ALTER TABLE executive_roles ADD COLUMN verified_by TEXT;
ALTER TABLE executive_roles ADD COLUMN verification_note TEXT;

CREATE INDEX source_observations_verification_idx
  ON source_observations(verification_status, created_at DESC);
CREATE INDEX covered_institutions_source_status_idx
  ON covered_institutions(covered, official_source_status, short_name);
