PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  equipment_scope TEXT NOT NULL DEFAULT 'vehicle' CHECK (equipment_scope IN ('vehicle', 'trailer', 'any')),
  rotation_mileage_interval INTEGER,
  rotation_time_interval_days INTEGER,
  due_soon_miles INTEGER NOT NULL DEFAULT 1000,
  due_soon_days INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (rotation_mileage_interval IS NULL OR rotation_mileage_interval > 0),
  CHECK (rotation_time_interval_days IS NULL OR rotation_time_interval_days > 0),
  CHECK (due_soon_miles >= 0),
  CHECK (due_soon_days >= 0)
);

CREATE TABLE IF NOT EXISTS maintenance_program_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  maintenance_item_id INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('rotation', 'interval')),
  position INTEGER NOT NULL DEFAULT 0,
  mileage_interval INTEGER,
  time_interval_days INTEGER,
  resets_item_ids_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (program_id) REFERENCES maintenance_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (maintenance_item_id) REFERENCES maintenance_items(id),
  CHECK (mileage_interval IS NULL OR mileage_interval > 0),
  CHECK (time_interval_days IS NULL OR time_interval_days > 0)
);

CREATE TABLE IF NOT EXISTS equipment_maintenance_programs (
  equipment_id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  rotation_position INTEGER NOT NULL DEFAULT 0,
  rotation_last_mileage INTEGER,
  rotation_last_date TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES maintenance_programs(id)
);

CREATE TABLE IF NOT EXISTS equipment_maintenance_step_status (
  equipment_id INTEGER NOT NULL,
  program_step_id INTEGER NOT NULL,
  last_mileage INTEGER,
  last_date TEXT,
  last_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (equipment_id, program_step_id),
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (program_step_id) REFERENCES maintenance_program_steps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_maintenance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  program_step_id INTEGER NOT NULL,
  maintenance_item_id INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  mileage INTEGER,
  source TEXT NOT NULL DEFAULT 'maintenance-programs',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (program_id) REFERENCES maintenance_programs(id),
  FOREIGN KEY (program_step_id) REFERENCES maintenance_program_steps(id),
  FOREIGN KEY (maintenance_item_id) REFERENCES maintenance_items(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_program_interval_item
  ON maintenance_program_steps(program_id, maintenance_item_id)
  WHERE step_type = 'interval';
CREATE INDEX IF NOT EXISTS idx_maintenance_program_steps_program
  ON maintenance_program_steps(program_id, step_type, position);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_program_program
  ON equipment_maintenance_programs(program_id);
CREATE INDEX IF NOT EXISTS idx_custom_maintenance_events_equipment
  ON custom_maintenance_events(equipment_id, event_date);
