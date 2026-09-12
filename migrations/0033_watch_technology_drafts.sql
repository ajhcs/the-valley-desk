-- Review-only inputs. These tables cannot authorize a public Watch projection.
CREATE TABLE technology_dossier_heads (
  subject_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  input_sha256 TEXT,
  checked_at TEXT NOT NULL
);
CREATE TABLE technology_dossier_drafts (
  subject_id TEXT NOT NULL REFERENCES technology_dossier_heads(subject_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  discovered_at TEXT NOT NULL,
  PRIMARY KEY(subject_id, revision)
);
CREATE TABLE technology_artifact_observations (
  subject_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  artifact_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(subject_id, revision, artifact_id),
  FOREIGN KEY(subject_id, revision) REFERENCES technology_dossier_drafts(subject_id, revision)
);
CREATE TABLE technology_development_observations (
  subject_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  development_id TEXT NOT NULL,
  development_type TEXT NOT NULL,
  source_occurred_at TEXT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(subject_id, revision, development_id),
  FOREIGN KEY(subject_id, revision) REFERENCES technology_dossier_drafts(subject_id, revision)
);
CREATE INDEX technology_development_chronology ON technology_development_observations(development_type, source_occurred_at);
CREATE TABLE technology_source_representations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  representation_sha256 TEXT NOT NULL CHECK(length(representation_sha256)=64),
  representation TEXT NOT NULL CHECK(length(CAST(representation AS BLOB))<=1000000),
  checked_at TEXT NOT NULL
);
CREATE TRIGGER technology_source_representation_immutable BEFORE UPDATE ON technology_source_representations
BEGIN SELECT RAISE(ABORT,'technology-source-immutable'); END;
CREATE TRIGGER technology_source_representation_no_delete BEFORE DELETE ON technology_source_representations
BEGIN SELECT RAISE(ABORT,'technology-source-immutable'); END;
CREATE TABLE technology_source_heads (
  subject_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  observation_id TEXT NOT NULL REFERENCES technology_source_representations(id),
  representation_sha256 TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY(subject_id,source_url)
);
CREATE TABLE technology_review_guards (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK(valid=1)
);
