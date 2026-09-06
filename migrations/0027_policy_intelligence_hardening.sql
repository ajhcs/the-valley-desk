-- Durable recovery evidence and source publication provenance. Recovery
-- observations are kept separately from the failure that opened an incident.

ALTER TABLE operational_alerts ADD COLUMN recovery_detail_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE official_source_candidates ADD COLUMN published_at TEXT;
ALTER TABLE official_source_candidates ADD COLUMN publication_date_source TEXT;
ALTER TABLE official_source_candidates ADD COLUMN policy_text_url TEXT;
ALTER TABLE official_source_candidates ADD COLUMN detail_disposition TEXT NOT NULL DEFAULT 'active'
  CHECK (detail_disposition IN ('active', 'filtered'));
ALTER TABLE official_source_candidates ADD COLUMN detail_disposition_reason TEXT;

-- The policy-critical registry now checks these sources every 30 minutes. Pull
-- forward only healthy/pending schedules so existing daily next-attempt values
-- cannot defer the first post-deploy check beyond the 60-minute detection SLO.
-- Failed, blocked, and hostile rows keep their evidence-backed backoff.
UPDATE official_source_schedule
SET next_attempt_at = MIN(
  next_attempt_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
WHERE source_id IN (
  'ofs-pa-legislature-hb1925',
  'ofs-pa-legislature-sb1113',
  'ofs-pa-legislature-hb1993',
  'ofs-pa-legislature-ai-topic',
  'ofs-pa-house-health-committee',
  'ofs-pa-senate-health-committee',
  'ofs-hap-health-it-advocacy',
  'ofs-ncsl-ai-legislation'
) AND state IN ('pending', 'success', 'unchanged');

-- Retire already-discovered navigation links that caused six of the live
-- policy detail failures. The twenty CMS newsroom rows remain active and can
-- recover through the registered apex/www redirect rule.
UPDATE official_source_candidates
SET detail_disposition = 'filtered',
    detail_disposition_reason = 'outside-registered-policy-path',
    detail_next_attempt_at = NULL
WHERE detail_state = 'failed' AND (
  (source_id = 'ofs-cms-newsroom' AND url NOT LIKE 'https://cms.gov/newsroom/%' AND url NOT LIKE 'https://www.cms.gov/newsroom/%') OR
  (source_id = 'ofs-de-newsroom' AND url NOT LIKE 'https://dhss.delaware.gov/newsroom/%') OR
  (source_id IN ('ofs-nj-health', 'ofs-nj-notices') AND url NOT LIKE 'https://nj.gov/health/%' AND url NOT LIKE 'https://www.nj.gov/health/%')
);

CREATE INDEX official_source_candidates_published_idx
  ON official_source_candidates(published_at DESC, category, status)
  WHERE published_at IS NOT NULL;

CREATE TABLE policy_instruments (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('PA', 'NJ', 'DE', 'regional', 'federal')),
  session TEXT,
  instrument_id TEXT NOT NULL,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  current_version_id TEXT,
  current_stage TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(jurisdiction, session, instrument_id)
);

CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  instrument_row_id TEXT NOT NULL,
  version_id TEXT,
  stage TEXT NOT NULL,
  development_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  text_url TEXT,
  detail_hash TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (instrument_row_id) REFERENCES policy_instruments(id),
  UNIQUE(instrument_row_id, version_id, stage, development_at)
);

CREATE INDEX policy_versions_instrument_idx
  ON policy_versions(instrument_row_id, development_at DESC);

CREATE TABLE policy_review_milestones (
  candidate_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('brief', 'blocker')),
  rule TEXT NOT NULL,
  source_development_at TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, fingerprint, outcome),
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id) ON DELETE CASCADE
);

CREATE INDEX policy_review_milestones_timing_idx
  ON policy_review_milestones(outcome, source_development_at, recorded_at);

