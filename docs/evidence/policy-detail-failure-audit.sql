-- Read-only release/production audit for the policy detail-failure population.
-- The first inspection found 38 policy rows. The 2026-09-06 reconciliation
-- found 26 still failed: 20 CMS canonical-host redirects and six navigation
-- links outside their registered policy paths.

SELECT
  source_id,
  detail_state,
  detail_error,
  COUNT(*) AS affected_records,
  MIN(detail_attempted_at) AS first_attempt,
  MAX(detail_attempted_at) AS latest_attempt
FROM official_source_candidates
WHERE category = 'policy'
  AND detail_state IN ('failed', 'blocked')
  AND detail_disposition = 'active'
GROUP BY source_id, detail_state, detail_error
ORDER BY affected_records DESC, source_id;

SELECT
  id,
  source_id,
  url,
  detail_state,
  detail_error,
  detail_attempt_count,
  detail_attempted_at,
  detail_next_attempt_at,
  detail_disposition,
  detail_disposition_reason
FROM official_source_candidates
WHERE category = 'policy'
  AND (detail_state IN ('failed', 'blocked') OR detail_disposition = 'filtered')
ORDER BY source_id, id;
