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
CREATE TRIGGER event_calendar_history_immutable BEFORE UPDATE ON event_calendar_revisions
BEGIN SELECT RAISE(ABORT,'calendar-history-immutable'); END;
CREATE TRIGGER event_calendar_history_retained BEFORE DELETE ON event_calendar_revisions
BEGIN SELECT RAISE(ABORT,'calendar-history-retained'); END;
CREATE TRIGGER event_calendar_entry_monotonic BEFORE UPDATE ON event_calendar_entries
WHEN NEW.event_id<>OLD.event_id OR NEW.uid<>OLD.uid OR NEW.sequence<>OLD.sequence+1 OR NEW.revision_at<OLD.revision_at OR NEW.withdrawn<OLD.withdrawn
BEGIN SELECT RAISE(ABORT,'calendar-revision-conflict'); END;

