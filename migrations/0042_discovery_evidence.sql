-- Private, bounded D1 evidence store. The explicit revocation transaction is the
-- sole exception to content immutability. Audit metadata excludes source text.
CREATE TABLE discovery_evidence_revisions (
 kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64), expires_at TEXT,scope_key TEXT,
 PRIMARY KEY(kind,id,revision)
);
CREATE TABLE discovery_evidence_contents (
 kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(kind,id,revision),FOREIGN KEY(kind,id,revision) REFERENCES discovery_evidence_revisions(kind,id,revision)
);
CREATE TABLE discovery_evidence_heads (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,id),FOREIGN KEY(kind,id,revision) REFERENCES discovery_evidence_revisions(kind,id,revision));
CREATE TABLE discovery_evidence_edges (
 source_kind TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,
 dependent_kind TEXT NOT NULL,dependent_id TEXT NOT NULL,dependent_revision INTEGER NOT NULL,
 PRIMARY KEY(source_kind,source_id,source_revision,dependent_kind,dependent_id,dependent_revision),
 FOREIGN KEY(source_kind,source_id,source_revision) REFERENCES discovery_evidence_revisions(kind,id,revision),
 FOREIGN KEY(dependent_kind,dependent_id,dependent_revision) REFERENCES discovery_evidence_revisions(kind,id,revision)
);
CREATE TABLE discovery_evidence_tombstones (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(kind,id,revision));
CREATE TABLE discovery_evidence_invalidations (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(kind,id,revision));
CREATE TABLE discovery_evidence_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1),invalidation_epoch INTEGER NOT NULL);
INSERT INTO discovery_evidence_state VALUES(1,0);
CREATE TABLE discovery_evidence_revoked_scopes (scope_key TEXT PRIMARY KEY,operation_id TEXT NOT NULL);
CREATE TABLE discovery_evidence_origin_members (member_id TEXT PRIMARY KEY,origin_id TEXT NOT NULL,origin_revision INTEGER NOT NULL,original_work_id TEXT);
CREATE TABLE discovery_evidence_decision_scopes (scope_key TEXT PRIMARY KEY,decision_id TEXT NOT NULL UNIQUE);
CREATE TABLE discovery_evidence_operations (operation_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,content_sha256 TEXT NOT NULL,capability_receipt_id TEXT NOT NULL,capability_sha256 TEXT NOT NULL,principal_id TEXT NOT NULL,authentication_context_id TEXT NOT NULL,action TEXT NOT NULL,committed_at TEXT NOT NULL);
CREATE TABLE discovery_evidence_guards (
 operation_id TEXT PRIMARY KEY, request_sha256 TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,
 expected_revision INTEGER,revision INTEGER NOT NULL,plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 capability_json TEXT NOT NULL CHECK(json_valid(capability_json)),checked_at TEXT NOT NULL
);
CREATE TRIGGER discovery_evidence_guard BEFORE INSERT ON discovery_evidence_guards BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id AND request_sha256<>NEW.request_sha256) THEN RAISE(ABORT,'discovery-evidence-operation-conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND (SELECT revision FROM discovery_evidence_heads WHERE kind=NEW.kind AND id=NEW.id) IS NOT NEW.expected_revision THEN RAISE(ABORT,'discovery-evidence-stale-head') END;
 SELECT CASE WHEN NEW.revision<>coalesce(NEW.expected_revision,0)+1 THEN RAISE(ABORT,'discovery-evidence-nonsequential-revision') END;
 SELECT CASE WHEN json_extract(NEW.capability_json,'$.requestSha256') IS NOT NEW.request_sha256 OR json_extract(NEW.capability_json,'$.minimalAuditRetention') IS NOT 'allow' OR json_extract(NEW.capability_json,'$.operationId') IS NOT NEW.operation_id OR json_extract(NEW.capability_json,'$.targetId') IS NOT NEW.id OR json_extract(NEW.capability_json,'$.action') IS NOT json_extract(NEW.plan_json,'$.action') OR julianday(json_extract(NEW.capability_json,'$.expiresAt')) IS NULL OR julianday(json_extract(NEW.capability_json,'$.expiresAt'))<=max(julianday('now'),julianday(NEW.checked_at)) THEN RAISE(ABORT,'discovery-evidence-capability-denied') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(
  SELECT 1 FROM json_each(NEW.plan_json,'$.expectedHeads') d WHERE (SELECT revision FROM discovery_evidence_heads WHERE kind=json_extract(d.value,'$.kind') AND id=json_extract(d.value,'$.id')) IS NOT json_extract(d.value,'$.revision')
 ) THEN RAISE(ABORT,'discovery-evidence-stale-dependency') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(
  SELECT 1 FROM json_each(NEW.plan_json,'$.refs') d WHERE NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=json_extract(d.value,'$.kind') AND c.id=json_extract(d.value,'$.id') AND c.revision=json_extract(d.value,'$.revision')) OR EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=json_extract(d.value,'$.kind') AND t.id=json_extract(d.value,'$.id') AND t.revision=json_extract(d.value,'$.revision')) OR EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=json_extract(d.value,'$.kind') AND t.id=json_extract(d.value,'$.id') AND t.revision=json_extract(d.value,'$.revision')) OR EXISTS(SELECT 1 FROM discovery_evidence_revisions r WHERE r.kind=json_extract(d.value,'$.kind') AND r.id=json_extract(d.value,'$.id') AND r.revision=json_extract(d.value,'$.revision') AND (NEW.kind<>'revocation' OR r.kind<>'rights') AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(NEW.checked_at)))
 ) THEN RAISE(ABORT,'discovery-evidence-unusable-reference') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(SELECT 1 FROM discovery_evidence_tombstones WHERE kind=NEW.kind AND id=NEW.id) THEN RAISE(ABORT,'discovery-evidence-revoked-family') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND NEW.kind IN ('representation','issued-request') AND (
 NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind='rights' AND c.id=json_extract(NEW.plan_json,'$.rights.id') AND c.revision=json_extract(NEW.plan_json,'$.rights.revision') AND json_extract(c.payload_json,'$.rights.retain')=1 AND json_extract(c.payload_json,'$.rights.transform')=1 AND json_extract(c.payload_json,'$.rights.materialScope')=json_extract(NEW.plan_json,'$.materialScopeJson')) OR
 EXISTS(SELECT 1 FROM discovery_evidence_revoked_scopes s WHERE s.scope_key=json_extract(NEW.plan_json,'$.scopeKey')) OR
 NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind='permission' AND c.id=json_extract(NEW.plan_json,'$.permission.id') AND c.revision=json_extract(NEW.plan_json,'$.permission.revision') AND json_extract(c.payload_json,'$.permission.fetch')=1 AND json_extract(c.payload_json,'$.permission.retain')=1 AND json_extract(c.payload_json,'$.permission.transform')=1 AND json_extract(c.payload_json,'$.permission.enrollment.id')=json_extract(NEW.plan_json,'$.enrollment.id') AND json_extract(c.payload_json,'$.permission.enrollment.revision')=json_extract(NEW.plan_json,'$.enrollment.revision') AND json_extract(c.payload_json,'$.permission.configuration.id')=json_extract(NEW.plan_json,'$.configuration.id') AND json_extract(c.payload_json,'$.permission.configuration.revision')=json_extract(NEW.plan_json,'$.configuration.revision') AND json_extract(c.payload_json,'$.permission.materialScope')=json_extract(NEW.plan_json,'$.materialScopeJson'))
 ) THEN RAISE(ABORT,'discovery-evidence-retention-denied') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND json_type(NEW.plan_json,'$.subject')='object' AND NOT EXISTS(SELECT 1 FROM discovery_catalog_entity_heads h JOIN discovery_catalog_entities e ON e.id=h.id WHERE e.id=json_extract(NEW.plan_json,'$.subject.id') AND e.kind=json_extract(NEW.plan_json,'$.subject.kind') AND h.revision=json_extract(NEW.plan_json,'$.subjectRevision')) THEN RAISE(ABORT,'discovery-evidence-stale-subject') END;
