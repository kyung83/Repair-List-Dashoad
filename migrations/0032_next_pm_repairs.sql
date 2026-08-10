PRAGMA foreign_keys = ON;

-- Technician findings that should follow a unit to its next scheduled PM.
-- A finding starts pending, is attached automatically when the next scheduled-PM
-- work order is created, and can then be completed or deferred again.
CREATE TABLE IF NOT EXISTS pm_next_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attached', 'completed', 'cancelled')),
  origin_repair_id INTEGER,
  queued_from_repair_id INTEGER,
  target_repair_id INTEGER,
  tagged_by_user_id INTEGER,
  tagged_by_technician_id INTEGER,
  tagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attached_at TEXT,
  defer_count INTEGER NOT NULL DEFAULT 0 CHECK (defer_count >= 0),
  completed_at TEXT,
  completed_by_user_id INTEGER,
  cancelled_at TEXT,
  cancelled_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (origin_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (queued_from_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (target_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (tagged_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (tagged_by_technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (cancelled_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (length(trim(description)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_pm_next_repairs_pending
ON pm_next_repairs(equipment_id, status, target_repair_id);

CREATE INDEX IF NOT EXISTS idx_pm_next_repairs_target
ON pm_next_repairs(target_repair_id, status);

CREATE INDEX IF NOT EXISTS idx_pm_next_repairs_queued_from
ON pm_next_repairs(queued_from_repair_id, status);

-- When the next scheduled PM repair is created, claim every pending follow-up for
-- that unit. The item remains a separate record so it can be completed or pushed
-- forward again without changing the PM work order itself.
CREATE TRIGGER IF NOT EXISTS trg_attach_next_pm_repairs_to_new_pm
AFTER INSERT ON repairs
WHEN NEW.source = 'scheduled-pm' AND NEW.equipment_id IS NOT NULL
BEGIN
  UPDATE pm_next_repairs
  SET status = 'attached',
      target_repair_id = NEW.id,
      attached_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND status = 'pending'
    AND target_repair_id IS NULL;
END;
