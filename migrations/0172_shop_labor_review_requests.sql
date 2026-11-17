-- Additive ledger for technician-submitted labor correction and outage catch-up requests.
-- Does not change running timers, repair history, inventory or inspection records.
CREATE TABLE IF NOT EXISTS shop_labor_review_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT NOT NULL UNIQUE,
  requester_user_id INTEGER NOT NULL REFERENCES app_users(id),
  technician_id INTEGER NOT NULL REFERENCES technicians(id),
  request_type TEXT NOT NULL CHECK(request_type IN ('correction','missed')),
  source_labor_entry_id INTEGER REFERENCES repair_labor_entries(id) ON DELETE SET NULL,
  source_repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
  proposed_repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
  unit_snapshot TEXT NOT NULL DEFAULT '',
  repair_snapshot TEXT NOT NULL DEFAULT '',
  original_hours REAL,
  original_rate REAL,
  original_notes TEXT NOT NULL DEFAULT '',
  requested_hours REAL NOT NULL CHECK(requested_hours > 0 AND requested_hours <= 24),
  labor_date TEXT NOT NULL,
  started_local TEXT NOT NULL DEFAULT '',
  ended_local TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','needs_info','processing','approved','rejected')),
  manager_note TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id INTEGER REFERENCES app_users(id),
  reviewed_at TEXT,
  apply_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_labor_review_one_pending_entry
ON shop_labor_review_requests(source_labor_entry_id)
WHERE source_labor_entry_id IS NOT NULL AND status IN ('pending','needs_info','processing');
CREATE INDEX IF NOT EXISTS idx_shop_labor_review_queue
ON shop_labor_review_requests(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_shop_labor_review_technician
ON shop_labor_review_requests(technician_id,created_at DESC);
