-- Stable publication identity: canonical source_identity, slug aliases, and
-- per-item quarantine. Existing rows stay valid with NULL identity until the
-- next persist fills it. The unique index allows multiple NULLs.

ALTER TABLE content_candidates ADD COLUMN source_identity TEXT;

CREATE UNIQUE INDEX content_candidates_source_identity_uidx
  ON content_candidates(source_identity)
  WHERE source_identity IS NOT NULL AND source_identity != '';

CREATE TABLE candidate_discoveries (
  candidate_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  source_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, origin),
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id)
);

CREATE TABLE content_slug_aliases (
  alias_slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, alias_slug),
  FOREIGN KEY (content_id) REFERENCES published_content(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id)
);

CREATE INDEX content_slug_aliases_content_idx
  ON content_slug_aliases(content_id, alias_slug);

CREATE TABLE identity_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT,
  source_identity TEXT,
  reason TEXT NOT NULL,
  content_json TEXT,
  run_id TEXT,
  quarantined_at TEXT NOT NULL
);

CREATE INDEX identity_quarantine_seen_idx
  ON identity_quarantine(quarantined_at DESC, source_identity);

-- D1 rows that already stored previousSlugs in content_json keep working as
-- 301 aliases after this migration, without rewriting published_content.
INSERT OR IGNORE INTO content_slug_aliases (alias_slug, kind, content_id, candidate_id, created_at)
SELECT
  j.value,
  p.kind,
  p.id,
  p.candidate_id,
  p.first_published_at
FROM published_content p
JOIN json_each(COALESCE(json_extract(p.content_json, '$.previousSlugs'), '[]')) j
WHERE typeof(j.value) = 'text'
  AND length(j.value) > 0
  AND j.value != p.slug;
