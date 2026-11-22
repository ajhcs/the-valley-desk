-- Run after every research import and after any removal that should change the counts on the
-- home, institution, topic and county pages. Those pages read these tables instead of counting
-- the whole directory on each view. Safe to rerun. While the tables are missing or empty the
-- pages count directly, so the order of this file and a Worker deploy does not matter.
-- The whole directory is the scope with an empty field and value.
-- The tables are rebuilt so that a column added here reaches a database created by an earlier version.
DROP TABLE IF EXISTS research_summary_kinds;
DROP TABLE IF EXISTS research_summary_facets;
CREATE TABLE research_summary_kinds(
 scope_field TEXT NOT NULL, scope_value TEXT NOT NULL, kind TEXT NOT NULL, works INTEGER NOT NULL,
 first TEXT, last TEXT, added TEXT, n INTEGER NOT NULL,
 PRIMARY KEY(scope_field,scope_value,kind)) WITHOUT ROWID;
CREATE TABLE research_summary_facets(
 scope_field TEXT NOT NULL, scope_value TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, n INTEGER NOT NULL,
 PRIMARY KEY(scope_field,scope_value,field,value)) WITHOUT ROWID;
INSERT INTO research_summary_facets SELECT '','',f.field,f.value,count(DISTINCT v.group_id) FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE f.field IN ('institution','topic','county') GROUP BY f.field,f.value;
INSERT INTO research_summary_facets SELECT s.field,s.value,f.field,f.value,count(DISTINCT v.group_id) FROM research_facets s JOIN research_visible v ON v.id=s.id JOIN research_facets f ON f.id=s.id WHERE s.field IN ('institution','topic','county') AND f.field IN ('institution','topic','county') GROUP BY s.field,s.value,f.field,f.value;
INSERT INTO research_summary_kinds SELECT s.field,s.value,v.kind,count(DISTINCT v.group_id),min(nullif(v.activity,'')),max(nullif(v.activity,'')),max(nullif(v.added,'')),count(*) FROM research_facets s JOIN research_visible v ON v.id=s.id WHERE s.field IN ('institution','topic','county') GROUP BY s.field,s.value,v.kind;
-- Written last: its presence tells the pages that the refresh finished.
INSERT INTO research_summary_kinds SELECT '','',kind,count(DISTINCT group_id),min(nullif(activity,'')),max(nullif(activity,'')),max(nullif(added,'')),count(*) FROM research_visible GROUP BY kind;
