-- Delivery assertions are immutable; mutable heads can invalidate but are not approvals.
CREATE TABLE watch_dependency_records (
  immutable_record_id TEXT PRIMARY KEY NOT NULL,
  dependency_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('accepted-fact','evidence','source-permission','verification-rule',
    'policy-interpretation','policy-definition','policy-exception','policy-reference','policy-amendment',
    'artifact','artifact-license','local-relationship','regional-current','regional-historical')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  digest TEXT CHECK(digest IS NULL OR (length(digest)=64 AND digest NOT GLOB '*[^a-f0-9]*')),
  changed_at TEXT NOT NULL,
  UNIQUE(dependency_key,revision)
);
CREATE TRIGGER watch_dependency_record_immutable BEFORE UPDATE ON watch_dependency_records
BEGIN SELECT RAISE(ABORT,'watch-dependency-record-immutable'); END;
CREATE TRIGGER watch_dependency_record_no_delete BEFORE DELETE ON watch_dependency_records
BEGIN SELECT RAISE(ABORT,'watch-dependency-record-immutable'); END;
CREATE TABLE watch_dependency_heads (
  dependency_key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  digest TEXT,
  immutable_record_id TEXT NOT NULL REFERENCES watch_dependency_records(immutable_record_id),
  changed_at TEXT NOT NULL
);
CREATE TRIGGER watch_dependency_head_insert BEFORE INSERT ON watch_dependency_heads
WHEN NOT EXISTS (SELECT 1 FROM watch_dependency_records r WHERE r.immutable_record_id=NEW.immutable_record_id
  AND r.dependency_key=NEW.dependency_key AND r.kind=NEW.kind AND r.revision=NEW.revision
  AND r.digest IS NEW.digest AND r.changed_at=NEW.changed_at)
BEGIN SELECT RAISE(ABORT,'watch-dependency-record-required'); END;
CREATE TRIGGER watch_dependency_head_update BEFORE UPDATE ON watch_dependency_heads
WHEN NEW.dependency_key<>OLD.dependency_key OR NEW.kind<>OLD.kind OR NEW.revision<=OLD.revision OR NEW.changed_at<OLD.changed_at
  OR NOT EXISTS (SELECT 1 FROM watch_dependency_records r WHERE r.immutable_record_id=NEW.immutable_record_id
    AND r.dependency_key=NEW.dependency_key AND r.kind=NEW.kind AND r.revision=NEW.revision
    AND r.digest IS NEW.digest AND r.changed_at=NEW.changed_at)
BEGIN SELECT RAISE(ABORT,'watch-dependency-revision-conflict'); END;
CREATE TRIGGER watch_dependency_head_no_delete BEFORE DELETE ON watch_dependency_heads
BEGIN SELECT RAISE(ABORT,'watch-dependency-retraction-required'); END;

CREATE TABLE watch_delivery_manifests (
  decision_id TEXT PRIMARY KEY NOT NULL REFERENCES watch_reviewed_projections(id),
  subject_id TEXT NOT NULL REFERENCES watch_subjects(id),
  kind TEXT NOT NULL CHECK(kind IN ('policy','technology')),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  gate_version TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=512000),
  CHECK(json_extract(manifest_json,'$.version')='watch-delivery-1'),
  CHECK(json_extract(manifest_json,'$.subjectId')=subject_id),
  CHECK(json_extract(manifest_json,'$.kind')=kind),
  CHECK(json_extract(manifest_json,'$.payloadSha256')=payload_sha256),
  CHECK(json_extract(manifest_json,'$.gateVersion')=gate_version),
  CHECK(json_array_length(manifest_json,'$.groups') BETWEEN 2 AND 100)
);
CREATE TRIGGER watch_delivery_manifest_immutable BEFORE UPDATE ON watch_delivery_manifests
BEGIN SELECT RAISE(ABORT,'watch-delivery-manifest-immutable'); END;
CREATE TRIGGER watch_delivery_manifest_no_delete BEFORE DELETE ON watch_delivery_manifests
BEGIN SELECT RAISE(ABORT,'watch-delivery-manifest-immutable'); END;
CREATE TABLE watch_delivery_application_clocks (
  decision_id TEXT PRIMARY KEY NOT NULL REFERENCES watch_delivery_manifests(decision_id),
  applied_at TEXT NOT NULL,
  eastern_day TEXT NOT NULL CHECK(length(eastern_day)=10)
);
CREATE TRIGGER watch_delivery_clock_immutable BEFORE UPDATE ON watch_delivery_application_clocks
BEGIN SELECT RAISE(ABORT,'watch-delivery-clock-immutable'); END;
CREATE TRIGGER watch_delivery_clock_no_delete BEFORE DELETE ON watch_delivery_application_clocks
BEGIN SELECT RAISE(ABORT,'watch-delivery-clock-immutable'); END;

-- Legacy reviewed rows have no manifest and cannot pass this additive gate.
CREATE TRIGGER watch_delivery_acceptance_current BEFORE INSERT ON watch_publication_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM watch_delivery_manifests m JOIN watch_reviewed_projections r ON r.id=m.decision_id
    JOIN watch_delivery_application_clocks c ON c.decision_id=m.decision_id
  WHERE m.decision_id=NEW.decision_id AND m.subject_id=r.subject_id AND m.payload_sha256=r.payload_sha256
    AND m.kind=json_extract(r.payload_json,'$.kind') AND m.gate_version=r.gate_version
    AND json_extract(m.manifest_json,'$.inputRevision')=r.input_revision
    AND json_extract(m.manifest_json,'$.acceptedAt')<=NEW.applied_at AND c.applied_at=NEW.applied_at
    AND EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
      WHERE json_extract(g.value,'$.field')='title' AND json_extract(g.value,'$.groupType')='required')
    AND EXISTS (SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
      WHERE json_extract(g.value,'$.field')=CASE m.kind WHEN 'policy' THEN 'identity' ELSE 'resource-type' END
        AND json_extract(g.value,'$.groupType')='required')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(m.manifest_json,'$.groups') g
      WHERE NOT (json_array_length(g.value,'$.dependencies') BETWEEN 1 AND 400)
        OR EXISTS (SELECT 1 FROM json_each(g.value,'$.dependencies') d LEFT JOIN watch_dependency_heads h
          ON h.dependency_key=json_extract(d.value,'$.key')
          WHERE h.dependency_key IS NULL OR h.kind<>json_extract(d.value,'$.kind') OR h.digest IS NULL
            OR h.digest<>json_extract(d.value,'$.expectedDigest') OR h.changed_at>NEW.applied_at)
        OR (json_extract(g.value,'$.groupType')='local' AND (
          json_extract(g.value,'$.local.checkedAt')>NEW.applied_at
          OR (json_extract(g.value,'$.local.validFrom') IS NOT NULL AND json_extract(g.value,'$.local.validFrom')>c.eastern_day)
          OR (json_extract(g.value,'$.local.temporalStatus')='current' AND (
            json_extract(g.value,'$.local.validThrough') IS NULL OR NEW.applied_at>=json_extract(g.value,'$.local.validThrough')
            OR json_extract(g.value,'$.regionalTerm.validFrom') IS NULL OR json_extract(g.value,'$.regionalTerm.validFrom')>c.eastern_day
            OR (json_extract(g.value,'$.regionalTerm.validTo') IS NOT NULL AND c.eastern_day>=json_extract(g.value,'$.regionalTerm.validTo'))))
        ))
    )
)
BEGIN SELECT RAISE(ABORT,'watch-delivery-stale-acceptance'); END;
