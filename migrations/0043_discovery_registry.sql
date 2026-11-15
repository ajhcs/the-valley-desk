-- Private operational registry. Deliberately empty: no source is enrolled or active.
CREATE TABLE discovery_source_revisions(source_id TEXT NOT NULL,revision INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),configuration_sha256 TEXT NOT NULL,scope_sha256 TEXT NOT NULL,PRIMARY KEY(source_id,revision));
CREATE TABLE discovery_source_heads(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),generation INTEGER NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 9007199254740991),qualification_id TEXT);
CREATE TABLE discovery_source_budgets(id TEXT PRIMARY KEY,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),requests INTEGER NOT NULL DEFAULT 0,reserved_bytes INTEGER NOT NULL DEFAULT 0,retained_bytes INTEGER NOT NULL DEFAULT 0,pages INTEGER NOT NULL DEFAULT 0,items INTEGER NOT NULL DEFAULT 0,
 CHECK(typeof(requests)='integer' AND requests BETWEEN 0 AND 9007199254740991 AND requests<=json_extract(payload_json,'$.maxRequests')),
 CHECK(typeof(reserved_bytes)='integer' AND reserved_bytes BETWEEN 0 AND 9007199254740991),
 CHECK(typeof(retained_bytes)='integer' AND retained_bytes BETWEEN 0 AND 9007199254740991 AND reserved_bytes<=json_extract(payload_json,'$.maxRetainedBytes')-retained_bytes),
 CHECK(typeof(pages)='integer' AND pages BETWEEN 0 AND 9007199254740991 AND pages<=json_extract(payload_json,'$.maxPages')),
 CHECK(typeof(items)='integer' AND items BETWEEN 0 AND 9007199254740991 AND items<=json_extract(payload_json,'$.maxItems')));
CREATE TABLE discovery_source_qualifications(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),expires_at TEXT NOT NULL);
CREATE TABLE discovery_source_sampling(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,max_requests INTEGER NOT NULL,requests INTEGER NOT NULL DEFAULT 0 CHECK(requests BETWEEN 0 AND 9007199254740991 AND requests<=max_requests),expires_at TEXT NOT NULL);
CREATE TABLE discovery_source_leases(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,owner TEXT NOT NULL,fence INTEGER NOT NULL CHECK(typeof(fence)='integer' AND fence BETWEEN 1 AND 9007199254740991),expires_at TEXT NOT NULL);
CREATE TABLE discovery_source_plans(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN('collection','qualification-sample')),qualification_id TEXT,sampling_id TEXT,generation INTEGER NOT NULL,lease_id TEXT NOT NULL,lease_owner TEXT NOT NULL,lease_fence INTEGER NOT NULL,endpoint TEXT NOT NULL,request_sha256 TEXT NOT NULL,binding_token_sha256 TEXT NOT NULL UNIQUE,deadline_at TEXT NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)));
CREATE TABLE discovery_source_attempts(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,ordinal INTEGER NOT NULL,hop INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('dispatched','finished','received')),max_bytes INTEGER NOT NULL,max_items INTEGER NOT NULL CHECK(typeof(max_items)='integer' AND max_items BETWEEN 1 AND 100),received_bytes INTEGER,body_sha256 TEXT,outcome TEXT,http_status INTEGER,finish_sha256 TEXT,UNIQUE(plan_id,ordinal,hop));
CREATE TABLE discovery_source_backoff(source_id TEXT PRIMARY KEY,next_attempt_at TEXT NOT NULL,failures INTEGER NOT NULL CHECK(failures BETWEEN 0 AND 30),last_code TEXT NOT NULL);
CREATE TABLE discovery_source_operations(operation_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),authority_json TEXT NOT NULL CHECK(json_valid(authority_json)));
-- Issued IDs remain reserved by permitted minimal audit after scoped content
-- removal; another source/operation can never inherit an earlier plan identity.
CREATE UNIQUE INDEX discovery_source_issued_identity
 ON discovery_source_operations(json_extract(result_json,'$.id'))
 WHERE json_extract(authority_json,'$.action')='issue';
