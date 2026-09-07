-- SELECT only; schema 0028. Each row is a retained artifact (or an uncaptured
-- version). Stored hashes are identifiers, not a SQL recomputation of PDF bytes.
-- Legislative dates, first discovery, last observation and capture are distinct.
SELECT i.instrument_id AS bill, i.session, v.id AS version_row_id,
       v.version_id AS printer, v.development_at AS legislative_action_at,
       v.first_seen_at AS development_first_seen_at,
       v.last_seen_at AS version_last_observed_at, v.text_url,
       a.id AS artifact_id, a.sha256 AS stored_pdf_sha256, a.source_url,
       a.captured_at, a.state AS extraction_state, a.extraction_error,
       a.page_count AS declared_page_count, a.extraction_sha256,
       json_extract(a.binding_json,'$.bill') AS bound_bill,
       json_extract(a.binding_json,'$.session') AS bound_session,
       json_extract(a.binding_json,'$.printer') AS bound_printer,
       (SELECT COUNT(*) FROM policy_pdf_pages p WHERE p.artifact_id=a.id) AS retained_pages,
       (SELECT COUNT(*) FROM policy_provisions p WHERE p.artifact_id=a.id) AS provision_groups,
       (SELECT COUNT(*) FROM policy_provision_reviews r JOIN policy_provisions p ON p.id=r.provision_id
        WHERE p.artifact_id=a.id AND r.evidence_sha256=p.evidence_sha256) AS retained_review_decisions
FROM policy_instruments i JOIN policy_versions v ON v.instrument_row_id=i.id
LEFT JOIN policy_pdf_artifacts a ON a.version_row_id=v.id
WHERE i.jurisdiction='PA' AND i.instrument_id IN ('HB 1925','SB 1113','HB 1993')
ORDER BY i.instrument_id,v.development_at,a.captured_at,a.id;
