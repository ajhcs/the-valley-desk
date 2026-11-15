-- One source has one actual registry lease. Existing duplicates fail migration;
-- migration never chooses an owner or silently merges existing leases.
CREATE UNIQUE INDEX discovery_collection_one_source_lease ON discovery_source_leases(source_id);
CREATE TABLE discovery_collection_cohorts(id TEXT PRIMARY KEY,policy_json TEXT NOT NULL CHECK(json_valid(policy_json)));
CREATE TABLE discovery_collection_bindings(cohort_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,scope_sha256 TEXT NOT NULL,configuration_sha256 TEXT NOT NULL,query_sha256 TEXT NOT NULL,source_json TEXT,parameters_json TEXT,chain_id TEXT NOT NULL,PRIMARY KEY(cohort_id,source_id));
CREATE TABLE discovery_collection_rounds(id TEXT PRIMARY KEY,cohort_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('active','complete','stopped')),cursor INTEGER NOT NULL,size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 128),created_at TEXT NOT NULL,CHECK(cursor BETWEEN 0 AND size));
CREATE TABLE discovery_collection_chains(id TEXT PRIMARY KEY,cohort_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,scope_sha256 TEXT NOT NULL,configuration_sha256 TEXT NOT NULL,query_sha256 TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,page_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN('active','complete','partial','restart-required')),checkpoint TEXT,last_receipt_id TEXT,expires_at TEXT);
CREATE TABLE discovery_collection_slots(round_id TEXT NOT NULL,slot_index INTEGER NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,scope_sha256 TEXT NOT NULL,chain_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','claimed','finished','revoked')),claim_id TEXT,fence INTEGER NOT NULL DEFAULT 0,outcome TEXT,code TEXT,finished_at TEXT,PRIMARY KEY(round_id,slot_index));
CREATE TABLE discovery_collection_claims(id TEXT PRIMARY KEY,round_id TEXT NOT NULL,slot_index INTEGER NOT NULL,scope_sha256 TEXT NOT NULL,owner TEXT NOT NULL,fence INTEGER NOT NULL CHECK(fence BETWEEN 1 AND 9007199254740991),expires_at TEXT NOT NULL,processing_deadline_at TEXT NOT NULL,source_lease_id TEXT NOT NULL,source_lease_fence INTEGER NOT NULL,chain_revision INTEGER NOT NULL,chain_page_count INTEGER NOT NULL,checkpoint TEXT,last_receipt_id TEXT,issued_plan_id TEXT);
CREATE TABLE discovery_collection_guards(operation_id TEXT PRIMARY KEY,claim_id TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('issue','capture','finish')),plan_id TEXT,checked_at TEXT NOT NULL);
-- This executes inside WP06's actual reservation batch, after its control and
-- budget guards. A plan orphaned between issuance and slot binding cannot send.
CREATE TRIGGER discovery_collection_dispatch_guard BEFORE INSERT ON discovery_source_attempts
 WHEN EXISTS(SELECT 1 FROM discovery_source_plans p JOIN discovery_collection_rounds r ON r.id=json_extract(p.payload_json,'$.request.runId') WHERE p.id=NEW.plan_id) BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM discovery_source_plans p JOIN discovery_collection_claims c ON c.issued_plan_id=p.id
  JOIN discovery_collection_slots s ON s.claim_id=c.id JOIN discovery_collection_rounds r ON r.id=c.round_id
  JOIN discovery_source_leases l ON l.id=c.source_lease_id JOIN discovery_source_guards g ON g.plan_id=p.id
  WHERE p.id=NEW.plan_id AND r.id=json_extract(p.payload_json,'$.request.runId') AND r.status='active'
    AND r.cursor=s.slot_index AND s.state='claimed' AND s.fence=c.fence
    AND p.lease_id=c.source_lease_id AND p.lease_owner=c.owner AND p.lease_fence=c.source_lease_fence
    AND l.owner=c.owner AND l.fence=c.source_lease_fence AND l.expires_at=c.expires_at
    AND julianday(c.processing_deadline_at)>max(julianday('now'),julianday(g.checked_at))
    AND julianday(c.expires_at)>max(julianday('now'),julianday(g.checked_at))
    AND NOT EXISTS(SELECT 1 FROM discovery_source_attempts a WHERE a.plan_id=p.id)
 ) THEN RAISE(ABORT,'discovery-collection-unbound-dispatch') END;