END;
CREATE TRIGGER discovery_evidence_finish BEFORE INSERT ON discovery_evidence_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g JOIN discovery_evidence_heads h ON h.kind=g.kind AND h.id=g.id AND h.revision=g.revision JOIN discovery_evidence_revisions r ON r.kind=h.kind AND r.id=h.id AND r.revision=h.revision WHERE g.operation_id=NEW.operation_id AND g.request_sha256=NEW.request_sha256 AND g.kind=NEW.kind AND g.id=NEW.id AND g.revision=NEW.revision AND r.content_sha256=NEW.content_sha256) THEN RAISE(ABORT,'discovery-evidence-incomplete-commit') END;
END;
CREATE TRIGGER discovery_evidence_head_insert BEFORE INSERT ON discovery_evidence_heads BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind=NEW.kind AND g.id=NEW.id AND g.revision=NEW.revision AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-head-guard-required') END;
END;
CREATE TRIGGER discovery_evidence_head_update BEFORE UPDATE ON discovery_evidence_heads BEGIN
 SELECT CASE WHEN NEW.kind<>OLD.kind OR NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind=NEW.kind AND g.id=NEW.id AND g.revision=NEW.revision AND g.expected_revision=OLD.revision AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-head-guard-required') END;
END;
CREATE TRIGGER discovery_evidence_content_delete BEFORE DELETE ON discovery_evidence_contents BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_tombstones t JOIN discovery_evidence_guards g ON g.operation_id=t.operation_id WHERE t.kind=OLD.kind AND t.id=OLD.id AND t.revision=OLD.revision AND g.kind='revocation' AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-removal-guard-required') END;
END;
-- Until WP14 provides a reviewed projection/removal bridge, WP04 cannot consume
-- these anchors into its immutable payload copies. An ID anchor is not evidence.
CREATE TRIGGER discovery_evidence_catalog_decision_bridge BEFORE INSERT ON discovery_catalog_decision_refs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e JOIN discovery_evidence_revisions r ON r.kind='evidence' AND r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision')) THEN RAISE(ABORT,'discovery-evidence-catalog-bridge-unqualified') END;
END;
CREATE TRIGGER discovery_evidence_catalog_alias_bridge BEFORE INSERT ON discovery_catalog_aliases BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e JOIN discovery_evidence_revisions r ON r.kind='evidence' AND r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision')) THEN RAISE(ABORT,'discovery-evidence-catalog-bridge-unqualified') END;
END;
CREATE TRIGGER discovery_evidence_revisions_update BEFORE UPDATE ON discovery_evidence_revisions BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_revisions_delete BEFORE DELETE ON discovery_evidence_revisions BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_edges_update BEFORE UPDATE ON discovery_evidence_edges BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_edges_delete BEFORE DELETE ON discovery_evidence_edges BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_tombstones_update BEFORE UPDATE ON discovery_evidence_tombstones BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_tombstones_delete BEFORE DELETE ON discovery_evidence_tombstones BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_invalidations_update BEFORE UPDATE ON discovery_evidence_invalidations BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_invalidations_delete BEFORE DELETE ON discovery_evidence_invalidations BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_operations_update BEFORE UPDATE ON discovery_evidence_operations BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_operations_delete BEFORE DELETE ON discovery_evidence_operations BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_revoked_scopes_update BEFORE UPDATE ON discovery_evidence_revoked_scopes BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_revoked_scopes_delete BEFORE DELETE ON discovery_evidence_revoked_scopes BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_contents_update BEFORE UPDATE ON discovery_evidence_contents BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_revisions_replace BEFORE INSERT ON discovery_evidence_revisions WHEN EXISTS(SELECT 1 FROM discovery_evidence_revisions x WHERE x.kind=NEW.kind AND x.id=NEW.id AND x.revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_contents_replace BEFORE INSERT ON discovery_evidence_contents WHEN EXISTS(SELECT 1 FROM discovery_evidence_contents x WHERE x.kind=NEW.kind AND x.id=NEW.id AND x.revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_operations_replace BEFORE INSERT ON discovery_evidence_operations WHEN EXISTS(SELECT 1 FROM discovery_evidence_operations x WHERE x.operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_tombstones_replace BEFORE INSERT ON discovery_evidence_tombstones WHEN EXISTS(SELECT 1 FROM discovery_evidence_tombstones x WHERE x.kind=NEW.kind AND x.id=NEW.id AND x.revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_invalidations_replace BEFORE INSERT ON discovery_evidence_invalidations WHEN EXISTS(SELECT 1 FROM discovery_evidence_invalidations x WHERE x.kind=NEW.kind AND x.id=NEW.id AND x.revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_catalog_relation_bridge BEFORE INSERT ON discovery_catalog_relation_revisions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.payload_json,'$.evidence') e JOIN discovery_evidence_revisions r ON r.kind='evidence' AND r.id=json_extract(e.value,'$.id') AND r.revision=json_extract(e.value,'$.revision')) THEN RAISE(ABORT,'discovery-evidence-catalog-bridge-unqualified') END;
END;
CREATE TRIGGER discovery_evidence_anchor_collision BEFORE INSERT ON discovery_evidence_revisions WHEN NEW.kind='evidence' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_catalog_evidence_refs WHERE id=NEW.id AND revision=NEW.revision) THEN RAISE(ABORT,'discovery-evidence-catalog-anchor-collision') END;
END;
CREATE TABLE discovery_evidence_scope_checks (operation_id TEXT NOT NULL,scope_key TEXT NOT NULL,decision_id TEXT NOT NULL);
CREATE TRIGGER discovery_evidence_scope_check BEFORE INSERT ON discovery_evidence_scope_checks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_decision_scopes WHERE scope_key=NEW.scope_key AND decision_id=NEW.decision_id) THEN RAISE(ABORT,'discovery-evidence-decision-scope-conflict') END;
END;
CREATE TRIGGER discovery_evidence_scope_check_cleanup AFTER INSERT ON discovery_evidence_scope_checks BEGIN DELETE FROM discovery_evidence_scope_checks WHERE rowid=NEW.rowid; END;
CREATE TRIGGER discovery_evidence_revision_guard BEFORE INSERT ON discovery_evidence_revisions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind=NEW.kind AND g.id=NEW.id AND g.revision=NEW.revision AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-write-guard-required') END;
END;
CREATE TRIGGER discovery_evidence_content_guard BEFORE INSERT ON discovery_evidence_contents BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind=NEW.kind AND g.id=NEW.id AND g.revision=NEW.revision AND json_extract(g.plan_json,'$.binding')=NEW.payload_json AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-content-binding-mismatch') END;
END;
CREATE TRIGGER discovery_evidence_finish_binding BEFORE INSERT ON discovery_evidence_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.operation_id=NEW.operation_id AND julianday(json_extract(g.capability_json,'$.expiresAt'))>max(julianday('now'),julianday(g.checked_at)) AND (
 (NEW.kind='revocation' AND EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=NEW.kind AND t.id=NEW.id AND t.revision=NEW.revision AND t.operation_id=NEW.operation_id)) OR
 EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=NEW.kind AND c.id=NEW.id AND c.revision=NEW.revision AND c.payload_json=json_extract(g.plan_json,'$.binding'))
 ) AND NOT EXISTS(SELECT 1 FROM json_each(g.plan_json,'$.refs') d JOIN discovery_evidence_revisions r ON r.kind=json_extract(d.value,'$.kind') AND r.id=json_extract(d.value,'$.id') AND r.revision=json_extract(d.value,'$.revision') WHERE (NEW.kind<>'revocation' OR r.kind<>'rights') AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(g.checked_at)))) THEN RAISE(ABORT,'discovery-evidence-incomplete-binding') END;
