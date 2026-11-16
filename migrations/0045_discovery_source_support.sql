-- Private removal-only native edit consumer. No admission/public bridge is enabled.
CREATE TABLE discovery_source_support_events(operation_id TEXT PRIMARY KEY,binding_key TEXT NOT NULL,root_count INTEGER NOT NULL,conservative_count INTEGER NOT NULL);
CREATE TABLE discovery_source_support_watermarks(
 binding_key TEXT PRIMARY KEY,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,installation TEXT NOT NULL,scope_id TEXT NOT NULL,
 configuration_id TEXT NOT NULL,configuration_revision INTEGER NOT NULL,topic_id INTEGER NOT NULL,post_id INTEGER NOT NULL,
 version INTEGER NOT NULL,captured_at TEXT NOT NULL,post_sha256 TEXT NOT NULL,operation_id TEXT NOT NULL,
 representation_id TEXT NOT NULL,representation_revision INTEGER NOT NULL,post_pointer TEXT NOT NULL,source_generation INTEGER NOT NULL,qualification_id TEXT NOT NULL
);
CREATE TRIGGER discovery_source_support_event_guard BEFORE INSERT ON discovery_source_support_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.operation_id=NEW.operation_id AND g.kind='source-change' AND json_extract(g.plan_json,'$.action')='invalidate-source-support' AND json_extract(g.plan_json,'$.sourceSupport.bindingKey')=NEW.binding_key AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-source-support-guard-required') END;
END;
CREATE TRIGGER discovery_source_support_watermark_insert BEFORE INSERT ON discovery_source_support_watermarks BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_support_events e JOIN discovery_evidence_guards g ON g.operation_id=e.operation_id WHERE e.operation_id=NEW.operation_id AND e.binding_key=NEW.binding_key AND g.kind='source-change' AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-source-support-guard-required') END;
END;
CREATE TRIGGER discovery_source_support_watermark_update BEFORE UPDATE ON discovery_source_support_watermarks BEGIN
 SELECT CASE WHEN NEW.binding_key<>OLD.binding_key OR NEW.source_id<>OLD.source_id OR NEW.source_revision<>OLD.source_revision OR NEW.installation<>OLD.installation OR NEW.scope_id<>OLD.scope_id OR NEW.configuration_id<>OLD.configuration_id OR NEW.configuration_revision<>OLD.configuration_revision OR NEW.topic_id<>OLD.topic_id OR NEW.post_id<>OLD.post_id OR NEW.source_generation<>OLD.source_generation OR NEW.qualification_id<>OLD.qualification_id OR NEW.version<=OLD.version OR julianday(NEW.captured_at)<=julianday(OLD.captured_at) OR NOT EXISTS(SELECT 1 FROM discovery_source_support_events e JOIN discovery_evidence_guards g ON g.operation_id=e.operation_id WHERE e.operation_id=NEW.operation_id AND e.binding_key=NEW.binding_key AND NOT EXISTS(SELECT 1 FROM discovery_evidence_operations o WHERE o.operation_id=g.operation_id)) THEN RAISE(ABORT,'discovery-source-support-stale-watermark') END;
END;
CREATE TRIGGER discovery_source_support_watermark_delete BEFORE DELETE ON discovery_source_support_watermarks BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_source_support_event_update BEFORE UPDATE ON discovery_source_support_events BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;
CREATE TRIGGER discovery_source_support_event_delete BEFORE DELETE ON discovery_source_support_events BEGIN SELECT RAISE(ABORT,'discovery-evidence-immutable'); END;

