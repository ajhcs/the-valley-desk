-- Discovery-owned additive catalog. No legacy table or geography meaning changes.
-- Metadata/revision anchors are immutable; no raw source content is stored here.
-- Future WP05 rights removal must use a separately removable content store and an
-- audited migration if metadata itself must be redacted. Do not disable triggers.
CREATE TABLE discovery_catalog_entities (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('person','organization','account','project','artifact')),
 artifact_kind TEXT CHECK(artifact_kind IN ('repository','publication','discussion')),
 CHECK((kind='artifact')=(artifact_kind IS NOT NULL)), UNIQUE(id,kind)
);
CREATE TABLE discovery_catalog_entity_revisions (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(id,revision), UNIQUE(id,revision,kind),
 FOREIGN KEY(id,kind) REFERENCES discovery_catalog_entities(id,kind),
 CHECK(json_extract(payload_json,'$.id') IS id AND json_extract(payload_json,'$.revision') IS revision AND json_extract(payload_json,'$.kind') IS kind)
);
CREATE TRIGGER discovery_entity_identity_conflict BEFORE INSERT ON discovery_catalog_entities BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_entities WHERE id=NEW.id AND (kind<>NEW.kind OR artifact_kind IS NOT NEW.artifact_kind)) THEN RAISE(ABORT,'discovery-entity-kind-conflict') END;
END;
CREATE TRIGGER discovery_entity_revision_shape BEFORE INSERT ON discovery_catalog_entity_revisions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_entity_revisions WHERE id=NEW.id AND revision=NEW.revision AND payload_json<>NEW.payload_json) THEN RAISE(ABORT,'discovery-immutable') END;
 SELECT CASE WHEN (SELECT artifact_kind FROM discovery_catalog_entities WHERE id=NEW.id) IS NOT json_extract(NEW.payload_json,'$.artifactKind') THEN RAISE(ABORT,'discovery-incompatible-artifact-kind') END;
 SELECT CASE WHEN NEW.kind='account' AND EXISTS(SELECT 1 FROM discovery_catalog_entity_revisions r WHERE r.id=NEW.id AND json_extract(r.payload_json,'$.identity')<>json_extract(NEW.payload_json,'$.identity')) THEN RAISE(ABORT,'discovery-account-identity-conflict') END;
END;
CREATE TABLE discovery_catalog_entity_heads (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
 FOREIGN KEY(id,revision) REFERENCES discovery_catalog_entity_revisions(id,revision)
);
CREATE TABLE discovery_catalog_provider_identities (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('github','pubmed','crossref','arxiv','forum','institutional')),
 installation TEXT NOT NULL, kind TEXT NOT NULL, native_id TEXT NOT NULL, subject_id TEXT NOT NULL,
 UNIQUE(provider,installation,kind,native_id), FOREIGN KEY(subject_id,kind) REFERENCES discovery_catalog_entities(id,kind)
);
CREATE TRIGGER discovery_identity_conflict BEFORE INSERT ON discovery_catalog_provider_identities BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_provider_identities WHERE (id=NEW.id OR (provider=NEW.provider AND installation=NEW.installation AND kind=NEW.kind AND native_id=NEW.native_id)) AND (id<>NEW.id OR provider<>NEW.provider OR installation<>NEW.installation OR kind<>NEW.kind OR native_id<>NEW.native_id OR subject_id<>NEW.subject_id)) THEN RAISE(ABORT,'discovery-identity-conflict') END;
 SELECT CASE WHEN NEW.kind='account' AND NOT EXISTS(SELECT 1 FROM discovery_catalog_entity_revisions r WHERE r.id=NEW.subject_id AND json_extract(r.payload_json,'$.identity.provider')=NEW.provider AND json_extract(r.payload_json,'$.identity.installation')=NEW.installation AND json_extract(r.payload_json,'$.identity.kind')=NEW.kind AND json_extract(r.payload_json,'$.identity.nativeId')=NEW.native_id) THEN RAISE(ABORT,'discovery-account-identity-conflict') END;
