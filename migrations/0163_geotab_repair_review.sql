PRAGMA foreign_keys = ON;

-- A completed shop repair must not be reopened just because Geotab writeback
-- failed. Keep Geotab reconciliation as a separate manager/admin review queue.
CREATE TABLE IF NOT EXISTS geotab_repair_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE REFERENCES repairs(id) ON DELETE CASCADE,
  geotab_defect_id TEXT NOT NULL,
  geotab_log_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','reopened')),
  failure_reason TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  resolution_type TEXT CHECK (resolution_type IS NULL OR resolution_type IN ('retry_success','already_resolved','reopened')),
  resolution_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_geotab_repair_review_open
ON geotab_repair_review(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_geotab_repair_review_defect
ON geotab_repair_review(geotab_defect_id, status);
