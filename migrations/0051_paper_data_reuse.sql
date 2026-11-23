-- Independently reviewed reuse relationships; these are not dataset listings.
CREATE TABLE paper_data_reuse(
 paper_id TEXT NOT NULL, dataset_id TEXT NOT NULL, accession TEXT NOT NULL,
 PRIMARY KEY(paper_id,dataset_id)
) WITHOUT ROWID;
CREATE TABLE paper_data_reuse_revision(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO paper_data_reuse_revision VALUES(1,0);
CREATE TRIGGER paper_data_reuse_insert AFTER INSERT ON paper_data_reuse BEGIN
 UPDATE paper_data_reuse_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER paper_data_reuse_update AFTER UPDATE ON paper_data_reuse BEGIN
 UPDATE paper_data_reuse_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER paper_data_reuse_delete AFTER DELETE ON paper_data_reuse BEGIN
 UPDATE paper_data_reuse_revision SET revision=revision+1 WHERE id=1;
END;
