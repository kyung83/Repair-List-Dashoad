PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repair_work_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT,
  content_type TEXT,
  note TEXT,
  uploaded_by_user_id INTEGER,
  technician_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_work_photos_repair
ON repair_work_photos(repair_id, created_at, id);