CREATE TABLE discovery_source_rejections(operation_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,code TEXT NOT NULL,checked_at TEXT NOT NULL);
CREATE TABLE discovery_source_guards(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,purpose TEXT NOT NULL,qualification_id TEXT,sampling_id TEXT,plan_id TEXT,checked_at TEXT NOT NULL);
CREATE TRIGGER discovery_source_guard BEFORE INSERT ON discovery_source_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_heads h JOIN discovery_source_revisions s ON s.source_id=h.source_id AND s.revision=h.revision WHERE h.source_id=NEW.source_id AND h.revision=NEW.source_revision AND julianday(json_extract(s.payload_json,'$.expiresAt'))>max(julianday('now'),julianday(NEW.checked_at))) THEN RAISE(ABORT,'discovery-source-stale-or-expired') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_revisions s JOIN discovery_source_budgets b ON b.id=json_extract(s.payload_json,'$.budget.id') WHERE s.source_id=NEW.source_id AND s.revision=NEW.source_revision AND b.payload_json=json_extract(s.payload_json,'$.budget')) THEN RAISE(ABORT,'discovery-source-budget-missing-or-changed') END;
 SELECT CASE WHEN EXISTS(
  WITH RECURSIVE deps(kind,id,revision) AS (
   SELECT j.key,json_extract(j.value,'$.id'),json_extract(j.value,'$.revision') FROM discovery_source_revisions s,json_each(s.payload_json) j WHERE s.source_id=NEW.source_id AND s.revision=NEW.source_revision AND j.key IN('enrollment','configuration','permission','rights','parser','normalizer')
   UNION SELECT 'policy',json_extract(s.payload_json,'$.accessDecision.id'),json_extract(s.payload_json,'$.accessDecision.revision') FROM discovery_source_revisions s WHERE s.source_id=NEW.source_id AND s.revision=NEW.source_revision
   UNION SELECT 'policy',json_extract(s.payload_json,'$.displayRights.id'),json_extract(s.payload_json,'$.displayRights.revision') FROM discovery_source_revisions s WHERE s.source_id=NEW.source_id AND s.revision=NEW.source_revision
   UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN deps d ON e.dependent_kind=d.kind AND e.dependent_id=d.id AND e.dependent_revision=d.revision
  ) SELECT 1 FROM deps d WHERE
   NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=d.kind AND c.id=d.id AND c.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_revisions r WHERE r.kind=d.kind AND r.id=d.id AND r.revision=d.revision AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(NEW.checked_at))) OR
   (d.kind IN('enrollment','configuration','permission','rights','parser','normalizer','policy') AND (SELECT h.revision FROM discovery_evidence_heads h WHERE h.kind=d.kind AND h.id=d.id) IS NOT d.revision)
 ) THEN RAISE(ABORT,'discovery-source-control-denied') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM discovery_source_revisions s JOIN discovery_evidence_contents p ON p.kind='permission' AND p.id=json_extract(s.payload_json,'$.permission.id') AND p.revision=json_extract(s.payload_json,'$.permission.revision') JOIN discovery_evidence_contents r ON r.kind='rights' AND r.id=json_extract(s.payload_json,'$.rights.id') AND r.revision=json_extract(s.payload_json,'$.rights.revision')
  WHERE s.source_id=NEW.source_id AND s.revision=NEW.source_revision AND json_extract(p.payload_json,'$.permission.materialScope')=json_extract(s.payload_json,'$.materialScope') AND json_extract(r.payload_json,'$.rights.materialScope')=json_extract(s.payload_json,'$.materialScope') AND json_extract(p.payload_json,'$.permission.fetch')=1 AND json_extract(p.payload_json,'$.permission.retain')=1 AND json_extract(p.payload_json,'$.permission.transform')=1 AND json_extract(r.payload_json,'$.rights.retain')=1 AND json_extract(r.payload_json,'$.rights.transform')=1 AND NOT EXISTS(SELECT 1 FROM discovery_evidence_revoked_scopes x WHERE x.scope_key=s.scope_sha256)
 ) THEN RAISE(ABORT,'discovery-source-permission-denied') END;
 SELECT CASE WHEN NEW.purpose='collection' AND NOT EXISTS(SELECT 1 FROM discovery_source_heads h JOIN discovery_source_qualifications q ON q.id=h.qualification_id JOIN discovery_source_revisions s ON s.source_id=h.source_id AND s.revision=h.revision WHERE h.source_id=NEW.source_id AND h.revision=NEW.source_revision AND h.active=1 AND q.id=NEW.qualification_id AND q.source_revision=h.revision AND q.source_id=h.source_id AND json_extract(q.payload_json,'$.configurationSha256')=s.configuration_sha256 AND julianday(q.expires_at)>max(julianday('now'),julianday(NEW.checked_at))) THEN RAISE(ABORT,'discovery-source-activation-denied') END;
 SELECT CASE WHEN NEW.qualification_id IS NOT NULL AND EXISTS(
  WITH RECURSIVE samples(kind,id,revision) AS (
   SELECT 'representation',json_extract(j.value,'$.representation.id'),json_extract(j.value,'$.representation.revision') FROM discovery_source_qualifications q,json_each(q.payload_json,'$.samples') j WHERE q.id=NEW.qualification_id
   UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN samples d ON e.dependent_kind=d.kind AND e.dependent_id=d.id AND e.dependent_revision=d.revision
  ) SELECT 1 FROM samples d WHERE
   NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=d.kind AND c.id=d.id AND c.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_revisions r WHERE r.kind=d.kind AND r.id=d.id AND r.revision=d.revision AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(NEW.checked_at))) OR
   (d.kind IN('enrollment','configuration','permission','rights','parser','normalizer','policy') AND (SELECT h.revision FROM discovery_evidence_heads h WHERE h.kind=d.kind AND h.id=d.id) IS NOT d.revision)
 ) THEN RAISE(ABORT,'discovery-source-qualification-sample-unusable') END;
 SELECT CASE WHEN NEW.purpose='qualification-sample' AND NOT EXISTS(SELECT 1 FROM discovery_source_sampling g WHERE g.id=NEW.sampling_id AND g.source_id=NEW.source_id AND g.source_revision=NEW.source_revision AND julianday(g.expires_at)>max(julianday('now'),julianday(NEW.checked_at))) THEN RAISE(ABORT,'discovery-source-sampling-denied') END;
 SELECT CASE WHEN NEW.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM discovery_source_plans p JOIN discovery_source_leases l ON l.id=p.lease_id JOIN discovery_source_heads h ON h.source_id=p.source_id WHERE p.id=NEW.plan_id AND p.source_id=NEW.source_id AND p.source_revision=NEW.source_revision AND p.generation=h.generation AND l.source_id=p.source_id AND l.owner=p.lease_owner AND l.fence=p.lease_fence AND julianday(l.expires_at)>max(julianday('now'),julianday(NEW.checked_at)) AND julianday(p.deadline_at)>max(julianday('now'),julianday(NEW.checked_at))) THEN RAISE(ABORT,'discovery-source-lease-or-deadline-denied') END;
