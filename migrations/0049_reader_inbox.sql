-- Reader suggestions and page feedback from the public directory. Private: no public route reads
-- this table. Agents and operators read it with wrangler d1 execute (see ops/reader-inbox.md).
CREATE TABLE IF NOT EXISTS reader_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'feedback')),
  received_at TEXT NOT NULL,
  page TEXT,
  rating TEXT CHECK (rating IS NULL OR rating IN ('useful', 'not-useful')),
  item_type TEXT CHECK (item_type IS NULL OR item_type IN ('publication', 'software', 'dataset', 'tool', 'other')),
  url TEXT,
  connection TEXT,
  message TEXT,
  email TEXT,
  client TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'added', 'declined', 'spam')),
  note TEXT
);
CREATE INDEX IF NOT EXISTS reader_inbox_status ON reader_inbox (status, received_at);
CREATE INDEX IF NOT EXISTS reader_inbox_received ON reader_inbox (received_at);
