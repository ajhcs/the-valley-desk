CREATE TABLE watch_source_rule_dispatch (
  id TEXT PRIMARY KEY CHECK(id='default'),
  after_draft_id TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL))
);
INSERT INTO watch_source_rule_dispatch VALUES('default','',NULL,NULL);
