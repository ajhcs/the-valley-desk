CREATE TABLE watch_editorial_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL REFERENCES watch_subjects(id),
  subject_revision INTEGER NOT NULL CHECK(subject_revision > 0),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB))<=500000),
  created_at TEXT NOT NULL,
  UNIQUE(subject_id,subject_revision)
);
CREATE TRIGGER watch_editorial_draft_immutable BEFORE UPDATE ON watch_editorial_drafts
BEGIN SELECT RAISE(ABORT,'watch-editorial-draft-immutable'); END;
CREATE TRIGGER watch_editorial_draft_retained BEFORE DELETE ON watch_editorial_drafts
BEGIN SELECT RAISE(ABORT,'watch-editorial-draft-immutable'); END;

CREATE TABLE watch_editorial_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL UNIQUE REFERENCES watch_editorial_drafts(id),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
  action TEXT NOT NULL CHECK(action IN ('accepted','rejected')),
  reviewer_id TEXT NOT NULL,
  reviewer_principal TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  acceptance_json TEXT CHECK(acceptance_json IS NULL OR json_valid(acceptance_json)),
  CHECK((action='accepted')=(acceptance_json IS NOT NULL))
);
CREATE TRIGGER watch_editorial_decision_immutable BEFORE UPDATE ON watch_editorial_decisions
BEGIN SELECT RAISE(ABORT,'watch-editorial-decision-immutable'); END;
CREATE TRIGGER watch_editorial_decision_retained BEFORE DELETE ON watch_editorial_decisions
BEGIN SELECT RAISE(ABORT,'watch-editorial-decision-immutable'); END;
CREATE TRIGGER watch_editorial_decision_current BEFORE INSERT ON watch_editorial_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM watch_editorial_drafts d JOIN watch_subjects s ON s.id=d.subject_id
  WHERE d.id=NEW.draft_id AND d.input_sha256=NEW.input_sha256
    AND s.input_revision=d.subject_revision AND s.input_sha256=d.input_sha256
    AND NOT EXISTS(SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id=s.id)
)
BEGIN SELECT RAISE(ABORT,'watch-editorial-stale-draft'); END;

CREATE TABLE watch_editorial_facts (
  decision_id TEXT NOT NULL REFERENCES watch_editorial_decisions(id),
  fact_id TEXT NOT NULL,
  digest TEXT NOT NULL CHECK(length(digest)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(decision_id,fact_id)
);
CREATE TRIGGER watch_editorial_fact_immutable BEFORE UPDATE ON watch_editorial_facts
BEGIN SELECT RAISE(ABORT,'watch-editorial-fact-immutable'); END;
CREATE TRIGGER watch_editorial_fact_retained BEFORE DELETE ON watch_editorial_facts
BEGIN SELECT RAISE(ABORT,'watch-editorial-fact-immutable'); END;

CREATE TABLE watch_editorial_dependency_guards (
  decision_id TEXT NOT NULL REFERENCES watch_editorial_decisions(id),
  dependency_key TEXT NOT NULL REFERENCES watch_dependency_heads(dependency_key),
  checked_at TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1),
  PRIMARY KEY(decision_id,dependency_key)
);

CREATE TRIGGER watch_delivery_dependency_expiry BEFORE INSERT ON watch_publication_decisions
WHEN EXISTS (
  SELECT 1 FROM watch_delivery_manifests m,json_each(m.manifest_json,'$.groups') g,
    json_each(g.value,'$.dependencies') d
    JOIN watch_dependency_expirations e ON e.dependency_key=json_extract(d.value,'$.key')
  WHERE m.decision_id=NEW.decision_id AND e.valid_until<=NEW.applied_at
)
BEGIN SELECT RAISE(ABORT,'watch-delivery-stale-acceptance'); END;
