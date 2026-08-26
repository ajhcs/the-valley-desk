CREATE TABLE candidate_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  reviewer TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES content_candidates(id)
);

CREATE INDEX candidate_decisions_candidate_idx
  ON candidate_decisions(candidate_id, decided_at DESC);
