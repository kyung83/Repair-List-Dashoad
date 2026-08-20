PRAGMA foreign_keys = ON;

-- A void invoice may be removed from the working invoice list, but keep one compact
-- audit snapshot so an accidental or intentional deletion does not erase the fact
-- that the invoice once existed.
CREATE TABLE IF NOT EXISTS invoice_void_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  invoice_number TEXT NOT NULL,
  bill_to_name TEXT,
  unit TEXT,
  total REAL NOT NULL DEFAULT 0,
  deleted_by_user_id INTEGER,
  deleted_by_name TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_void_deletions_number
ON invoice_void_deletions(invoice_number, deleted_at);

CREATE INDEX IF NOT EXISTS idx_invoice_void_deletions_deleted_at
ON invoice_void_deletions(deleted_at);
