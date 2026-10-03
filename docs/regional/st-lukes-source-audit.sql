-- Read-only diagnostics for the parent's existing authorized D1 reader.
-- Do not run a collector, reset the due time, or repair state to obtain these rows.
SELECT source_id, state, last_attempted_at, last_success_at,
       next_attempt_at, consecutive_failures, last_error
FROM scheduled_source_state
WHERE source_id = 'src-st-lukes-leadership';

SELECT id, source_id, fetched_at, final_url, state, error,
       byte_count, json_array_length(extracted_json) AS extracted_count
FROM source_snapshots
WHERE source_id = 'src-st-lukes-leadership'
ORDER BY fetched_at DESC, id DESC
LIMIT 10;