END;
CREATE TABLE discovery_catalog_observation_families (
 id TEXT PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES discovery_catalog_provider_identities(id), UNIQUE(id,identity_id)
);
CREATE TABLE discovery_catalog_observation_revisions (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 identity_id TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(id,revision), FOREIGN KEY(id,identity_id) REFERENCES discovery_catalog_observation_families(id,identity_id),
 CHECK(json_extract(payload_json,'$.id') IS id AND json_extract(payload_json,'$.revision') IS revision)
);
CREATE TABLE discovery_catalog_observation_heads (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
 FOREIGN KEY(id,revision) REFERENCES discovery_catalog_observation_revisions(id,revision)
);
CREATE TRIGGER discovery_observation_identity BEFORE INSERT ON discovery_catalog_observation_revisions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_observation_revisions WHERE id=NEW.id AND revision=NEW.revision AND (identity_id<>NEW.identity_id OR payload_json<>NEW.payload_json)) THEN RAISE(ABORT,'discovery-immutable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_provider_identities p WHERE p.id=NEW.identity_id AND p.provider=json_extract(NEW.payload_json,'$.identity.provider') AND p.installation=json_extract(NEW.payload_json,'$.identity.installation') AND p.kind=json_extract(NEW.payload_json,'$.identity.kind') AND p.native_id=json_extract(NEW.payload_json,'$.identity.nativeId')) THEN RAISE(ABORT,'discovery-observation-identity-conflict') END;
END;
CREATE TRIGGER discovery_observation_family_conflict BEFORE INSERT ON discovery_catalog_observation_families BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_observation_families WHERE id=NEW.id AND identity_id<>NEW.identity_id) THEN RAISE(ABORT,'discovery-observation-identity-conflict') END;
END;
CREATE TABLE discovery_catalog_evidence_refs (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 PRIMARY KEY(id,revision)
);
CREATE TABLE discovery_catalog_decision_refs (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(id,revision),
 CHECK(json_type(payload_json,'$.evidence') IS 'array' AND json_array_length(payload_json,'$.evidence') BETWEEN 1 AND 128),
 CHECK(json_extract(payload_json,'$.id') IS id AND json_extract(payload_json,'$.revision') IS revision)
);
CREATE TRIGGER discovery_decision_conflict BEFORE INSERT ON discovery_catalog_decision_refs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_decision_refs WHERE id=NEW.id AND revision=NEW.revision AND payload_json<>NEW.payload_json) THEN RAISE(ABORT,'discovery-decision-conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e WHERE NOT EXISTS(SELECT 1 FROM discovery_catalog_evidence_refs r WHERE r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision'))) THEN RAISE(ABORT,'discovery-missing-evidence') END;
END;
CREATE TABLE discovery_catalog_relation_families (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('attribution','account-ownership','affiliation','project-membership','artifact-version','equivalence')), UNIQUE(id,kind)
);
CREATE TABLE discovery_catalog_relation_revisions (
 id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991), kind TEXT NOT NULL,
 from_id TEXT NOT NULL, from_revision INTEGER NOT NULL, from_kind TEXT NOT NULL,
 to_id TEXT NOT NULL, to_revision INTEGER NOT NULL, to_kind TEXT NOT NULL,
 decision_id TEXT NOT NULL, decision_revision INTEGER NOT NULL,
 county TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(id,revision), FOREIGN KEY(id,kind) REFERENCES discovery_catalog_relation_families(id,kind),
 FOREIGN KEY(from_id,from_revision,from_kind) REFERENCES discovery_catalog_entity_revisions(id,revision,kind),
 FOREIGN KEY(to_id,to_revision,to_kind) REFERENCES discovery_catalog_entity_revisions(id,revision,kind),
 FOREIGN KEY(decision_id,decision_revision) REFERENCES discovery_catalog_decision_refs(id,revision),
 CHECK(from_id<>to_id),
 CHECK((kind='attribution' AND from_kind IN ('person','organization','account') AND to_kind IN ('artifact','project'))
 OR (kind='account-ownership' AND from_kind IN ('person','organization') AND to_kind='account')
 OR (kind='affiliation' AND from_kind='person' AND to_kind='organization')
 OR (kind='project-membership' AND from_kind='artifact' AND to_kind='project')
 OR (kind='artifact-version' AND from_kind='artifact' AND to_kind='artifact')
 OR (kind='equivalence' AND from_kind=to_kind)),
 CHECK(json_extract(payload_json,'$.id') IS id AND json_extract(payload_json,'$.revision') IS revision AND json_extract(payload_json,'$.kind') IS kind),
 CHECK(json_extract(payload_json,'$.from.id') IS from_id AND json_extract(payload_json,'$.from.revision') IS from_revision AND json_extract(payload_json,'$.from.kind') IS from_kind),
 CHECK(json_extract(payload_json,'$.to.id') IS to_id AND json_extract(payload_json,'$.to.revision') IS to_revision AND json_extract(payload_json,'$.to.kind') IS to_kind),
 CHECK(json_extract(payload_json,'$.decision.id') IS decision_id AND json_extract(payload_json,'$.decision.revision') IS decision_revision),
 CHECK(county IS json_extract(payload_json,'$.county')),
 CHECK(json_type(payload_json,'$.evidence') IS 'array' AND json_array_length(payload_json,'$.evidence') BETWEEN 1 AND 128)
);
CREATE TRIGGER discovery_relation_authority BEFORE INSERT ON discovery_catalog_relation_revisions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_relation_revisions WHERE id=NEW.id AND revision=NEW.revision AND payload_json<>NEW.payload_json) THEN RAISE(ABORT,'discovery-immutable') END;
 SELECT CASE WHEN (NEW.from_kind='artifact' AND json_extract(NEW.payload_json,'$.from.artifactKind') IS NOT (SELECT artifact_kind FROM discovery_catalog_entities WHERE id=NEW.from_id)) OR (NEW.to_kind='artifact' AND json_extract(NEW.payload_json,'$.to.artifactKind') IS NOT (SELECT artifact_kind FROM discovery_catalog_entities WHERE id=NEW.to_id)) THEN RAISE(ABORT,'discovery-endpoint-artifact-kind') END;
 SELECT CASE WHEN NEW.kind IN ('artifact-version','equivalence') AND NEW.from_kind='artifact' AND NEW.to_kind='artifact' AND (SELECT artifact_kind FROM discovery_catalog_entities WHERE id=NEW.from_id) IS NOT (SELECT artifact_kind FROM discovery_catalog_entities WHERE id=NEW.to_id) THEN RAISE(ABORT,'discovery-incompatible-artifact-endpoints') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_decision_refs d WHERE d.id=NEW.decision_id AND d.revision=NEW.decision_revision AND json_extract(d.payload_json,'$.decision')='accepted' AND json_extract(d.payload_json,'$.target.kind')='relationship' AND json_extract(d.payload_json,'$.target.id')=NEW.id AND json_extract(d.payload_json,'$.target.revision')=NEW.revision) THEN RAISE(ABORT,'discovery-unaccepted-relationship') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e WHERE NOT EXISTS(SELECT 1 FROM discovery_catalog_evidence_refs r WHERE r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision'))) THEN RAISE(ABORT,'discovery-missing-evidence') END;
END;
CREATE TRIGGER discovery_relation_family_conflict BEFORE INSERT ON discovery_catalog_relation_families BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_relation_families WHERE id=NEW.id AND kind<>NEW.kind) THEN RAISE(ABORT,'discovery-relation-kind-conflict') END;
END;
CREATE TABLE discovery_catalog_relation_heads (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
 FOREIGN KEY(id,revision) REFERENCES discovery_catalog_relation_revisions(id,revision)
);
CREATE TABLE discovery_catalog_aliases (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_kind TEXT NOT NULL, value TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 FOREIGN KEY(subject_id,subject_kind) REFERENCES discovery_catalog_entities(id,kind),
 CHECK(json_extract(payload_json,'$.id') IS id AND json_extract(payload_json,'$.subject.id') IS subject_id AND json_extract(payload_json,'$.subject.kind') IS subject_kind AND json_extract(payload_json,'$.value') IS value),
 CHECK(json_type(payload_json,'$.evidence') IS 'array' AND json_array_length(payload_json,'$.evidence') BETWEEN 1 AND 128)
);
CREATE INDEX discovery_catalog_alias_lookup ON discovery_catalog_aliases(value);
CREATE TRIGGER discovery_alias_conflict BEFORE INSERT ON discovery_catalog_aliases BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_aliases WHERE id=NEW.id AND payload_json<>NEW.payload_json) THEN RAISE(ABORT,'discovery-alias-conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e WHERE NOT EXISTS(SELECT 1 FROM discovery_catalog_evidence_refs r WHERE r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision'))) THEN RAISE(ABORT,'discovery-missing-evidence') END;
END;
CREATE TABLE discovery_catalog_write_guards (
 operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
 target_type TEXT NOT NULL CHECK(target_type IN ('entity','observation','relation')),
 target_id TEXT NOT NULL, expected_revision INTEGER, revision INTEGER NOT NULL,
 CHECK(typeof(revision)='integer' AND revision>0 AND revision<=9007199254740991),
 CHECK((expected_revision IS NULL AND revision=1) OR (typeof(expected_revision)='integer' AND expected_revision>0 AND revision=expected_revision+1))
);
CREATE TABLE discovery_catalog_operations (
 operation_id TEXT PRIMARY KEY REFERENCES discovery_catalog_write_guards(operation_id),
 request_hash TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, revision INTEGER NOT NULL
);
CREATE VIEW discovery_catalog_all_heads AS
 SELECT 'entity' AS target_type,id,revision FROM discovery_catalog_entity_heads UNION ALL
 SELECT 'observation',id,revision FROM discovery_catalog_observation_heads UNION ALL
 SELECT 'relation',id,revision FROM discovery_catalog_relation_heads;
