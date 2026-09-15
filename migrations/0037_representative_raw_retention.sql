-- Preserve immutable observations while allowing the complete bounded House XML.
CREATE TABLE representative_roster_observations_v2 (
 id TEXT PRIMARY KEY, source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, raw_sha256 TEXT NOT NULL,
 raw_text TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 CHECK(length(CAST(raw_text AS BLOB))<=1000000), CHECK(length(CAST(payload_json AS BLOB))<=1000000)
);
INSERT INTO representative_roster_observations_v2 SELECT * FROM representative_roster_observations;
DROP TABLE representative_roster_observations;
ALTER TABLE representative_roster_observations_v2 RENAME TO representative_roster_observations;
CREATE TRIGGER representative_observations_immutable BEFORE UPDATE ON representative_roster_observations
 BEGIN SELECT RAISE(ABORT,'representative-immutable'); END;
