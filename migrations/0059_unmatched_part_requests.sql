PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS unmatched_part_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  requested_text TEXT NOT NULL,
  requested_quantity REAL NOT NULL,
  warehouse_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled','cancelled')),
  requested_by_user_id INTEGER,
  technician_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at TEXT,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  CHECK (requested_quantity > 0),
  CHECK (length(trim(requested_text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_unmatched_part_requests_status
ON unmatched_part_requests(status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_unmatched_part_requests_repair
ON unmatched_part_requests(repair_id, status, updated_at DESC);