END;
CREATE TRIGGER discovery_evidence_decision_scope_replace BEFORE INSERT ON discovery_evidence_decision_scopes BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_evidence_decision_scopes WHERE decision_id=NEW.decision_id AND scope_key<>NEW.scope_key) THEN RAISE(ABORT,'discovery-evidence-decision-scope-conflict') END;
END;
CREATE TRIGGER discovery_evidence_decision_scope_update BEFORE UPDATE ON discovery_evidence_decision_scopes BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_decision_scope_delete BEFORE DELETE ON discovery_evidence_decision_scopes BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_repeated_bytes BEFORE INSERT ON discovery_evidence_contents WHEN NEW.kind='representation' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind='representation' AND c.id=NEW.id AND json_extract(c.payload_json,'$.originalBytesSha256')=json_extract(NEW.payload_json,'$.originalBytesSha256')) THEN RAISE(ABORT,'discovery-evidence-use-observation') END;
END;

CREATE TRIGGER discovery_evidence_origin_member_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='representation' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND NOT EXISTS(
  SELECT 1 FROM discovery_evidence_contents c JOIN json_each(c.payload_json,'$.memberEndpoints') m WHERE c.kind='origin' AND c.id=json_extract(NEW.plan_json,'$.origin.id') AND c.revision=json_extract(NEW.plan_json,'$.origin.revision') AND json_extract(c.payload_json,'$.retired')=0 AND m.key=json_extract(NEW.plan_json,'$.originMemberId') AND m.value=json_extract(NEW.plan_json,'$.actualEndpoint')
 ) THEN RAISE(ABORT,'discovery-evidence-origin-member-mismatch') END;
