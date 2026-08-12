PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  equipment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','ready','completed')),
  mileage_at_start INTEGER,
  mileage_at_completion INTEGER,
  mileage_source TEXT,
  mileage_updated_at TEXT,
  started_by_user_id INTEGER,
  ready_by_user_id INTEGER,
  completed_by_user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (started_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (ready_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_maintenance_checklist_runs_equipment
ON maintenance_checklist_runs(equipment_id, event_type, status);

CREATE TABLE IF NOT EXISTS maintenance_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','na')),
  notes TEXT,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE(checklist_run_id, item_number)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_checklist_items_run
ON maintenance_checklist_items(checklist_run_id, item_number);

CREATE TABLE IF NOT EXISTS maintenance_checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  checklist_item_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT,
  content_type TEXT,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (checklist_item_id) REFERENCES maintenance_checklist_items(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_maintenance_checklist_photos_item
ON maintenance_checklist_photos(checklist_item_id, created_at);
