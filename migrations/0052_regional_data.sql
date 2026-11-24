-- Public data about the region is a separate, independently gated listing kind.
CREATE TABLE regional_data_visibility(id INTEGER PRIMARY KEY CHECK (id=1), enabled INTEGER NOT NULL CHECK (enabled IN (0,1)));
INSERT INTO regional_data_visibility VALUES(1,0);
CREATE TABLE regional_data_removals(id TEXT PRIMARY KEY, removed_at TEXT DEFAULT CURRENT_TIMESTAMP);

-- Operational state is private. The reviewed source record supplies the public metadata.
CREATE TABLE regional_data_checks(
 id TEXT PRIMARY KEY, attempted TEXT NOT NULL, checked TEXT, publisher_updated TEXT, review_reason TEXT
);
CREATE TABLE regional_data_publications(
 dataset_id TEXT NOT NULL, paper_id TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL,
 PRIMARY KEY(dataset_id,paper_id)
) WITHOUT ROWID;

DROP VIEW research_visible;
CREATE VIEW research_visible AS SELECT l.*,
 CASE WHEN substr(l.work_id,1,1)='?' THEN coalesce((
   SELECT f.id FROM research_facets f WHERE f.field='version' AND f.value=l.id ORDER BY f.id LIMIT 1
 ), l.id) ELSE l.work_id END AS group_id
FROM research_listings l
WHERE NOT EXISTS(SELECT 1 FROM publication_removals r WHERE r.id=l.id)
AND NOT EXISTS(SELECT 1 FROM public_directory_removals r WHERE r.github_id=l.id)
AND (l.kind<>'study' OR ((SELECT enabled FROM study_visibility WHERE id=1)=1
AND NOT EXISTS(SELECT 1 FROM study_removals r WHERE r.id=l.id)))
AND (l.kind<>'dataset' OR ((SELECT enabled FROM dataset_visibility WHERE id=1)=1
AND NOT EXISTS(SELECT 1 FROM dataset_removals r WHERE r.id=l.id)))
AND (l.kind<>'regional-data' OR ((SELECT enabled FROM regional_data_visibility WHERE id=1)=1
AND NOT EXISTS(SELECT 1 FROM regional_data_removals r WHERE r.id=l.id)));
