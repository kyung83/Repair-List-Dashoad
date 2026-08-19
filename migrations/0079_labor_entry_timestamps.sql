PRAGMA foreign_keys = ON;

-- Preserve exact timer-session boundaries on labor rows so completed work orders can
-- show when a technician worked each repair, even when several timer segments are
-- combined into one repair-level labor total.
ALTER TABLE repair_labor_entries ADD COLUMN started_at TEXT;
ALTER TABLE repair_labor_entries ADD COLUMN ended_at TEXT;

CREATE INDEX IF NOT EXISTS idx_repair_labor_entry_timestamps
ON repair_labor_entries(repair_id, technician_id, started_at, ended_at);

-- Backfill prior timer-created labor entries by pairing them with the audit events
-- written at the same stop. Manual manager-added labor has no labor_stopped event
-- and is intentionally left without an invented timestamp.
UPDATE repair_labor_entries
SET ended_at = (
  SELECT e.created_at
  FROM repair_job_events e
  WHERE e.repair_id = repair_labor_entries.repair_id
    AND e.action = 'labor_stopped'
    AND (
      e.technician_id = repair_labor_entries.technician_id
      OR (e.technician_id IS NULL AND repair_labor_entries.technician_id IS NULL)
    )
    AND ABS(strftime('%s', e.created_at) - strftime('%s', repair_labor_entries.created_at)) <= 10
  ORDER BY ABS(strftime('%s', e.created_at) - strftime('%s', repair_labor_entries.created_at)), e.id
  LIMIT 1
)
WHERE ended_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM repair_job_events e
    WHERE e.repair_id = repair_labor_entries.repair_id
      AND e.action = 'labor_stopped'
      AND (
        e.technician_id = repair_labor_entries.technician_id
        OR (e.technician_id IS NULL AND repair_labor_entries.technician_id IS NULL)
      )
      AND ABS(strftime('%s', e.created_at) - strftime('%s', repair_labor_entries.created_at)) <= 10
  );

UPDATE repair_labor_entries
SET started_at = (
  SELECT e.created_at
  FROM repair_job_events e
  WHERE e.repair_id = repair_labor_entries.repair_id
    AND e.action = 'labor_started'
    AND (
      e.technician_id = repair_labor_entries.technician_id
      OR (e.technician_id IS NULL AND repair_labor_entries.technician_id IS NULL)
    )
    AND e.created_at <= repair_labor_entries.ended_at
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1
)
WHERE started_at IS NULL
  AND ended_at IS NOT NULL;

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
