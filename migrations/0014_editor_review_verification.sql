-- Preserve review freshness and the evidence decision that produced it.
ALTER TABLE content_candidates ADD COLUMN content_changed_at TEXT;
ALTER TABLE content_candidates ADD COLUMN claim_ledger_json TEXT;
ALTER TABLE content_candidates ADD COLUMN verification_json TEXT;
ALTER TABLE content_candidates ADD COLUMN verification_at TEXT;

CREATE INDEX content_candidates_review_freshness_idx
  ON content_candidates(queue_status, content_changed_at, first_seen_at, last_seen_at);
