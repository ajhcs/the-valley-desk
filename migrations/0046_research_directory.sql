CREATE TABLE research_institutions(id TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE research_listings(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, added TEXT NOT NULL,
 activity TEXT NOT NULL, topic TEXT NOT NULL, work_id TEXT NOT NULL,
 keywords TEXT NOT NULL, record TEXT NOT NULL, facets TEXT NOT NULL
);
CREATE INDEX research_added ON research_listings(added DESC,id);
CREATE INDEX research_activity ON research_listings(activity DESC,id);
CREATE INDEX research_title ON research_listings(title COLLATE NOCASE,id);
CREATE INDEX research_kind ON research_listings(kind,id);
CREATE TABLE publication_removals(id TEXT PRIMARY KEY, removed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE research_facets(field TEXT, value TEXT, id TEXT, PRIMARY KEY(field,value,id)) WITHOUT ROWID;
CREATE INDEX research_facets_listing ON research_facets(id);
CREATE VIRTUAL TABLE research_search USING fts5(title,keywords, content='research_listings',content_rowid='rowid');
CREATE TRIGGER research_insert AFTER INSERT ON research_listings BEGIN
 INSERT INTO research_search(rowid,title,keywords) VALUES(new.rowid,new.title,new.keywords);
 INSERT OR IGNORE INTO research_facets SELECT f.key,v.value,new.id
 FROM json_each(new.facets) f,json_each(f.value) v;
END;
CREATE TRIGGER research_change AFTER UPDATE ON research_listings BEGIN
 INSERT INTO research_search(research_search,rowid,title,keywords) VALUES('delete',old.rowid,old.title,old.keywords);
 INSERT INTO research_search(rowid,title,keywords) VALUES(new.rowid,new.title,new.keywords);
 DELETE FROM research_facets WHERE id=old.id;
 INSERT OR IGNORE INTO research_facets SELECT f.key,v.value,new.id
 FROM json_each(new.facets) f,json_each(f.value) v;
END;
CREATE VIEW research_visible AS SELECT l.*,
 CASE WHEN substr(l.work_id,1,1)='?' THEN coalesce((
   SELECT f.id FROM research_facets f WHERE f.field='version' AND f.value=l.id ORDER BY f.id LIMIT 1
 ), l.id) ELSE l.work_id END AS group_id
FROM research_listings l
WHERE NOT EXISTS(SELECT 1 FROM publication_removals r WHERE r.id=l.id)
AND NOT EXISTS(SELECT 1 FROM public_directory_removals r WHERE r.github_id=l.id);
CREATE TRIGGER research_delete AFTER DELETE ON research_listings BEGIN
 INSERT INTO research_search(research_search,rowid,title,keywords) VALUES('delete',old.rowid,old.title,old.keywords);
 DELETE FROM research_facets WHERE id=old.id;
END;

-- Oversized bylines may exceed one D1 SQL statement. Only the final upsert becomes public.
CREATE TABLE research_import_chunks(digest TEXT, part INTEGER, piece TEXT NOT NULL,
 PRIMARY KEY(digest,part)) WITHOUT ROWID;
