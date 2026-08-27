PRAGMA foreign_keys = ON;

CREATE TABLE news_article_extractions (
  url TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('success', 'failed', 'no-content')),
  cached_text TEXT,
  method TEXT CHECK (method IS NULL OR method IN ('json-ld', 'article', 'main')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempted_at TEXT NOT NULL,
  last_success_at TEXT,
  next_attempt_at TEXT NOT NULL,
  error TEXT,
  CHECK (
    state != 'success'
    OR (
      cached_text IS NOT NULL
      AND length(cached_text) > 0
      AND method IS NOT NULL
    )
  )
);

CREATE INDEX news_article_extractions_due_idx
  ON news_article_extractions(next_attempt_at, state);