CREATE TRIGGER discovery_source_support_change_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='source-change' BEGIN
 SELECT CASE WHEN json_extract(NEW.plan_json,'$.action') IS NOT 'invalidate-source-support' THEN RAISE(ABORT,'discovery-source-support-authority') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND
  (SELECT version FROM discovery_source_support_watermarks WHERE binding_key=json_extract(NEW.plan_json,'$.sourceSupport.bindingKey')) IS NOT json_extract(NEW.plan_json,'$.sourceSupport.expectedVersion') THEN RAISE(ABORT,'discovery-source-support-stale-watermark') END;
 -- Immutable capture IDs/hashes pin the complete source inventory, including captures without page acknowledgements.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND (
  (SELECT count(*) FROM discovery_source_captures c JOIN discovery_source_plans p ON p.id=c.plan_id JOIN discovery_evidence_revisions r ON r.kind='representation' AND r.id=c.representation_id AND r.revision=c.representation_revision WHERE p.source_id=json_extract(NEW.plan_json,'$.sourceSupport.sourceId'))<>json_array_length(NEW.plan_json,'$.sourceSupport.inventory') OR
  EXISTS(SELECT 1 FROM json_each(NEW.plan_json,'$.sourceSupport.inventory') i WHERE NOT EXISTS(
   SELECT 1 FROM discovery_source_captures c JOIN discovery_source_plans p ON p.id=c.plan_id JOIN discovery_evidence_revisions r ON r.kind='representation' AND r.id=c.representation_id AND r.revision=c.representation_revision
   WHERE p.source_id=json_extract(NEW.plan_json,'$.sourceSupport.sourceId') AND r.id=json_extract(i.value,'$.id') AND r.revision=json_extract(i.value,'$.revision') AND r.content_sha256=json_extract(i.value,'$.sha256')))
 ) THEN RAISE(ABORT,'discovery-source-support-inventory-changed') END;
END;
CREATE TRIGGER discovery_source_support_change_finish BEFORE INSERT ON discovery_evidence_operations WHEN NEW.kind='source-change' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_source_support_events WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM discovery_evidence_guards g WHERE g.operation_id=NEW.operation_id AND (json_extract(g.capability_json,'$.action') IS NOT 'invalidate-source-support' OR julianday(json_extract(g.capability_json,'$.expiresAt'))<=max(julianday('now'),julianday(g.checked_at)))) THEN RAISE(ABORT,'discovery-source-support-incomplete-or-expired') END;
END;

-- A watermark suppresses future uses even for a new evidence ID or a later retained
-- copy of an older native version. Exact native array indices are resolved in THIS
-- representation. Existing appendEvidence validates RFC6901 pointers and values.
CREATE TRIGGER discovery_source_support_evidence_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='evidence' BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM discovery_evidence_contents r JOIN discovery_source_support_watermarks m ON m.source_id=json_extract(r.payload_json,'$.materialScope.sourceId')
  WHERE r.kind='representation' AND r.id=json_extract(NEW.plan_json,'$.sourceSupportRepresentation.id') AND r.revision=json_extract(NEW.plan_json,'$.sourceSupportRepresentation.revision') AND (
   json_extract(r.payload_json,'$.materialScope.installation') IS NOT m.installation OR json_extract(r.payload_json,'$.materialScope.scopeId') IS NOT m.scope_id OR
   NOT EXISTS(SELECT 1 FROM discovery_source_captures capture JOIN discovery_source_plans plan ON plan.id=capture.plan_id WHERE capture.representation_id=r.id AND capture.representation_revision=r.revision AND plan.source_id=m.source_id AND plan.source_revision=m.source_revision) OR
   NOT EXISTS(SELECT 1 FROM discovery_source_heads head WHERE head.source_id=m.source_id AND head.revision=m.source_revision AND head.generation=m.source_generation AND head.qualification_id=m.qualification_id AND head.active=1) OR
   json_extract(r.payload_json,'$.configuration.id') IS NOT m.configuration_id OR json_extract(r.payload_json,'$.configuration.revision') IS NOT m.configuration_revision OR
   (
    (json_extract(NEW.plan_json,'$.sourceSupportSelector.kind')='text-span' OR json_extract(NEW.plan_json,'$.sourceSupportSelector.pointer') IN ('','/post_stream','/post_stream/posts') OR EXISTS(
      SELECT 1 FROM json_each(r.payload_json,'$.structured.post_stream.posts') post WHERE json_extract(post.value,'$.id')=m.post_id AND (
       json_extract(NEW.plan_json,'$.sourceSupportSelector.pointer')='/post_stream/posts/'||post.key OR instr(json_extract(NEW.plan_json,'$.sourceSupportSelector.pointer'),'/post_stream/posts/'||post.key||'/')=1)))
    AND NOT EXISTS(SELECT 1 FROM json_each(r.payload_json,'$.structured.post_stream.posts') post WHERE json_extract(post.value,'$.id')=m.post_id AND json_extract(post.value,'$.topic_id')=m.topic_id AND json_type(post.value,'$.version')='integer' AND (
      (json_extract(post.value,'$.version')>m.version AND julianday(json_extract(r.payload_json,'$.capturedAt'))>julianday(m.captured_at)) OR
      (json_extract(post.value,'$.version')=m.version AND EXISTS(SELECT 1 FROM discovery_evidence_contents fresh WHERE fresh.kind='representation' AND fresh.id=m.representation_id AND fresh.revision=m.representation_revision AND json_extract(fresh.payload_json,'$.structured.post_stream.posts['||substr(m.post_pointer,20)||']')=json(post.value)))
    ))
   )
  )
 ) THEN RAISE(ABORT,'discovery-source-support-stale-evidence') END;