END;
CREATE TRIGGER discovery_source_parent_guard BEFORE INSERT ON discovery_source_guards WHEN NEW.plan_id IS NOT NULL AND json_type((SELECT payload_json FROM discovery_source_plans WHERE id=NEW.plan_id),'$.continuation')='object' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_plans p JOIN discovery_source_captures c ON c.operation_id=json_extract(p.payload_json,'$.continuationParentCaptureId') WHERE p.id=NEW.plan_id AND c.settled=1) THEN RAISE(ABORT,'discovery-source-parent-missing') END;
 SELECT CASE WHEN EXISTS(
  WITH RECURSIVE parents(kind,id,revision) AS (
   SELECT 'representation',c.representation_id,c.representation_revision FROM discovery_source_plans p JOIN discovery_source_captures c ON c.operation_id=json_extract(p.payload_json,'$.continuationParentCaptureId') WHERE p.id=NEW.plan_id AND c.settled=1
   UNION SELECT e.source_kind,e.source_id,e.source_revision FROM discovery_evidence_edges e JOIN parents d ON e.dependent_kind=d.kind AND e.dependent_id=d.id AND e.dependent_revision=d.revision
  ) SELECT 1 FROM parents d WHERE
   NOT EXISTS(SELECT 1 FROM discovery_evidence_contents c WHERE c.kind=d.kind AND c.id=d.id AND c.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_tombstones t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_invalidations t WHERE t.kind=d.kind AND t.id=d.id AND t.revision=d.revision) OR
   EXISTS(SELECT 1 FROM discovery_evidence_revisions r WHERE r.kind=d.kind AND r.id=d.id AND r.revision=d.revision AND r.expires_at IS NOT NULL AND julianday(r.expires_at)<=max(julianday('now'),julianday(NEW.checked_at))) OR
   (d.kind IN('enrollment','configuration','permission','rights','parser','normalizer','policy') AND (SELECT h.revision FROM discovery_evidence_heads h WHERE h.kind=d.kind AND h.id=d.id) IS NOT d.revision)
 ) THEN RAISE(ABORT,'discovery-source-parent-unusable') END;
