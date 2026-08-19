PRAGMA foreign_keys = ON;

-- Preserve exact timer-session boundaries on labor rows so completed work orders can
-- show when a technician worked each repair, even when several timer segments are
-- combined into one repair-level labor total.
ALTER TABLE repair_labor_entries ADD COLUMN started_at TEXT;
ALTER TABLE repair_labor_entries ADD COLUMN ended_at TEXT;

CREATE INDEX IF NOT EXISTS idx_repair_labor_entry_timestamps
ON repair_labor_entries(repair_id, technician_id, started_at, ended_at);

-- Timer-driven inserts happen while the active repair_labor_timers row still exists.
-- Capture its exact start and the stop time automatically; manager/manual labor rows
-- have no active timer and therefore remain timestamp-free rather than misleading.
CREATE TRIGGER IF NOT EXISTS trg_repair_labor_capture_timer_timestamps
AFTER INSERT ON repair_labor_entries
WHEN EXISTS (
  SELECT 1
  FROM repair_labor_timers rt
  WHERE rt.repair_id = NEW.repair_id
    AND rt.technician_id = NEW.technician_id
)
BEGIN
  UPDATE repair_labor_entries
  SET started_at = (
        SELECT rt.started_at
        FROM repair_labor_timers rt
        WHERE rt.repair_id = NEW.repair_id
          AND rt.technician_id = NEW.technician_id
        ORDER BY rt.started_at DESC
        LIMIT 1
      ),
      ended_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
