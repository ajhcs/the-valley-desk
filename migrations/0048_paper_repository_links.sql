-- Papers whose full text links to a repository that is already a directory project.
-- A link says only that the paper names the repository; it does not say the paper released it.
-- Removed papers and projects are hidden by the queries that read this table.
CREATE TABLE IF NOT EXISTS paper_repository_links(
 paper_id TEXT NOT NULL, project_id TEXT NOT NULL,
 PRIMARY KEY(paper_id, project_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS paper_repository_links_project ON paper_repository_links(project_id, paper_id);
