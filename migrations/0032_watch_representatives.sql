CREATE TABLE representative_roster_observations (
 id TEXT PRIMARY KEY, source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, raw_sha256 TEXT NOT NULL,
 raw_text TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 CHECK(length(CAST(raw_text AS BLOB))<=500000), CHECK(length(CAST(payload_json AS BLOB))<=1000000)
);
CREATE TRIGGER representative_observations_immutable BEFORE UPDATE ON representative_roster_observations
 BEGIN SELECT RAISE(ABORT,'representative-immutable'); END;
CREATE TABLE representative_drafts (
 id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), payload_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL, CHECK(length(CAST(payload_json AS BLOB))<=2000000)
);
CREATE TABLE representative_decisions (
 draft_id TEXT PRIMARY KEY REFERENCES representative_drafts(id), decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
 reviewer_id TEXT NOT NULL, decided_at TEXT NOT NULL, snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json))
);
CREATE TABLE representative_heads (
 scope_key TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), draft_id TEXT NOT NULL UNIQUE REFERENCES representative_decisions(draft_id)
);
CREATE TRIGGER representative_acceptance_cas BEFORE INSERT ON representative_decisions
 WHEN NEW.decision='accepted' BEGIN
 SELECT CASE WHEN (SELECT expected_revision FROM representative_drafts WHERE id=NEW.draft_id) !=
 COALESCE((SELECT revision FROM representative_heads WHERE scope_key=(SELECT scope_key FROM representative_drafts WHERE id=NEW.draft_id)),0)
 THEN RAISE(ABORT,'representative-stale-review') END;
END;
CREATE TRIGGER representative_drafts_immutable BEFORE UPDATE ON representative_drafts BEGIN SELECT RAISE(ABORT,'representative-immutable'); END;
CREATE TRIGGER representative_decisions_immutable BEFORE UPDATE ON representative_decisions BEGIN SELECT RAISE(ABORT,'representative-immutable'); END;
