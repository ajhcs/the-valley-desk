-- Stamp project imports and edits in the same transaction as the listing change.
CREATE TABLE directory_project_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL
);
INSERT INTO directory_project_revision VALUES (1, lower(hex(randomblob(16))));

CREATE TRIGGER directory_project_revision_insert AFTER INSERT ON research_listings
WHEN NEW.kind = 'project'
BEGIN
  UPDATE directory_project_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;

CREATE TRIGGER directory_project_revision_update AFTER UPDATE OF id, kind, record ON research_listings
WHEN (OLD.kind = 'project' OR NEW.kind = 'project')
  AND (OLD.id IS NOT NEW.id OR OLD.kind IS NOT NEW.kind OR OLD.record IS NOT NEW.record)
BEGIN
  UPDATE directory_project_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;

CREATE TRIGGER directory_project_revision_delete AFTER DELETE ON research_listings
WHEN OLD.kind = 'project'
BEGIN
  UPDATE directory_project_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;
