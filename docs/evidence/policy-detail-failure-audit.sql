-- Read-only release/production audit for the policy detail-failure population.
-- The first inspection found 38 policy rows. Migration 0027 subsequently
-- classified known off-path navigation rows as filtered, while later source
-- runs can add or recover failures. Do not treat a historical fixed count as
-- the contract: the first query is the current actionable population and the
-- second keeps filtered rows visible for reconciliation.
--
-- Timestamp semantics in schema 0027:
--   discovered_at       = the candidate's first listing discovery.
--   last_seen_at        = the most recent listing observation.
--   detail_fetched_at   = the latest retained detail-fetch attempt start,
--                         including a failed/blocked attempt.
-- The schema does not retain the first detail-attempt timestamp or an attempt
-- history. first_detail_attempt_at is therefore reported as NULL below.

SELECT
  source_id,
  detail_state,
  detail_error,
  detail_disposition,
  detail_disposition_reason,
  COUNT(*) AS affected_records,
  MIN(discovered_at) AS earliest_discovered_at,
  MAX(last_seen_at) AS latest_listing_seen_at,
  MAX(detail_fetched_at) AS latest_retained_detail_attempt_at,
  NULL AS first_detail_attempt_at
FROM official_source_candidates
WHERE category = 'policy'
  AND detail_state IN ('failed', 'blocked')
  AND detail_disposition = 'active'
GROUP BY source_id, detail_state, detail_error, detail_disposition, detail_disposition_reason
ORDER BY affected_records DESC, source_id;

SELECT
  id,
  source_id,
  url,
  detail_state,
  detail_error,
  detail_attempt_count,
  discovered_at AS first_discovered_at,
  last_seen_at AS latest_listing_seen_at,
  detail_fetched_at AS latest_retained_detail_attempt_at,
  NULL AS first_detail_attempt_at,
  detail_next_attempt_at,
  detail_disposition,
  detail_disposition_reason
FROM official_source_candidates
WHERE category = 'policy'
  AND (detail_state IN ('failed', 'blocked') OR detail_disposition = 'filtered')
ORDER BY source_id, id;
