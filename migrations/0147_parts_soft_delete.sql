PRAGMA foreign_keys = ON;

-- Admin "delete" is a tombstone so historical repairs, receipts, transfers,
-- counts, and inventory operations keep their original part relationship.
ALTER TABLE parts ADD COLUMN deleted_at TEXT;
ALTER TABLE parts ADD COLUMN deleted_by_user_id INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS idx_parts_deleted_at
ON parts(deleted_at);
