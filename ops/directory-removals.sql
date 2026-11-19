CREATE TABLE IF NOT EXISTS public_directory_removals (
    github_id TEXT PRIMARY KEY NOT NULL
        CHECK (github_id NOT GLOB '*[^0-9]*' AND length(github_id) BETWEEN 1 AND 20 AND substr(github_id, 1, 1) != '0'),
    removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
