-- Run after the initial research import so SQLite plans with the loaded distribution.
CREATE INDEX IF NOT EXISTS research_filter_order ON research_listings(id, kind, work_id, added);
ANALYZE research_listings;