CREATE TRIGGER discovery_catalog_guard BEFORE INSERT ON discovery_catalog_write_guards BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_write_guards WHERE operation_id=NEW.operation_id AND (request_hash<>NEW.request_hash OR target_type<>NEW.target_type OR target_id<>NEW.target_id OR revision<>NEW.revision OR expected_revision IS NOT NEW.expected_revision)) THEN RAISE(ABORT,'discovery-operation-conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_operations WHERE operation_id=NEW.operation_id) AND (SELECT revision FROM discovery_catalog_all_heads WHERE target_type=NEW.target_type AND id=NEW.target_id) IS NOT NEW.expected_revision THEN RAISE(ABORT,'discovery-stale-revision') END;
END;
CREATE TRIGGER discovery_catalog_operation_final BEFORE INSERT ON discovery_catalog_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g JOIN discovery_catalog_all_heads h ON h.target_type=g.target_type AND h.id=g.target_id AND h.revision=g.revision WHERE g.operation_id=NEW.operation_id AND g.request_hash=NEW.request_hash AND g.target_type=NEW.target_type AND g.target_id=NEW.target_id AND g.revision=NEW.revision) THEN RAISE(ABORT,'discovery-incomplete-write') END;
END;
-- Reservations are positive revision anchors only. No row here grants publication.
CREATE TABLE discovery_publication_reservations (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_kind TEXT NOT NULL CHECK(subject_kind IN ('person','organization','project','artifact')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision=1), generation INTEGER NOT NULL DEFAULT 0 CHECK(generation=0),
 FOREIGN KEY(subject_id,subject_kind) REFERENCES discovery_catalog_entities(id,kind)
);
CREATE TRIGGER discovery_reservation_conflict BEFORE INSERT ON discovery_publication_reservations BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_publication_reservations WHERE id=NEW.id AND (subject_id<>NEW.subject_id OR subject_kind<>NEW.subject_kind OR revision<>NEW.revision OR generation<>NEW.generation)) THEN RAISE(ABORT,'discovery-reservation-conflict') END;
END;
CREATE INDEX discovery_catalog_observations_identity ON discovery_catalog_observation_revisions(identity_id,revision);
CREATE INDEX discovery_catalog_relations_from ON discovery_catalog_relation_revisions(from_id,from_revision);
CREATE INDEX discovery_catalog_relations_to ON discovery_catalog_relation_revisions(to_id,to_revision);
CREATE INDEX discovery_catalog_relations_county ON discovery_catalog_relation_revisions(county);
CREATE TRIGGER discovery_catalog_entity_heads_insert BEFORE INSERT ON discovery_catalog_entity_heads WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_entity_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='entity' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision IS NULL AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_entity_heads_advance BEFORE UPDATE ON discovery_catalog_entity_heads BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='entity' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision=OLD.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_entity_heads_delete BEFORE DELETE ON discovery_catalog_entity_heads BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_observation_heads_insert BEFORE INSERT ON discovery_catalog_observation_heads WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_observation_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='observation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision IS NULL AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_observation_heads_advance BEFORE UPDATE ON discovery_catalog_observation_heads BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='observation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision=OLD.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_observation_heads_delete BEFORE DELETE ON discovery_catalog_observation_heads BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_relation_heads_insert BEFORE INSERT ON discovery_catalog_relation_heads WHEN NOT EXISTS(SELECT 1 FROM discovery_catalog_relation_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='relation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision IS NULL AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_relation_heads_advance BEFORE UPDATE ON discovery_catalog_relation_heads BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g WHERE g.target_type='relation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND g.expected_revision=OLD.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_relation_heads_delete BEFORE DELETE ON discovery_catalog_relation_heads BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_entities_update BEFORE UPDATE ON discovery_catalog_entities BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_entities_delete BEFORE DELETE ON discovery_catalog_entities BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_entity_revisions_update BEFORE UPDATE ON discovery_catalog_entity_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_entity_revisions_delete BEFORE DELETE ON discovery_catalog_entity_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_provider_identities_update BEFORE UPDATE ON discovery_catalog_provider_identities BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_provider_identities_delete BEFORE DELETE ON discovery_catalog_provider_identities BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_observation_families_update BEFORE UPDATE ON discovery_catalog_observation_families BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_observation_families_delete BEFORE DELETE ON discovery_catalog_observation_families BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_observation_revisions_update BEFORE UPDATE ON discovery_catalog_observation_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_observation_revisions_delete BEFORE DELETE ON discovery_catalog_observation_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_evidence_refs_update BEFORE UPDATE ON discovery_catalog_evidence_refs BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_evidence_refs_delete BEFORE DELETE ON discovery_catalog_evidence_refs BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_decision_refs_update BEFORE UPDATE ON discovery_catalog_decision_refs BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_decision_refs_delete BEFORE DELETE ON discovery_catalog_decision_refs BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_relation_families_update BEFORE UPDATE ON discovery_catalog_relation_families BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_relation_families_delete BEFORE DELETE ON discovery_catalog_relation_families BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_relation_revisions_update BEFORE UPDATE ON discovery_catalog_relation_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_relation_revisions_delete BEFORE DELETE ON discovery_catalog_relation_revisions BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_aliases_update BEFORE UPDATE ON discovery_catalog_aliases BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_aliases_delete BEFORE DELETE ON discovery_catalog_aliases BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_write_guards_update BEFORE UPDATE ON discovery_catalog_write_guards BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_write_guards_delete BEFORE DELETE ON discovery_catalog_write_guards BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_operations_update BEFORE UPDATE ON discovery_catalog_operations BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_operations_delete BEFORE DELETE ON discovery_catalog_operations BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_reservation_update BEFORE UPDATE ON discovery_publication_reservations BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_reservation_delete BEFORE DELETE ON discovery_publication_reservations BEGIN SELECT RAISE(ABORT,'discovery-immutable'); END;
CREATE TRIGGER discovery_catalog_entity_heads_replace BEFORE INSERT ON discovery_catalog_entity_heads WHEN EXISTS(SELECT 1 FROM discovery_catalog_entity_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>(SELECT revision+1 FROM discovery_catalog_entity_heads WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g JOIN discovery_catalog_entity_heads h ON h.id=g.target_id AND h.revision=g.expected_revision WHERE g.target_type='entity' AND g.target_id=NEW.id AND g.revision=NEW.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_observation_heads_replace BEFORE INSERT ON discovery_catalog_observation_heads WHEN EXISTS(SELECT 1 FROM discovery_catalog_observation_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>(SELECT revision+1 FROM discovery_catalog_observation_heads WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g JOIN discovery_catalog_observation_heads h ON h.id=g.target_id AND h.revision=g.expected_revision WHERE g.target_type='observation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
CREATE TRIGGER discovery_catalog_relation_heads_replace BEFORE INSERT ON discovery_catalog_relation_heads WHEN EXISTS(SELECT 1 FROM discovery_catalog_relation_heads WHERE id=NEW.id) BEGIN
 SELECT CASE WHEN NEW.revision<>(SELECT revision+1 FROM discovery_catalog_relation_heads WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM discovery_catalog_write_guards g JOIN discovery_catalog_relation_heads h ON h.id=g.target_id AND h.revision=g.expected_revision WHERE g.target_type='relation' AND g.target_id=NEW.id AND g.revision=NEW.revision AND NOT EXISTS(SELECT 1 FROM discovery_catalog_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-unguarded-head') END;
END;