END;
CREATE TRIGGER discovery_collection_guard BEFORE INSERT ON discovery_collection_guards BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.round_id=c.round_id AND s.slot_index=c.slot_index JOIN discovery_collection_rounds r ON r.id=c.round_id JOIN discovery_source_leases l ON l.id=c.source_lease_id
  WHERE c.id=NEW.claim_id AND s.claim_id=c.id AND s.fence=c.fence AND s.state='claimed' AND r.status='active' AND r.cursor=c.slot_index AND l.source_id=s.source_id AND l.owner=c.owner AND l.fence=c.source_lease_fence AND l.expires_at=c.expires_at AND julianday(c.expires_at)>max(julianday('now'),julianday(NEW.checked_at)) AND (NEW.stage='finish' OR julianday(c.processing_deadline_at)>max(julianday('now'),julianday(NEW.checked_at)))
 ) THEN RAISE(ABORT,'discovery-collection-stale-claim') END;
 SELECT CASE WHEN NEW.stage<>'finish' AND NOT EXISTS(SELECT 1 FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.round_id=c.round_id AND s.slot_index=c.slot_index JOIN discovery_collection_chains ch ON ch.id=s.chain_id WHERE c.id=NEW.claim_id AND ch.revision=c.chain_revision AND ch.page_count=c.chain_page_count AND ch.status='active' AND (ch.expires_at IS NULL OR julianday(ch.expires_at)>max(julianday('now'),julianday(NEW.checked_at)))) THEN RAISE(ABORT,'discovery-collection-stale-chain') END;
 SELECT CASE WHEN NEW.stage='capture' AND NOT EXISTS(SELECT 1 FROM discovery_collection_claims c JOIN discovery_source_plans p ON p.id=c.issued_plan_id WHERE c.id=NEW.claim_id AND p.id=NEW.plan_id AND p.lease_id=c.source_lease_id AND p.lease_fence=c.source_lease_fence AND p.lease_owner=c.owner AND julianday(p.deadline_at)<=julianday(c.processing_deadline_at)) THEN RAISE(ABORT,'discovery-collection-plan-binding') END;