END;
CREATE TRIGGER discovery_source_support_unmapped_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='source-change' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND EXISTS(
  SELECT 1 FROM json_each(NEW.plan_json,'$.sourceSupport.unmapped') u JOIN discovery_evidence_edges e
   ON e.source_kind='representation' AND e.source_id=json_extract(u.value,'$.id') AND e.source_revision=json_extract(u.value,'$.revision')
  WHERE e.dependent_kind='evidence'
 ) THEN RAISE(ABORT,'discovery-source-support-unmapped-history') END;
END;
-- This is the final statement of mutate, after composed source/control checks.
CREATE TRIGGER discovery_source_support_complete BEFORE DELETE ON discovery_evidence_guards WHEN OLD.kind='source-change' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=OLD.operation_id AND request_sha256=OLD.request_sha256 AND action='invalidate-source-support') OR
  json_extract(OLD.capability_json,'$.action') IS NOT 'invalidate-source-support' OR json_extract(OLD.capability_json,'$.requestSha256') IS NOT OLD.request_sha256 OR
  json_extract(OLD.capability_json,'$.operationId') IS NOT OLD.operation_id OR json_extract(OLD.capability_json,'$.targetId') IS NOT OLD.id OR
  julianday(json_extract(OLD.capability_json,'$.expiresAt')) IS NULL OR julianday(json_extract(OLD.capability_json,'$.expiresAt'))<=max(julianday('now'),julianday(OLD.checked_at)) OR
  NOT EXISTS(SELECT 1 FROM discovery_source_heads h WHERE h.source_id=json_extract(OLD.plan_json,'$.sourceSupport.sourceId') AND h.revision=json_extract(OLD.plan_json,'$.sourceSupport.sourceRevision') AND h.generation=json_extract(OLD.plan_json,'$.sourceSupport.sourceGeneration') AND h.qualification_id=json_extract(OLD.plan_json,'$.sourceSupport.qualificationId') AND h.active=1)
  THEN RAISE(ABORT,'discovery-source-support-final-authority') END;
END;

CREATE TRIGGER discovery_source_support_frame_guard BEFORE INSERT ON discovery_evidence_guards WHEN NEW.kind='source-change' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discovery_evidence_operations WHERE operation_id=NEW.operation_id) AND NOT EXISTS(
  SELECT 1 FROM discovery_source_heads h WHERE h.source_id=json_extract(NEW.plan_json,'$.sourceSupport.sourceId') AND h.revision=json_extract(NEW.plan_json,'$.sourceSupport.sourceRevision') AND h.generation=json_extract(NEW.plan_json,'$.sourceSupport.sourceGeneration') AND h.qualification_id=json_extract(NEW.plan_json,'$.sourceSupport.qualificationId') AND h.active=1
 ) THEN RAISE(ABORT,'discovery-source-support-frame-changed') END;
END;
