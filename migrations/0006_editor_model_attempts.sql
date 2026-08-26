-- Persist editor-model attempt outcomes so unchanged successful enrichments
-- stay reusable and unchanged failures can cool down across hourly runs.
ALTER TABLE content_candidates ADD COLUMN enrichment_fingerprint TEXT;
ALTER TABLE content_candidates ADD COLUMN enrichment_attempted_at TEXT;
ALTER TABLE content_candidates ADD COLUMN enrichment_outcome TEXT;
ALTER TABLE content_candidates ADD COLUMN enrichment_error TEXT;
ALTER TABLE content_candidates ADD COLUMN enrichment_attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX content_candidates_model_attempt_idx
  ON content_candidates(enrichment_outcome, enrichment_attempted_at, first_seen_at);