END;
CREATE TRIGGER discovery_evidence_decision_scope_rebind BEFORE INSERT ON discovery_evidence_decision_scopes BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM discovery_evidence_decision_scopes WHERE scope_key=NEW.scope_key AND decision_id<>NEW.decision_id) THEN RAISE(ABORT,'discovery-evidence-decision-scope-conflict') END;
END;
CREATE TRIGGER discovery_evidence_origin_member_insert BEFORE INSERT ON discovery_evidence_origin_members BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind='origin' AND g.id=NEW.origin_id AND g.revision=NEW.origin_revision AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) OR EXISTS(SELECT 1 FROM discovery_evidence_origin_members WHERE member_id=NEW.member_id AND (origin_id<>NEW.origin_id OR origin_revision<>NEW.origin_revision OR original_work_id<>NEW.original_work_id)) THEN RAISE(ABORT,'discovery-evidence-origin-member-conflict') END;
END;
CREATE TRIGGER discovery_evidence_origin_member_update BEFORE UPDATE ON discovery_evidence_origin_members BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_evidence_origin_member_delete BEFORE DELETE ON discovery_evidence_origin_members BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.kind='origin' AND g.id=OLD.origin_id AND g.expected_revision=OLD.origin_revision AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-evidence-origin-member-guard-required') END;
END;