END;
CREATE TABLE discovery_source_captures(operation_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL UNIQUE,attempt_id TEXT NOT NULL UNIQUE,representation_id TEXT NOT NULL,representation_revision INTEGER NOT NULL,byte_length INTEGER NOT NULL,body_sha256 TEXT NOT NULL,settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN(0,1)));
CREATE TRIGGER discovery_source_capture_guard BEFORE INSERT ON discovery_source_captures BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_guards g JOIN discovery_source_attempts a ON a.plan_id=g.plan_id JOIN discovery_source_plans p ON p.id=a.plan_id WHERE g.id=NEW.operation_id AND g.plan_id=NEW.plan_id AND a.id=NEW.attempt_id AND a.state='received' AND a.http_status BETWEEN 200 AND 299 AND a.body_sha256=NEW.body_sha256 AND a.received_bytes=NEW.byte_length AND NEW.byte_length BETWEEN 1 AND a.max_bytes) THEN RAISE(ABORT,'discovery-source-unreceived-body') END;
END;
CREATE TRIGGER discovery_source_capture_settle BEFORE UPDATE OF settled ON discovery_source_captures BEGIN
 SELECT CASE WHEN OLD.settled<>0 OR NEW.settled<>1 OR NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o JOIN discovery_evidence_contents c ON c.kind=o.kind AND c.id=o.id AND c.revision=o.revision WHERE o.operation_id=NEW.operation_id AND o.kind='representation' AND o.id=NEW.representation_id AND o.revision=NEW.representation_revision AND json_extract(c.payload_json,'$.originalBytesSha256')=NEW.body_sha256 AND json_extract(c.payload_json,'$.issuedRequest.id')=NEW.plan_id AND json_array_length(json_extract(c.payload_json,'$.bytes'))=NEW.byte_length) THEN RAISE(ABORT,'discovery-source-retention-settlement-denied') END;
END;
CREATE TABLE discovery_source_assertions(id TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
CREATE TRIGGER discovery_source_assertion_cleanup AFTER INSERT ON discovery_source_assertions BEGIN DELETE FROM discovery_source_assertions WHERE id=NEW.id; END;
-- Source-bearing request parameters, provider continuations and sampled endpoints
-- share the exact scoped removal transaction. Minimal operation/authority receipts
-- contain IDs/hashes only. Raw binding/capability tokens are never persisted.
CREATE TRIGGER discovery_source_scope_remove AFTER INSERT ON discovery_evidence_revoked_scopes BEGIN
 UPDATE discovery_source_heads SET active=0,generation=generation+1,qualification_id=NULL WHERE EXISTS(SELECT 1 FROM discovery_source_revisions s WHERE s.source_id=discovery_source_heads.source_id AND s.revision=discovery_source_heads.revision AND s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_captures WHERE plan_id IN(SELECT p.id FROM discovery_source_plans p JOIN discovery_source_revisions s ON s.source_id=p.source_id AND s.revision=p.source_revision WHERE s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_attempts WHERE plan_id IN(SELECT p.id FROM discovery_source_plans p JOIN discovery_source_revisions s ON s.source_id=p.source_id AND s.revision=p.source_revision WHERE s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_plans WHERE EXISTS(SELECT 1 FROM discovery_source_revisions s WHERE s.source_id=discovery_source_plans.source_id AND s.revision=discovery_source_plans.source_revision AND s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_qualifications WHERE EXISTS(SELECT 1 FROM discovery_source_revisions s WHERE s.source_id=discovery_source_qualifications.source_id AND s.revision=discovery_source_qualifications.source_revision AND s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_sampling WHERE EXISTS(SELECT 1 FROM discovery_source_revisions s WHERE s.source_id=discovery_source_sampling.source_id AND s.revision=discovery_source_sampling.source_revision AND s.scope_sha256=NEW.scope_key);
 DELETE FROM discovery_source_revisions WHERE scope_sha256=NEW.scope_key;
END;
