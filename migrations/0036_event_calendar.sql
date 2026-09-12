CREATE TABLE event_calendar_entries (
  event_id TEXT PRIMARY KEY, uid TEXT NOT NULL UNIQUE, sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 2147483647),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  revision_at TEXT NOT NULL, withdrawn INTEGER NOT NULL CHECK(withdrawn IN (0,1))
);
CREATE TABLE event_calendar_revisions (
  event_id TEXT NOT NULL REFERENCES event_calendar_entries(event_id), sequence INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), revision_at TEXT NOT NULL,
  PRIMARY KEY(event_id,sequence)
);
CREATE TABLE event_calendar_withdrawals (
  event_id TEXT PRIMARY KEY, withdrawn_at TEXT NOT NULL, restored_at TEXT,
  CHECK(restored_at IS NULL OR restored_at>withdrawn_at)
);
CREATE TABLE event_calendar_write_guards (
  id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TRIGGER event_calendar_history_immutable BEFORE UPDATE ON event_calendar_revisions
BEGIN SELECT RAISE(ABORT,'calendar-history-immutable'); END;
CREATE TRIGGER event_calendar_history_retained BEFORE DELETE ON event_calendar_revisions
BEGIN SELECT RAISE(ABORT,'calendar-history-retained'); END;
CREATE TRIGGER event_calendar_entry_monotonic BEFORE UPDATE ON event_calendar_entries
WHEN NEW.event_id<>OLD.event_id OR NEW.uid<>OLD.uid OR NEW.sequence<>OLD.sequence+1 OR NEW.revision_at<OLD.revision_at
BEGIN SELECT RAISE(ABORT,'calendar-revision-conflict'); END;

-- A calendar snapshot must still match publication state when its writes commit.
CREATE TABLE event_calendar_publication_clock (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0)
);
INSERT INTO event_calendar_publication_clock VALUES(1,0);
CREATE TRIGGER calendar_clock_published_content_insert AFTER INSERT ON published_content
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_published_content_update AFTER UPDATE ON published_content
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_published_content_delete AFTER DELETE ON published_content
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_publication_reconciliations_insert AFTER INSERT ON publication_reconciliations
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_publication_reconciliations_update AFTER UPDATE ON publication_reconciliations
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_publication_reconciliations_delete AFTER DELETE ON publication_reconciliations
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_content_candidates_insert AFTER INSERT ON content_candidates
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_content_candidates_update AFTER UPDATE ON content_candidates
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER calendar_clock_content_candidates_delete AFTER DELETE ON content_candidates
BEGIN UPDATE event_calendar_publication_clock SET revision=revision+1 WHERE singleton=1; END;