-- New private uses retain exact historical content refs but require usable full
-- ancestry. Mutable source authorizations remain pinned to their current heads.
CREATE TRIGGER discovery_evidence_ancestor_guard BEFORE INSERT ON discovery_evidence_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(
  WITH RECURSIVE ancestors(kind,id,revision) AS (
   SELECT json_extract(d.value,'$.kind'),json_extract(d.value,'$.id'),json_extract(d.value,'$.revision') FROM json_each(NEW.plan_json,'$.refs') d WHERE NEW.kind<>'revocation' OR json_extract(d.value,'$.kind')='policy'
   UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN ancestors a ON e.dependent_kind=a.kind AND e.dependent_id=a.id AND e.dependent_revision=a.revision
  ) SELECT 1 FROM ancestors a LEFT JOIN discovery_evidence_revisions r USING(kind,id,revision) WHERE
   NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=a.kind AND c.id=a.id AND c.revision=a.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=a.kind AND t.id=a.id AND t.revision=a.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_invalidations i WHERE i.kind=a.kind AND i.id=a.id AND i.revision=a.revision) OR
   (r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(NEW.checked_at))) OR
   (a.kind IN ('rights','permission','enrollment') AND (SELECT revision FROM discovery_evidence_heads h WHERE h.kind=a.kind AND h.id=a.id) IS NOT a.revision)
 ) THEN RAISE(ABORT,'discovery-evidence-unusable-ancestor') END;
