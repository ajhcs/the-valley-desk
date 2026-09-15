-- Schema 0027, read-only. A relevance recommendation is not an editorial
-- disposition. Join milestones to the CURRENT content fingerprint so an old
-- development cannot satisfy acceptance of a new version. NULL latency means
-- no recorded editorial disposition, not zero elapsed time. Discovery and
-- last_seen_at are observation times, never relevance-attempt timestamps.
SELECT o.id, o.source_id, o.discovered_at, o.last_seen_at,
       o.detail_state, o.detail_hash, o.published_at AS source_action_at,
       o.policy_text_url, o.relevance_decision, o.relevance_reasons_json,
       o.content_item_id, c.queue_status, c.last_run_id,
       m.outcome, m.rule, m.recorded_at AS editorial_disposition_at,
       ROUND((julianday(m.recorded_at) - julianday(o.discovered_at)) * 86400, 3)
         AS discovery_to_disposition_seconds,
       m.citations_json, p.first_published_at
FROM official_source_candidates o
LEFT JOIN content_candidates c ON c.id = o.content_item_id
LEFT JOIN policy_review_milestones m
  ON m.candidate_id = c.id AND m.fingerprint = c.fingerprint
LEFT JOIN published_content p ON p.candidate_id = c.id
WHERE o.source_id IN ('ofs-pa-legislature-hb1925', 'ofs-pa-legislature-sb1113', 'ofs-pa-legislature-hb1993')
ORDER BY o.source_id, m.recorded_at;

-- Compare the actual version rows/hashes with the prior observation too.
-- a zero duplicate count without a repeated unchanged snapshot is not proof.
SELECT i.instrument_id, i.session, v.version_id, v.stage, v.development_at,
       v.text_url, v.detail_hash, v.first_seen_at, v.last_seen_at, v.evidence_json
FROM policy_versions v JOIN policy_instruments i ON i.id = v.instrument_row_id
WHERE i.jurisdiction = 'PA' AND i.instrument_id IN ('HB 1925', 'SB 1113', 'HB 1993')
ORDER BY i.instrument_id, v.development_at;

SELECT instrument_row_id, version_id, stage, development_at, COUNT(*) AS duplicate_count
FROM policy_versions
GROUP BY instrument_row_id, version_id, stage, development_at
HAVING COUNT(*) > 1;
