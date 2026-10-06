-- Review-only diagnostic retention. No existing source/schedule/role rows change.
-- One bounded immutable response per exact source; flag/window live in code.
CREATE TABLE IF NOT EXISTS leadership_markup_captures (
 source_id TEXT PRIMARY KEY CHECK (source_id IN ('src-chop-leadership', 'src-chop-desai', 'src-chop-pennington', 'src-chop-salmasian', 'src-temple-leadership', 'src-inspira-leadership', 'src-nemours-leadership')),
 snapshot_id TEXT NOT NULL,
 scheduled_at TEXT NOT NULL,
 inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
 expires_at TEXT NOT NULL DEFAULT '2026-10-07T04:00:00.000Z' CHECK (expires_at = '2026-10-07T04:00:00.000Z'),
 received_at TEXT NOT NULL CHECK (received_at >= '2026-10-06T02:30:00.000Z' AND received_at < '2026-10-06T04:00:00.000Z'),
 configured_url TEXT NOT NULL,
 attempted_url TEXT NOT NULL,
 final_url TEXT NOT NULL,
 http_status INTEGER NOT NULL CHECK (http_status BETWEEN 200 AND 299),
 content_type TEXT NOT NULL,
 byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 0 AND 512000),
 raw_sha256 TEXT NOT NULL CHECK (length(raw_sha256) = 64),
 decoded_sha256 TEXT NOT NULL CHECK (length(decoded_sha256) = 64),
 byte_semantics TEXT NOT NULL CHECK (byte_semantics = 'fetch-response-body'),
 decoding TEXT NOT NULL CHECK (decoding = 'utf-8-replacement-bom-stripped'),
 raw_markup_base64 TEXT NOT NULL CHECK (length(raw_markup_base64) <= 682668)
);

-- Execution-time cutoff, even if an eligible response/Worker submission was delayed.
-- Commit completion may be later than insert execution; no later insert executes.
CREATE TRIGGER IF NOT EXISTS leadership_markup_captures_insert_window
BEFORE INSERT ON leadership_markup_captures
WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') < '2026-10-06T02:30:00.000Z'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', 'now') >= '2026-10-06T04:00:00.000Z'
BEGIN
 SELECT RAISE(ABORT, 'Leadership markup capture insertion window closed');
END;
