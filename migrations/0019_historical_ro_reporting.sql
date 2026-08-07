PRAGMA foreign_keys = ON;

-- Imported shop-history is intentionally kept separate from operational repairs so
-- years of completed ROs never appear on the active Repair Board / Work Orders.
CREATE TABLE IF NOT EXISTS historical_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_key TEXT NOT NULL,
  equipment_id INTEGER NOT NULL,
  ro_number TEXT NOT NULL,
  ro_date TEXT NOT NULL,
  location TEXT,
  source_status TEXT,
  labor_hours REAL NOT NULL DEFAULT 0,
  labor_cost REAL NOT NULL DEFAULT 0,
  parts_cost REAL NOT NULL DEFAULT 0,
  sublet_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  UNIQUE(import_key, ro_number)
);

CREATE INDEX IF NOT EXISTS idx_historical_repairs_equipment_date
ON historical_repairs(equipment_id, ro_date);
CREATE INDEX IF NOT EXISTS idx_historical_repairs_date
ON historical_repairs(ro_date);
CREATE INDEX IF NOT EXISTS idx_historical_repairs_ro
ON historical_repairs(ro_number);

CREATE TABLE IF NOT EXISTS historical_repair_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_key TEXT NOT NULL,
  historical_repair_id INTEGER NOT NULL,
  equipment_id INTEGER NOT NULL,
  ro_number TEXT NOT NULL,
  ro_date TEXT NOT NULL,
  major_category TEXT NOT NULL,
  system_code TEXT NOT NULL,
  assembly_code TEXT NOT NULL,
  vmrs_description TEXT NOT NULL,
  labor_hours REAL NOT NULL DEFAULT 0,
  labor_cost REAL NOT NULL DEFAULT 0,
  parts_cost REAL NOT NULL DEFAULT 0,
  sublet_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (historical_repair_id) REFERENCES historical_repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  UNIQUE(import_key, ro_number, system_code, assembly_code, vmrs_description)
);

CREATE INDEX IF NOT EXISTS idx_historical_lines_equipment_date
ON historical_repair_lines(equipment_id, ro_date);
CREATE INDEX IF NOT EXISTS idx_historical_lines_category_date
ON historical_repair_lines(major_category, ro_date);
CREATE INDEX IF NOT EXISTS idx_historical_lines_system_date
ON historical_repair_lines(system_code, assembly_code, ro_date);
CREATE INDEX IF NOT EXISTS idx_historical_lines_description
ON historical_repair_lines(vmrs_description);

CREATE TABLE IF NOT EXISTS data_imports (
  import_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  source_line_count INTEGER NOT NULL DEFAULT 0,
  source_ro_count INTEGER NOT NULL DEFAULT 0,
  imported_line_count INTEGER NOT NULL DEFAULT 0,
  imported_ro_count INTEGER NOT NULL DEFAULT 0,
  matched_unit_count INTEGER NOT NULL DEFAULT 0,
  unmatched_line_count INTEGER NOT NULL DEFAULT 0,
  unmatched_ro_count INTEGER NOT NULL DEFAULT 0,
  unmatched_unit_count INTEGER NOT NULL DEFAULT 0,
  skipped_nonfinal_ro_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS data_import_unmatched_units (
  import_key TEXT NOT NULL,
  unit TEXT NOT NULL,
  ro_count INTEGER NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (import_key, unit),
  FOREIGN KEY (import_key) REFERENCES data_imports(import_key) ON DELETE CASCADE
);

-- Per-RO audit rows make the admin upload idempotent: if a browser request is
-- retried, unmatched/skipped records cannot be double-counted.
CREATE TABLE IF NOT EXISTS data_import_unmatched_ros (
  import_key TEXT NOT NULL,
  ro_number TEXT NOT NULL,
  unit TEXT NOT NULL,
  line_count INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (import_key, ro_number),
  FOREIGN KEY (import_key) REFERENCES data_imports(import_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_unmatched_ros_unit
ON data_import_unmatched_ros(import_key, unit);

CREATE TABLE IF NOT EXISTS data_import_skipped_ros (
  import_key TEXT NOT NULL,
  ro_number TEXT NOT NULL,
  source_status TEXT NOT NULL,
  PRIMARY KEY (import_key, ro_number),
  FOREIGN KEY (import_key) REFERENCES data_imports(import_key) ON DELETE CASCADE
);
