PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3);

CREATE INDEX IF NOT EXISTS idx_repairs_priority_updated
ON repairs(priority, updated_at DESC);
