PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN maintenance_source_id TEXT;

CREATE INDEX IF NOT EXISTS idx_repairs_maintenance_source_id
ON repairs(maintenance_source_id);
