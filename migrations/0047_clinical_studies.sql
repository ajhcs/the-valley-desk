CREATE TABLE study_removals(id TEXT PRIMARY KEY, removed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE study_visibility(id INTEGER PRIMARY KEY CHECK (id=1), enabled INTEGER NOT NULL CHECK (enabled IN (0,1)));
INSERT INTO study_visibility VALUES(1,0);

DROP VIEW research_visible;
CREATE VIEW research_visible AS SELECT l.*,
 CASE WHEN substr(l.work_id,1,1)='?' THEN coalesce((
   SELECT f.id FROM research_facets f WHERE f.field='version' AND f.value=l.id ORDER BY f.id LIMIT 1
 ), l.id) ELSE l.work_id END AS group_id
FROM research_listings l
WHERE NOT EXISTS(SELECT 1 FROM publication_removals r WHERE r.id=l.id)
AND NOT EXISTS(SELECT 1 FROM public_directory_removals r WHERE r.github_id=l.id)
AND (l.kind<>'study' OR ((SELECT enabled FROM study_visibility WHERE id=1)=1
AND NOT EXISTS(SELECT 1 FROM study_removals r WHERE r.id=l.id)));
