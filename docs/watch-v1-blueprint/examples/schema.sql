-- Pedagogical SQLite laboratory, not a production migration or full Watch schema.
PRAGMA foreign_keys = ON;

CREATE TABLE example_policy_keys (
  id TEXT PRIMARY KEY NOT NULL,
  jurisdiction_id TEXT NOT NULL CHECK(length(jurisdiction_id) > 0),
  body_id TEXT NOT NULL CHECK(length(body_id) > 0),
  session_key TEXT NOT NULL CHECK(length(session_key) > 0),
  instrument_type TEXT NOT NULL CHECK(length(instrument_type) > 0),
  native_id TEXT NOT NULL CHECK(length(native_id) > 0),
  UNIQUE(jurisdiction_id, body_id, session_key, instrument_type, native_id)
);

CREATE TABLE example_read_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  generation INTEGER NOT NULL CHECK(generation >= 0)
);
INSERT INTO example_read_state(singleton, generation) VALUES(1, 0);

CREATE TABLE example_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  expected_generation INTEGER NOT NULL
);

CREATE TRIGGER example_acceptance_conflict BEFORE INSERT ON example_decisions
WHEN NEW.expected_generation <> (SELECT generation FROM example_read_state WHERE singleton = 1)
BEGIN
  SELECT RAISE(ABORT, 'stale-acceptance');
END;

CREATE TABLE example_public_revisions (
  subject_id TEXT NOT NULL,
  valid_from INTEGER NOT NULL CHECK(valid_from > 0),
  valid_to INTEGER CHECK(valid_to IS NULL OR valid_to > valid_from),
  sort_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  decision_id TEXT NOT NULL REFERENCES example_decisions(id),
  PRIMARY KEY(subject_id, valid_from)
);
CREATE UNIQUE INDEX example_one_current_revision
  ON example_public_revisions(subject_id) WHERE valid_to IS NULL;
CREATE INDEX example_listing
  ON example_public_revisions(sort_key DESC, subject_id DESC, valid_from, valid_to);

CREATE TABLE example_delivery_tombstones (
  subject_id TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL
);
