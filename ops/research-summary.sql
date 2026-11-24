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
-- Non-dataset facet counts keep the off switch cheap even before the next refresh.
DROP TABLE IF EXISTS research_summary_facets_without_datasets;
CREATE TABLE research_summary_facets_without_datasets(
 scope_field TEXT NOT NULL, scope_value TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, n INTEGER NOT NULL,
 PRIMARY KEY(scope_field,scope_value,field,value)) WITHOUT ROWID;
INSERT INTO research_summary_facets_without_datasets SELECT '','',f.field,f.value,count(DISTINCT v.group_id) FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE v.kind<>'dataset' AND f.field IN ('institution','topic','county') GROUP BY f.field,f.value;
INSERT INTO research_summary_facets_without_datasets SELECT s.field,s.value,f.field,f.value,count(DISTINCT v.group_id) FROM research_facets s JOIN research_visible v ON v.id=s.id JOIN research_facets f ON f.id=s.id WHERE v.kind<>'dataset' AND s.field IN ('institution','topic','county') AND f.field IN ('institution','topic','county') GROUP BY s.field,s.value,f.field,f.value;
-- Institutions that share listings, for "Shares the most research with" on institution pages.
-- A unit and its parent, and a university and its own health system, are one system and never
-- count as partners of each other. A partner is named at its top level, so a medical school's
-- listings count toward its university.
DROP TABLE IF EXISTS research_summary_partners;
CREATE TABLE research_summary_partners(
 institution TEXT NOT NULL, partner TEXT NOT NULL, n INTEGER NOT NULL,
 PRIMARY KEY(institution,partner)) WITHOUT ROWID;
INSERT INTO research_summary_partners
WITH roots AS (
  SELECT id, CASE coalesce(json_extract(record,'$.parent'), id)
    WHEN 'penn-medicine' THEN 'upenn' WHEN 'jefferson-health' THEN 'thomas-jefferson-university'
    WHEN 'temple-health' THEN 'temple-university' ELSE coalesce(json_extract(record,'$.parent'), id) END AS root
  FROM research_institutions),
listings AS (SELECT id,group_id FROM research_visible WHERE kind IN ('publication','study'))
SELECT a.value,rb.root,count(DISTINCT v.group_id)
FROM research_facets a
JOIN listings v ON v.id=a.id
JOIN research_facets b ON b.id=a.id AND b.field='institution' AND b.value<>a.value
JOIN roots ra ON ra.id=a.value JOIN roots rb ON rb.id=b.value
WHERE a.field='institution' AND ra.root<>rb.root
GROUP BY a.value,rb.root;
-- Dataset-only choices are computed once per refresh, including their display labels.
DROP TABLE IF EXISTS research_summary_dataset_facets;
CREATE TABLE research_summary_dataset_facets(field TEXT NOT NULL, value TEXT NOT NULL, name TEXT, PRIMARY KEY(field,value)) WITHOUT ROWID;
INSERT INTO research_summary_dataset_facets
SELECT f.field,f.value,max(CASE f.field WHEN 'repository' THEN json_extract(v.record,'$.repository') WHEN 'datatype' THEN json_extract(v.record,'$.data_type') WHEN 'topic' THEN json_extract(v.record,'$.topic') END)
FROM research_facets f JOIN research_visible v ON v.id=f.id
WHERE v.kind='dataset' AND f.field IN ('access','datatype','repository','institution','county','topic') GROUP BY f.field,f.value;
-- Keep dataset partner counts separate so the visibility switch immediately suppresses them.
DROP TABLE IF EXISTS research_summary_dataset_partners;
CREATE TABLE research_summary_dataset_partners(institution TEXT NOT NULL, partner TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(institution,partner)) WITHOUT ROWID;
INSERT INTO research_summary_dataset_partners
WITH roots AS (
 SELECT id, CASE coalesce(json_extract(record,'$.parent'),id)
 WHEN 'penn-medicine' THEN 'upenn' WHEN 'jefferson-health' THEN 'thomas-jefferson-university'
 WHEN 'temple-health' THEN 'temple-university' ELSE coalesce(json_extract(record,'$.parent'),id) END root FROM research_institutions)
SELECT a.value,rb.root,count(DISTINCT v.group_id) FROM research_facets a
JOIN research_visible v ON v.id=a.id AND v.kind='dataset'
JOIN research_facets b ON b.id=a.id AND b.field='institution' AND b.value<>a.value
JOIN roots ra ON ra.id=a.value JOIN roots rb ON rb.id=b.value
WHERE a.field='institution' AND ra.root<>rb.root GROUP BY a.value,rb.root;
-- Listings published, pushed, updated or released in the seven days before this refresh: the
-- home page's "new or updated this week". Only full dates count; a year or month is too coarse.
INSERT INTO research_summary_kinds SELECT 'week','',kind,count(DISTINCT group_id),NULL,NULL,max(activity),count(*) FROM research_visible WHERE length(activity)=10 AND activity>=date('now','-7 days') AND activity<=date('now') GROUP BY kind;
-- Written last: its presence tells the pages that the refresh finished.
INSERT INTO research_summary_kinds SELECT '','',kind,count(DISTINCT group_id),min(nullif(activity,'')),max(nullif(activity,'')),max(nullif(added,'')),count(*) FROM research_visible GROUP BY kind;
-- Metadata-only updates can keep every total and date unchanged.
INSERT INTO research_summary_kinds VALUES('data','','directory',0,lower(hex(randomblob(16))),NULL,NULL,0);
-- Record the visibility state used to compute these summaries.
INSERT INTO research_summary_kinds SELECT 'visibility','','dataset',0,CAST(EXISTS(SELECT 1 FROM research_visible WHERE kind='dataset') AS TEXT),NULL,NULL,0;

INSERT INTO research_summary_kinds SELECT 'visibility','','regional-data',0,CAST(EXISTS(SELECT 1 FROM research_visible WHERE kind='regional-data') AS TEXT),NULL,NULL,0;
