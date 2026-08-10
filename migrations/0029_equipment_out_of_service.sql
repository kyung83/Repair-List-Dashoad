PRAGMA foreign_keys = ON;

ALTER TABLE equipment ADD COLUMN out_of_service INTEGER NOT NULL DEFAULT 0;
ALTER TABLE equipment ADD COLUMN out_of_service_reason TEXT;
ALTER TABLE equipment ADD COLUMN out_of_service_at TEXT;
ALTER TABLE equipment ADD COLUMN out_of_service_by_user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_equipment_out_of_service
ON equipment(out_of_service, equipment_type, unit);

CREATE TABLE IF NOT EXISTS equipment_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  user_id INTEGER,
  out_of_service INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_status_events_equipment
ON equipment_status_events(equipment_id, created_at DESC);
