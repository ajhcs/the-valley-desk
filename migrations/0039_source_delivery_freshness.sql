-- Collection success is not primary health or article publication freshness.
-- Historical mixed-path timestamps cannot be safely backfilled.
ALTER TABLE source_health ADD COLUMN last_primary_success_at TEXT;
ALTER TABLE source_health ADD COLUMN last_fallback_success_at TEXT;
