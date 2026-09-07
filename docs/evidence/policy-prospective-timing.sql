-- Read-only schema-0027 observation contract. No backoff or timestamps change.
-- first_seen_at belongs to the durable development/version, not a new scrape.
-- Date-only development_at is NOT a precise first-public timestamp. An operator
-- must establish genuinely new official material before including a new sample.
-- Historical versions cannot inherit a current version's editorial fingerprint.
SELECT v.id AS development_id, i.instrument_id, i.session, v.version_id,
       v.stage AS legislative_stage, v.development_at, v.first_seen_at AS discovered_at,
       v.last_seen_at, v.source_url, v.text_url,
       s.id AS discovery_candidate_id,
       s.detail_disposition AS current_discovery_disposition,
       s.detail_state AS current_discovery_detail_state,
       s.relevance_decision AS current_discovery_relevance,
       s.relevance_reasons_json AS current_discovery_reasons_json,
       c.id AS candidate_id, c.fingerprint, c.queue_status,
       m.outcome, m.rule, m.citations_json, m.recorded_at,
       m.fingerprint AS milestone_fingerprint,
       CASE
         WHEN c.id IS NOT NULL AND m.candidate_id IS NOT NULL THEN 'editorial-milestone'
         WHEN c.id IS NOT NULL THEN 'editorial-review'
         ELSE 'unadmitted-or-historical-version'
       END AS processing_stage
FROM policy_versions v
JOIN policy_instruments i ON i.id = v.instrument_row_id
LEFT JOIN official_source_candidates s ON s.url = i.canonical_url AND s.category = 'policy'
LEFT JOIN content_candidates c ON c.id = s.content_item_id
  AND json_extract(c.content_json, '$.policyIdentity.jurisdiction') = i.jurisdiction
  AND json_extract(c.content_json, '$.policyIdentity.instrumentId') = i.instrument_id
  AND json_extract(c.content_json, '$.policyIdentity.session') = i.session
  AND json_extract(c.content_json, '$.policyIdentity.versionId') = v.version_id
  AND json_extract(c.content_json, '$.policyIdentity.stage') = v.stage
  AND json_extract(c.content_json, '$.policyIdentity.developmentAt') = v.development_at
LEFT JOIN policy_review_milestones m ON m.candidate_id = c.id
  AND m.fingerprint = c.fingerprint AND m.source_development_at = v.development_at
  AND m.rowid = (
    SELECT m2.rowid FROM policy_review_milestones m2
    WHERE m2.candidate_id = c.id AND m2.fingerprint = c.fingerprint
      AND m2.source_development_at = v.development_at
    ORDER BY m2.recorded_at, m2.outcome LIMIT 1
  )
ORDER BY v.first_seen_at, v.id;
