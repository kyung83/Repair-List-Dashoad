PRAGMA foreign_keys = ON;

-- Keep an independent audit record when a manager/admin removes a mistaken,
-- activity-free manual repair. The repair itself is deleted only after the API
-- proves no labor, parts, photos, billing, or maintenance history is attached.
CREATE TABLE IF NOT EXISTS repair_admin_deletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  equipment_id INTEGER,
  unit TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  parts_text TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '2',
  status TEXT NOT NULL DEFAULT 'New',
  source TEXT NOT NULL DEFAULT 'manual',
  technician_id INTEGER,
  opened_at TEXT,
  deleted_by_user_id INTEGER,
  deleted_by_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE SET NULL,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_admin_deletions_deleted_at
ON repair_admin_deletions(deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_repair_admin_deletions_repair
ON repair_admin_deletions(repair_id);
