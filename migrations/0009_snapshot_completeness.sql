ALTER TABLE source_health ADD COLUMN completeness TEXT NOT NULL DEFAULT 'partial'
  CHECK (completeness IN ('complete', 'partial', 'empty-unverified'));

UPDATE source_health
SET completeness = CASE
  WHEN state IN ('healthy', 'healthy-empty') AND complete = 1 AND item_count > 0 THEN 'complete'
  WHEN state = 'healthy-empty' OR item_count <= 0 THEN 'empty-unverified'
  ELSE 'partial'
END;
