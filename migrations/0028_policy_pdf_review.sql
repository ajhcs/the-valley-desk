-- Additive only. No imports, schedule changes, publication, or historical repair.
CREATE TABLE policy_pdf_artifacts (
  id TEXT PRIMARY KEY,
  version_row_id TEXT NOT NULL REFERENCES policy_versions(id),
  sha256 TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 1 AND 5000000),
  source_url TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  page_count INTEGER CHECK(page_count BETWEEN 1 AND 500),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
  extraction_sha256 TEXT,
  extraction_error TEXT,
  UNIQUE(version_row_id, sha256)
);
CREATE TABLE policy_pdf_chunks (
  artifact_id TEXT NOT NULL REFERENCES policy_pdf_artifacts(id),
  chunk_index INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY(artifact_id, chunk_index)
);
CREATE TABLE policy_pdf_pages (
  artifact_id TEXT NOT NULL REFERENCES policy_pdf_artifacts(id),
  page_number INTEGER NOT NULL CHECK(page_number BETWEEN 1 AND 500),
  lines_json TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  render_sha256 TEXT NOT NULL,
  render_png BLOB NOT NULL,
  renderer TEXT NOT NULL,
  PRIMARY KEY(artifact_id, page_number)
);
CREATE TABLE policy_provisions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES policy_pdf_artifacts(id),
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  UNIQUE(artifact_id, ordinal)
);
CREATE TABLE policy_provision_reviews (
  id TEXT PRIMARY KEY,
  provision_id TEXT NOT NULL REFERENCES policy_provisions(id),
  evidence_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','hold')),
  summary TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX policy_pdf_versions_idx ON policy_pdf_artifacts(version_row_id,captured_at);
CREATE INDEX policy_provision_reviews_idx ON policy_provision_reviews(provision_id,reviewed_at);

-- Enforce bounds across concurrent authenticated requests, not only in JS.
CREATE TRIGGER policy_pdf_capacity BEFORE INSERT ON policy_pdf_artifacts
WHEN NOT EXISTS (SELECT 1 FROM policy_pdf_artifacts WHERE id=NEW.id)
 AND (SELECT COUNT(*) FROM policy_pdf_artifacts WHERE version_row_id=NEW.version_row_id)>=8
BEGIN SELECT RAISE(ABORT,'artifact-capacity-hold'); END;
CREATE TRIGGER policy_pdf_complete_pages BEFORE UPDATE OF state ON policy_pdf_artifacts
WHEN NEW.state='complete' AND (
 NEW.page_count IS NULL OR
 (SELECT COUNT(*) FROM policy_pdf_pages WHERE artifact_id=NEW.id)<>NEW.page_count OR
 (SELECT MAX(page_number) FROM policy_pdf_pages WHERE artifact_id=NEW.id)<>NEW.page_count)
BEGIN SELECT RAISE(ABORT,'incomplete-extraction'); END;
CREATE TRIGGER policy_pdf_no_late_pages BEFORE INSERT ON policy_pdf_pages
WHEN (SELECT state FROM policy_pdf_artifacts WHERE id=NEW.artifact_id)='complete'
 AND NOT EXISTS (SELECT 1 FROM policy_pdf_pages WHERE artifact_id=NEW.artifact_id AND page_number=NEW.page_number)
BEGIN SELECT RAISE(ABORT,'extraction-immutable'); END;
