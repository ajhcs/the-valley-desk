-- Accepted Watch projections are separate from raw discoveries and v1 content.
CREATE TABLE watch_subjects (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 240),
  kind TEXT NOT NULL CHECK(kind IN ('policy', 'technology')),
  external_key TEXT NOT NULL UNIQUE CHECK(length(external_key) BETWEEN 1 AND 1000),
  slug TEXT NOT NULL CHECK(length(slug) BETWEEN 1 AND 100),
  input_revision INTEGER NOT NULL CHECK(input_revision > 0),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
  public_revision INTEGER NOT NULL DEFAULT 0 CHECK(public_revision >= 0),
  first_seen_at TEXT NOT NULL,
  UNIQUE(kind, slug)
);

CREATE TRIGGER watch_subject_identity_immutable BEFORE UPDATE ON watch_subjects
WHEN NEW.id <> OLD.id OR NEW.kind <> OLD.kind OR NEW.external_key <> OLD.external_key
  OR NEW.slug <> OLD.slug OR NEW.first_seen_at <> OLD.first_seen_at
  OR NEW.input_revision < OLD.input_revision OR NEW.public_revision < OLD.public_revision
  OR (NEW.input_sha256 <> OLD.input_sha256 AND NEW.input_revision <= OLD.input_revision)
BEGIN SELECT RAISE(ABORT, 'watch-subject-identity-conflict'); END;

-- Written only by server-side evidence review. There is no public receipt intake.
CREATE TABLE watch_reviewed_projections (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 240),
  subject_id TEXT NOT NULL REFERENCES watch_subjects(id),
  input_revision INTEGER NOT NULL CHECK(input_revision > 0),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
  expected_public_revision INTEGER NOT NULL CHECK(expected_public_revision >= 0),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB)) <= 200000),
  reviewer_id TEXT NOT NULL CHECK(length(reviewer_id) BETWEEN 1 AND 240),
  gate_version TEXT NOT NULL CHECK(length(gate_version) BETWEEN 1 AND 240),
  reviewed_at TEXT NOT NULL,
  CHECK(json_extract(payload_json, '$.id') = subject_id)
);
CREATE TRIGGER watch_review_immutable BEFORE UPDATE ON watch_reviewed_projections
BEGIN SELECT RAISE(ABORT, 'watch-review-immutable'); END;
CREATE TRIGGER watch_review_no_delete BEFORE DELETE ON watch_reviewed_projections
BEGIN SELECT RAISE(ABORT, 'watch-review-immutable'); END;

CREATE TABLE watch_read_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  minimum_generation INTEGER NOT NULL CHECK(minimum_generation >= 0 AND minimum_generation <= generation)
);
INSERT INTO watch_read_state VALUES(1, 0, 0);
CREATE TABLE watch_generations (
  generation INTEGER PRIMARY KEY CHECK(generation >= 0),
  created_at TEXT
);
INSERT INTO watch_generations VALUES(0, NULL);

CREATE TABLE watch_publication_decisions (
  decision_id TEXT PRIMARY KEY NOT NULL REFERENCES watch_reviewed_projections(id),
  generation INTEGER NOT NULL UNIQUE CHECK(generation > 0),
  applied_at TEXT NOT NULL
);
CREATE TABLE watch_delivery_tombstones (
  subject_id TEXT PRIMARY KEY NOT NULL REFERENCES watch_subjects(id),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  reviewer_id TEXT NOT NULL CHECK(length(reviewer_id) BETWEEN 1 AND 240),
  withdrawn_at TEXT NOT NULL
);

CREATE TRIGGER watch_acceptance_current BEFORE INSERT ON watch_publication_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM watch_reviewed_projections r JOIN watch_subjects s ON s.id = r.subject_id
  WHERE r.id = NEW.decision_id AND r.input_revision = s.input_revision
    AND r.input_sha256 = s.input_sha256 AND r.expected_public_revision = s.public_revision
    AND json_extract(r.payload_json, '$.kind') = s.kind
    AND json_extract(r.payload_json, '$.slug') = s.slug
    AND NOT EXISTS (SELECT 1 FROM watch_delivery_tombstones t WHERE t.subject_id = s.id)
)
BEGIN SELECT RAISE(ABORT, 'watch-stale-acceptance'); END;

CREATE TABLE watch_public_revisions (
  subject_id TEXT NOT NULL REFERENCES watch_subjects(id),
  valid_from INTEGER NOT NULL CHECK(valid_from > 0),
  valid_to INTEGER CHECK(valid_to IS NULL OR valid_to > valid_from),
  kind TEXT NOT NULL CHECK(kind IN ('policy', 'technology')),
  title_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB)) <= 200000),
  decision_id TEXT NOT NULL UNIQUE REFERENCES watch_publication_decisions(decision_id),
  PRIMARY KEY(subject_id, valid_from),
  CHECK(json_extract(payload_json, '$.id') = subject_id),
  CHECK(json_extract(payload_json, '$.kind') = kind)
);
CREATE UNIQUE INDEX watch_one_current_revision ON watch_public_revisions(subject_id) WHERE valid_to IS NULL;
CREATE INDEX watch_directory_page ON watch_public_revisions(kind, title_key, subject_id, valid_from, valid_to);
CREATE INDEX watch_closed_revision_retention ON watch_public_revisions(valid_to) WHERE valid_to IS NOT NULL;
CREATE TRIGGER watch_public_revision_immutable BEFORE UPDATE ON watch_public_revisions
WHEN NEW.subject_id <> OLD.subject_id OR NEW.valid_from <> OLD.valid_from OR NEW.kind <> OLD.kind
  OR NEW.title_key <> OLD.title_key OR NEW.payload_sha256 <> OLD.payload_sha256
  OR NEW.payload_json <> OLD.payload_json OR NEW.decision_id <> OLD.decision_id
  OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL
BEGIN SELECT RAISE(ABORT, 'watch-public-revision-immutable'); END;
