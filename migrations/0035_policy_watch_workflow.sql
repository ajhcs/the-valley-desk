CREATE TABLE policy_watch_instruments (
 id TEXT PRIMARY KEY, identity_json TEXT NOT NULL CHECK(json_valid(identity_json)), first_seen_at TEXT NOT NULL
);
CREATE TABLE policy_watch_captures (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 subject_id TEXT NOT NULL REFERENCES policy_watch_instruments(id),
 observation_id TEXT NOT NULL, payload_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 retrieved_at TEXT NOT NULL, source_url TEXT NOT NULL,
 CHECK(length(CAST(payload_json AS BLOB))<=500000)
);
CREATE INDEX policy_watch_captures_subject ON policy_watch_captures(subject_id,sequence DESC);
CREATE INDEX policy_watch_captures_observation ON policy_watch_captures(subject_id,observation_id);
CREATE TABLE policy_watch_action_revisions (
 action_id TEXT NOT NULL, capture_id TEXT NOT NULL REFERENCES policy_watch_captures(id),
 development_id TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(action_id,capture_id)
);
CREATE TABLE policy_watch_version_links (
 capture_id TEXT PRIMARY KEY REFERENCES policy_watch_captures(id),
 version_row_id TEXT NOT NULL REFERENCES policy_versions(id)
);
CREATE TABLE policy_watch_acceptance_guards (
 decision_id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES policy_watch_captures(id),
 valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE policy_watch_capture_scan_guards (
 capture_id TEXT PRIMARY KEY REFERENCES policy_watch_captures(id), valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TRIGGER policy_watch_capture_immutable BEFORE UPDATE ON policy_watch_captures
 BEGIN SELECT RAISE(ABORT,'policy-watch-immutable'); END;
CREATE TRIGGER policy_watch_action_immutable BEFORE UPDATE ON policy_watch_action_revisions
 BEGIN SELECT RAISE(ABORT,'policy-watch-immutable'); END;