CREATE TABLE policy_benchmark_leads (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  first_public_at TEXT NOT NULL,
  correspondence_at TEXT NOT NULL,
  detected_at TEXT,
  brief_or_blocker_at TEXT,
  miss_reason TEXT,
  source_urls_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Preserve the original bounded raw_size column and every referencing row.
-- wire_size records the exact platform-reported message size up to the new
-- ceiling; raw MIME is still never stored. This additive shape avoids a parent
-- table rebuild that could cascade-delete existing signal pointers.
ALTER TABLE email_discoveries ADD COLUMN wire_size INTEGER
  CHECK (wire_size IS NULL OR (wire_size >= 0 AND wire_size <= 5000000));
ALTER TABLE email_discoveries ADD COLUMN auth_provenance_json TEXT;
ALTER TABLE email_discoveries ADD COLUMN auth_provenance_sha256 TEXT;
ALTER TABLE email_discoveries ADD COLUMN auth_state TEXT NOT NULL DEFAULT 'legacy'
  CHECK (auth_state IN ('legacy', 'pending', 'authenticated', 'rejected', 'failed', 'exhausted'));
ALTER TABLE email_discoveries ADD COLUMN auth_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (auth_attempt_count >= 0);
ALTER TABLE email_discoveries ADD COLUMN auth_attempted_at TEXT;
ALTER TABLE email_discoveries ADD COLUMN auth_next_attempt_at TEXT;
ALTER TABLE email_discoveries ADD COLUMN auth_error TEXT;
UPDATE email_discoveries SET wire_size = raw_size WHERE wire_size IS NULL;
-- Pre-0027 `authenticated-pointer` values were derived from sender-controlled
-- MIME Authentication-Results headers. They cannot be grandfathered into the
-- Analytics-receipt trust model. Preserve the rows and child evidence, but
-- fail them closed until a new message is correlated to a platform receipt.
UPDATE email_discoveries
SET auth_state = 'legacy',
    trust_state = 'untrusted-pointer',
    status = CASE WHEN status = 'review' THEN 'ignored' ELSE status END,
    auth_error = 'Legacy row has no Cloudflare Email Routing Analytics receipt';

CREATE INDEX email_discoveries_auth_due_idx
  ON email_discoveries(auth_state, auth_next_attempt_at, first_seen_at);

CREATE TABLE email_pdf_attachments (
  id TEXT PRIMARY KEY,
  discovery_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  byte_count INTEGER NOT NULL CHECK (byte_count > 0 AND byte_count <= 3000000),
  sha256 TEXT NOT NULL,
  extraction_state TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_state IN ('pending', 'complete', 'failed')),
  extraction_error TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  extraction_method TEXT,
  extraction_receipt_sha256 TEXT,
  extracted_by TEXT,
  created_at TEXT NOT NULL,
  extracted_at TEXT,
  FOREIGN KEY (discovery_id) REFERENCES email_discoveries(id) ON DELETE CASCADE,
  UNIQUE(discovery_id, sha256)
);

CREATE TABLE email_pdf_attachment_chunks (
  attachment_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  bytes BLOB NOT NULL,
  PRIMARY KEY (attachment_id, chunk_index),
  FOREIGN KEY (attachment_id) REFERENCES email_pdf_attachments(id) ON DELETE CASCADE
);

CREATE TABLE email_pdf_pages (
  attachment_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  text TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (attachment_id, page_number),
  FOREIGN KEY (attachment_id) REFERENCES email_pdf_attachments(id) ON DELETE CASCADE
);

CREATE INDEX email_pdf_attachments_extraction_idx
  ON email_pdf_attachments(extraction_state, created_at);

CREATE TABLE policy_advocacy_records (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  organization TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('support', 'oppose', 'concerns', 'neutral')),
  published_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(instrument_id, organization, published_at, source_url)
);

CREATE TABLE policy_supporting_evidence (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  artifact_sha256 TEXT,
  page_evidence_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(source_url, published_at, artifact_sha256)
);
