ALTER TABLE equipment ADD COLUMN geotab_latitude REAL;
ALTER TABLE equipment ADD COLUMN geotab_longitude REAL;
ALTER TABLE equipment ADD COLUMN geotab_position_at TEXT;
ALTER TABLE equipment ADD COLUMN current_yard TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN current_yard_zone TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN yard_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_current_yard
ON equipment(current_yard, active);
