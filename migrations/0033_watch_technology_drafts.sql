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
