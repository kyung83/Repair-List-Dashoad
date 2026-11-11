PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN pull_thru INTEGER NOT NULL DEFAULT 0 CHECK (pull_thru IN (0,1));
ALTER TABLE repairs ADD COLUMN pull_thru_marked_at TEXT;
ALTER TABLE repairs ADD COLUMN pull_thru_marked_by_user_id INTEGER;

CREATE TABLE IF NOT EXISTS technician_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technician_id INTEGER NOT NULL,
  repair_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT,
  acknowledged_by_user_id INTEGER,
  FOREIGN KEY (technician_id) REFERENCES technicians(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id),
  FOREIGN KEY (acknowledged_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_repairs_pull_thru_open
ON repairs(pull_thru,status,technician_id);

CREATE INDEX IF NOT EXISTS idx_technician_alerts_pending
ON technician_alerts(technician_id,acknowledged_at,id);
