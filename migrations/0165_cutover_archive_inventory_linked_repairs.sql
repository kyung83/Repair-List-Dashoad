PRAGMA foreign_keys = ON;

-- Sandbox repairs that already participate in inventory audit history cannot be
-- physically deleted without damaging that audit trail. Mark them as hidden
-- go-live archives instead.
ALTER TABLE repairs ADD COLUMN go_live_archived_at TEXT;
ALTER TABLE repairs ADD COLUMN go_live_archived_by_user_id INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS idx_repairs_go_live_archived
ON repairs(go_live_archived_at, id);

ALTER TABLE go_live_cutover_runs ADD COLUMN sandbox_repairs_archived INTEGER NOT NULL DEFAULT 0;
