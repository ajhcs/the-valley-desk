ALTER TABLE official_source_candidates ADD COLUMN detail_final_url TEXT;
ALTER TABLE official_source_candidates ADD COLUMN detail_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (detail_attempt_count >= 0);
ALTER TABLE official_source_candidates ADD COLUMN detail_next_attempt_at TEXT;
ALTER TABLE official_source_candidates ADD COLUMN relevance_model TEXT;
ALTER TABLE official_source_candidates ADD COLUMN relevance_prompt_version TEXT;

CREATE INDEX official_source_candidates_detail_retry_idx
  ON official_source_candidates(detail_next_attempt_at, detail_state, last_seen_at);
