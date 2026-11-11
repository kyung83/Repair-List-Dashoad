PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN pull_thru INTEGER NOT NULL DEFAULT 0 CHECK (pull_thru IN (0,1));
ALTER TABLE repairs ADD COLUMN pull_thru_marked_at TEXT;
ALTER TABLE repairs ADD COLUMN pull_thru_marked_by_user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_repairs_pull_thru_open
ON repairs(pull_thru,status,technician_id);