END;
CREATE TRIGGER discovery_evidence_ancestor_finish BEFORE INSERT ON discovery_evidence_operations BEGIN
 SELECT CASE WHEN EXISTS(
  WITH RECURSIVE ancestors(kind,id,revision) AS (
   SELECT json_extract(d.value,'$.kind'),json_extract(d.value,'$.id'),json_extract(d.value,'$.revision') FROM discovery_evidence_guards g JOIN json_each(g.plan_json,'$.refs') d WHERE g.operation_id=NEW.operation_id AND (NEW.kind<>'revocation' OR json_extract(d.value,'$.kind')='policy')
   UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN ancestors a ON e.dependent_kind=a.kind AND e.dependent_id=a.id AND e.dependent_revision=a.revision
  ) SELECT 1 FROM ancestors a JOIN discovery_evidence_revisions r USING(kind,id,revision) JOIN discovery_evidence_guards g ON g.operation_id=NEW.operation_id WHERE r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(g.checked_at))
 ) THEN RAISE(ABORT,'discovery-evidence-expired-ancestor') END;
END;
CREATE TRIGGER discovery_evidence_origin_scope_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='representation' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND NOT EXISTS(
  SELECT 1 FROM discovery_evidence_contents o JOIN json_each(o.payload_json,'$.retentionRights') owner JOIN discovery_evidence_contents r ON r.kind='rights' AND r.id=json_extract(owner.value,'$.id') AND r.revision=json_extract(owner.value,'$.revision') WHERE o.kind='origin' AND o.id=json_extract(NEW.plan_json,'$.origin.id') AND o.revision=json_extract(NEW.plan_json,'$.origin.revision') AND json_extract(r.payload_json,'$.rights.materialScope')=json_extract(NEW.plan_json,'$.materialScopeJson')
 ) THEN RAISE(ABORT,'discovery-evidence-origin-rights-mismatch') END;
END;

CREATE TRIGGER discovery_evidence_audit_binding BEFORE INSERT ON discovery_evidence_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.operation_id=NEW.operation_id AND json_extract(g.plan_json,'$.capabilitySha256')=NEW.capability_sha256 AND json_extract(g.capability_json,'$.receiptId')=NEW.capability_receipt_id AND json_extract(g.capability_json,'$.principalId')=NEW.principal_id AND json_extract(g.capability_json,'$.authenticationContextId')=NEW.authentication_context_id AND json_extract(g.capability_json,'$.action')=NEW.action AND json_extract(g.capability_json,'$.minimalAuditRetention')='allow') THEN RAISE(ABORT,'discovery-evidence-audit-binding-mismatch') END;
END;

CREATE TRIGGER discovery_evidence_issued_binding_guard BEFORE INSERT ON discovery_evidence_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND (
  (NEW.kind='issued-request' AND json_extract(NEW.plan_json,'$.verifiedIssuedBinding') IS NOT json_extract(NEW.plan_json,'$.binding')) OR
  (json_type(NEW.plan_json,'$.issuedRequest')='object' AND NOT EXISTS(
   SELECT 1 FROM discovery_evidence_contents c JOIN discovery_evidence_heads h USING(kind,id,revision) WHERE c.kind='issued-request' AND c.id=json_extract(NEW.plan_json,'$.issuedRequest.id') AND c.revision=json_extract(NEW.plan_json,'$.issuedRequest.revision') AND c.payload_json=json_extract(NEW.plan_json,'$.issuedBinding')
  )) OR
  (NEW.kind='representation' AND json_extract(NEW.plan_json,'$.materialScope.kind')='source-response' AND json_type(NEW.plan_json,'$.issuedRequest') IS NOT 'object')
 ) THEN RAISE(ABORT,'discovery-evidence-issued-binding-mismatch') END;
END;

-- Scope withdrawal is terminal in this private package. Registering a fresh grant
-- ID must not resurrect an origin rationale or any other protected content.
CREATE TRIGGER discovery_evidence_revoked_grant_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind IN ('rights','permission') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(SELECT 1 FROM discovery_evidence_revoked_scopes s WHERE s.scope_key=json_extract(NEW.plan_json,'$.scopeKey')) THEN RAISE(ABORT,'discovery-evidence-revoked-scope') END;
END;
