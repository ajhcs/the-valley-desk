-- Durable recovery state for operational alert noise control. Recovery is
-- intentionally consecutive and persisted in D1 so Worker isolate changes
-- cannot reopen, resolve, or reset alert state accidentally.

ALTER TABLE operational_alerts ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0
  CHECK (recovery_count >= 0);
ALTER TABLE operational_alerts ADD COLUMN last_recovered_at TEXT;

CREATE INDEX operational_alerts_recovery_idx
  ON operational_alerts(state, recovery_count, last_recovered_at);
