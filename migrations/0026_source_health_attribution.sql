-- Keep source-health records tied to the canonical institution registry when a
-- source has an unambiguous coverage mapping. Existing rows remain valid and
-- are intentionally backfilled as unknown rather than guessed.

ALTER TABLE source_health ADD COLUMN institution_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX source_health_institution_idx
  ON source_health(institution_ids_json, state, last_checked_at DESC);
