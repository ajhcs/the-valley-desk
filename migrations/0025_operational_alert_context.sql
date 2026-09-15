-- Normalize the condition represented by an operational alert without
-- changing the existing open/resolved incident lifecycle. The new dimensions
-- let /ops group related failures while preserving every existing fingerprint.

ALTER TABLE operational_alerts ADD COLUMN condition_state TEXT NOT NULL DEFAULT 'failed'
  CHECK (condition_state IN ('healthy', 'degraded', 'blocked', 'backoff', 'failed', 'resolved'));
ALTER TABLE operational_alerts ADD COLUMN institution_id TEXT;
ALTER TABLE operational_alerts ADD COLUMN subsystem TEXT NOT NULL DEFAULT 'automation';
ALTER TABLE operational_alerts ADD COLUMN group_key TEXT NOT NULL DEFAULT 'valley-desk:legacy';

UPDATE operational_alerts
SET condition_state = CASE
  WHEN state = 'resolved' THEN 'resolved'
  WHEN severity = 'warning' THEN 'degraded'
  WHEN severity = 'info' THEN 'healthy'
  ELSE 'failed'
END,
group_key = 'valley-desk:legacy:' || substr(fingerprint, 1, 80);

CREATE INDEX operational_alerts_group_idx
  ON operational_alerts(pack_id, group_key, state, last_seen_at DESC);
CREATE INDEX operational_alerts_condition_idx
  ON operational_alerts(condition_state, state, last_seen_at DESC);
