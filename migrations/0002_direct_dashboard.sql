PRAGMA foreign_keys = ON;

ALTER TABLE equipment ADD COLUMN service_date TEXT;
ALTER TABLE equipment ADD COLUMN annual_date TEXT;
ALTER TABLE equipment ADD COLUMN notes TEXT;
ALTER TABLE equipment ADD COLUMN geotab_device_id TEXT;
ALTER TABLE equipment ADD COLUMN geotab_trailer_id TEXT;
ALTER TABLE equipment ADD COLUMN driver TEXT;
ALTER TABLE equipment ADD COLUMN location TEXT;

ALTER TABLE repairs ADD COLUMN parts_text TEXT;
ALTER TABLE repairs ADD COLUMN driver TEXT;
ALTER TABLE repairs ADD COLUMN location TEXT;

CREATE TABLE IF NOT EXISTS pm_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL UNIQUE,
  pm_type TEXT,
  status TEXT,
  last_mileage INTEGER,
  service_date TEXT,
  annual_date TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dvir_defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geotab_log_id TEXT NOT NULL,
  geotab_defect_id TEXT NOT NULL UNIQUE,
  asset_unit TEXT NOT NULL,
  driver TEXT,
  defect TEXT NOT NULL,
  comments TEXT,
  photos_url TEXT,
  repaired INTEGER NOT NULL DEFAULT 0,
  repair_date TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_equipment_geotab_device ON equipment(geotab_device_id);
CREATE INDEX IF NOT EXISTS idx_equipment_geotab_trailer ON equipment(geotab_trailer_id);
CREATE INDEX IF NOT EXISTS idx_dvir_log ON dvir_defects(geotab_log_id);
CREATE INDEX IF NOT EXISTS idx_dvir_repaired ON dvir_defects(repaired);
CREATE INDEX IF NOT EXISTS idx_parts_active ON parts(active);