END;
CREATE TABLE discovery_collection_pages(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,claim_id TEXT NOT NULL,round_id TEXT NOT NULL,slot_index INTEGER NOT NULL,chain_id TEXT NOT NULL,page_ordinal INTEGER NOT NULL,scope_sha256 TEXT NOT NULL,plan_id TEXT NOT NULL UNIQUE,representation_id TEXT NOT NULL,representation_revision INTEGER NOT NULL,representation_sha256 TEXT NOT NULL,lead_count INTEGER NOT NULL CHECK(lead_count BETWEEN 0 AND 100),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),UNIQUE(chain_id,page_ordinal));
CREATE TRIGGER discovery_collection_page_guard BEFORE INSERT ON discovery_collection_pages BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_collection_guards g JOIN discovery_collection_claims c ON c.id=g.claim_id JOIN discovery_collection_slots s ON s.round_id=c.round_id AND s.slot_index=c.slot_index JOIN discovery_evidence_operations e ON e.operation_id=g.operation_id JOIN discovery_evidence_contents body ON body.kind=e.kind AND body.id=e.id AND body.revision=e.revision JOIN discovery_source_captures captured ON captured.operation_id=e.operation_id WHERE g.operation_id=NEW.operation_id AND g.stage='capture' AND g.claim_id=NEW.claim_id AND g.plan_id=NEW.plan_id AND e.kind='representation' AND e.id=NEW.representation_id AND e.revision=NEW.representation_revision AND captured.settled=1 AND captured.plan_id=NEW.plan_id AND json_extract(body.payload_json,'$.originalBytesSha256')=NEW.representation_sha256 AND s.chain_id=NEW.chain_id AND s.scope_sha256=NEW.scope_sha256 AND NEW.page_ordinal=c.chain_page_count+1) THEN RAISE(ABORT,'discovery-collection-page-uncommitted-body') END;
END;
CREATE TABLE discovery_collection_leads(id TEXT PRIMARY KEY,page_id TEXT NOT NULL,scope_sha256 TEXT NOT NULL,ordinal INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),UNIQUE(page_id,ordinal));
CREATE TRIGGER discovery_collection_lead_guard BEFORE INSERT ON discovery_collection_leads BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_collection_pages p JOIN discovery_collection_guards g ON g.operation_id=p.operation_id WHERE p.id=NEW.page_id AND p.scope_sha256=NEW.scope_sha256 AND NEW.ordinal BETWEEN 0 AND p.lead_count-1) THEN RAISE(ABORT,'discovery-collection-lead-without-page') END;
END;
CREATE TABLE discovery_collection_tokens(chain_id TEXT NOT NULL,token_sha256 TEXT NOT NULL,scope_sha256 TEXT NOT NULL,page_ordinal INTEGER NOT NULL,PRIMARY KEY(chain_id,token_sha256));
CREATE TABLE discovery_collection_item_settlements(operation_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,scope_sha256 TEXT NOT NULL,reserved_items INTEGER NOT NULL,committed_items INTEGER NOT NULL,CHECK(reserved_items BETWEEN 1 AND 100 AND committed_items BETWEEN 0 AND reserved_items));
CREATE TRIGGER discovery_collection_items_guard BEFORE INSERT ON discovery_collection_item_settlements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_captures c JOIN discovery_source_attempts a ON a.id=c.attempt_id WHERE c.operation_id=NEW.operation_id AND c.settled=1 AND a.id=NEW.attempt_id AND a.max_items=NEW.reserved_items) THEN RAISE(ABORT,'discovery-collection-item-settlement-unbound') END;
END;
CREATE TABLE discovery_collection_health(source_id TEXT PRIMARY KEY,last_attempted_at TEXT,last_successful_at TEXT,last_complete_at TEXT,last_public_refresh_at TEXT CHECK(last_public_refresh_at IS NULL),last_good_receipt_id TEXT,last_good_scope_sha256 TEXT,outcome TEXT,code TEXT);
CREATE TABLE discovery_collection_operations(operation_id TEXT PRIMARY KEY,action TEXT NOT NULL,target_id TEXT NOT NULL,request_sha256 TEXT NOT NULL,result_kind TEXT NOT NULL,result_id TEXT NOT NULL,authority_json TEXT NOT NULL CHECK(json_valid(authority_json)));
CREATE TABLE discovery_collection_slot_outcomes(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,round_id TEXT NOT NULL,slot_index INTEGER NOT NULL,source_id TEXT NOT NULL,outcome TEXT NOT NULL,code TEXT NOT NULL,checked_at TEXT NOT NULL);
CREATE TRIGGER discovery_collection_commit_finish BEFORE INSERT ON discovery_collection_operations WHEN NEW.result_kind='page' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_collection_pages p JOIN discovery_collection_slots s ON s.round_id=p.round_id AND s.slot_index=p.slot_index JOIN discovery_collection_rounds r ON r.id=s.round_id JOIN discovery_collection_chains ch ON ch.id=p.chain_id WHERE p.id=NEW.result_id AND p.operation_id=NEW.operation_id AND s.state='finished' AND r.cursor>p.slot_index AND ch.page_count=p.page_ordinal AND ch.last_receipt_id=p.id AND (SELECT count(*) FROM discovery_collection_leads l WHERE l.page_id=p.id)=p.lead_count) THEN RAISE(ABORT,'discovery-collection-incomplete-page-commit') END;
END;
CREATE TABLE discovery_collection_assertions(id TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
CREATE TRIGGER discovery_collection_assertion_cleanup AFTER INSERT ON discovery_collection_assertions BEGIN DELETE FROM discovery_collection_assertions WHERE id=NEW.id; END;
-- Each copied source-bearing row owns its scope independently of registry rows,
-- so this trigger works in either order with the accepted registry removal hook.
CREATE TRIGGER discovery_collection_scope_remove AFTER INSERT ON discovery_evidence_revoked_scopes BEGIN
 UPDATE discovery_source_leases SET fence=fence+1,expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE EXISTS(SELECT 1 FROM discovery_collection_claims c JOIN discovery_collection_slots s ON s.claim_id=c.id WHERE c.scope_sha256=NEW.scope_key AND s.state='claimed' AND discovery_source_leases.id=c.source_lease_id AND discovery_source_leases.fence=c.source_lease_fence AND discovery_source_leases.owner=c.owner);
 UPDATE discovery_collection_slots SET state='revoked',fence=fence+1,outcome='permission-denied',code='collection-source-revoked' WHERE scope_sha256=NEW.scope_key AND state<>'finished';
 UPDATE discovery_collection_claims SET checkpoint=NULL,last_receipt_id=NULL WHERE scope_sha256=NEW.scope_key;
 UPDATE discovery_collection_bindings SET source_json=NULL,parameters_json=NULL WHERE scope_sha256=NEW.scope_key;
 DELETE FROM discovery_collection_leads WHERE scope_sha256=NEW.scope_key;
 DELETE FROM discovery_collection_pages WHERE scope_sha256=NEW.scope_key;
 DELETE FROM discovery_collection_tokens WHERE scope_sha256=NEW.scope_key;
 DELETE FROM discovery_collection_chains WHERE scope_sha256=NEW.scope_key;
 UPDATE discovery_collection_health SET last_good_receipt_id=NULL,last_good_scope_sha256=NULL,outcome='permission-denied',code='collection-source-revoked' WHERE last_good_scope_sha256=NEW.scope_key;
END;
