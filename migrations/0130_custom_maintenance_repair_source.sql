PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN maintenance_source_id TEXT;
ALTER TABLE repairs ADD COLUMN maintenance_program_step_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_repairs_maintenance_source_id
ON repairs(maintenance_source_id);

CREATE INDEX IF NOT EXISTS idx_repairs_maintenance_program_step
ON repairs(maintenance_program_step_id);
