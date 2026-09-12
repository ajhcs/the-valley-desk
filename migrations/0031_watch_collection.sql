-- Collection state is separate from accepted editorial/publication state.
CREATE TABLE watch_dependency_expirations (dependency_key TEXT PRIMARY KEY REFERENCES watch_dependency_heads(dependency_key), valid_until TEXT NOT NULL);
CREATE TABLE watch_collection_acceptance_guards (
  id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES watch_collection_sources(id),
  checked_at TEXT NOT NULL, valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE watch_collection_reviews (
  id TEXT PRIMARY KEY, engineering_owner_id TEXT NOT NULL, editorial_owner_id TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
  qualification_sha256 TEXT NOT NULL CHECK(length(qualification_sha256)=64), accepted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE watch_collection_sources (
  id TEXT PRIMARY KEY, configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64),
  qualification_json TEXT NOT NULL CHECK(json_valid(qualification_json)),
  review_id TEXT NOT NULL REFERENCES watch_collection_reviews(id),
  activation_id TEXT, activated_at TEXT, cadence_seconds INTEGER NOT NULL CHECK(cadence_seconds BETWEEN 60 AND 604800),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  CHECK((activation_id IS NULL)=(activated_at IS NULL))
);
CREATE TABLE watch_collection_state (
  source_id TEXT PRIMARY KEY REFERENCES watch_collection_sources(id), next_due_at TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0), last_checked_at TEXT, last_success_at TEXT,
  last_state TEXT, checkpoint_json TEXT CHECK(checkpoint_json IS NULL OR json_valid(checkpoint_json))
);
CREATE INDEX watch_collection_due ON watch_collection_state(next_due_at,source_id);
CREATE TABLE watch_collection_leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE watch_collection_hosts (host TEXT PRIMARY KEY, next_allowed_at TEXT NOT NULL);
CREATE TABLE watch_raw_representations (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES watch_collection_sources(id), endpoint TEXT NOT NULL,
  representation_sha256 TEXT NOT NULL CHECK(length(representation_sha256)=64), representation BLOB NOT NULL,
  normalized_text TEXT NOT NULL, normalizer_version TEXT NOT NULL, parser_version TEXT NOT NULL,
  configuration_sha256 TEXT NOT NULL, content_type TEXT, etag TEXT, last_modified TEXT,
  first_seen_at TEXT NOT NULL, CHECK(length(representation)<=2000000), UNIQUE(source_id,endpoint,representation_sha256,configuration_sha256)
);
CREATE TABLE watch_raw_observations (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES watch_collection_sources(id),
  representation_id TEXT NOT NULL REFERENCES watch_raw_representations(id), payload_sha256 TEXT NOT NULL,
  observation_json TEXT NOT NULL CHECK(json_valid(observation_json)), first_seen_at TEXT NOT NULL,
  CHECK(length(observation_json)<=64000)
);
CREATE TABLE watch_collection_pages (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES watch_collection_sources(id), snapshot_id TEXT NOT NULL,
  page_key TEXT NOT NULL, representation_id TEXT NOT NULL REFERENCES watch_raw_representations(id),
  page_sha256 TEXT NOT NULL, page_json TEXT NOT NULL CHECK(json_valid(page_json)), persisted_at TEXT NOT NULL, lease_owner TEXT NOT NULL,
  UNIQUE(snapshot_id,page_key)
);
CREATE TABLE watch_collection_runs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES watch_collection_sources(id), started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL, state TEXT NOT NULL, item_count INTEGER NOT NULL CHECK(item_count>=0),
  detail TEXT NOT NULL, checkpoint_advanced INTEGER NOT NULL CHECK(checkpoint_advanced IN (0,1))
);
CREATE TRIGGER watch_raw_representation_immutable BEFORE UPDATE ON watch_raw_representations BEGIN SELECT RAISE(ABORT,'watch-raw-immutable'); END;
CREATE TRIGGER watch_raw_observation_immutable BEFORE UPDATE ON watch_raw_observations BEGIN SELECT RAISE(ABORT,'watch-raw-immutable'); END;
CREATE TRIGGER watch_collection_page_immutable BEFORE UPDATE ON watch_collection_pages BEGIN SELECT RAISE(ABORT,'watch-page-immutable'); END;
CREATE TRIGGER watch_collection_page_fenced BEFORE INSERT ON watch_collection_pages
WHEN NOT EXISTS (SELECT 1 FROM watch_collection_leases WHERE id='watch-collector' AND owner=NEW.lease_owner AND expires_at>NEW.persisted_at)
BEGIN SELECT RAISE(ABORT,'watch-collection-lease-lost'); END;
CREATE TRIGGER watch_raw_representation_no_delete BEFORE DELETE ON watch_raw_representations BEGIN SELECT RAISE(ABORT,'watch-raw-immutable'); END;
CREATE TRIGGER watch_raw_observation_no_delete BEFORE DELETE ON watch_raw_observations BEGIN SELECT RAISE(ABORT,'watch-raw-immutable'); END;
CREATE TRIGGER watch_collection_page_no_delete BEFORE DELETE ON watch_collection_pages BEGIN SELECT RAISE(ABORT,'watch-page-immutable'); END;
CREATE TRIGGER watch_collection_review_immutable BEFORE UPDATE ON watch_collection_reviews
WHEN NEW.id<>OLD.id OR NEW.engineering_owner_id<>OLD.engineering_owner_id OR NEW.editorial_owner_id<>OLD.editorial_owner_id
  OR NEW.evidence_sha256<>OLD.evidence_sha256 OR NEW.qualification_sha256<>OLD.qualification_sha256
  OR NEW.accepted_at<>OLD.accepted_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at<OLD.accepted_at
BEGIN SELECT RAISE(ABORT,'watch-source-review-immutable'); END;
