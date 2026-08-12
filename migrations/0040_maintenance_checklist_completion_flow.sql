PRAGMA foreign_keys = ON;

-- Scheduled PM/annual work orders may only close after their checklist is ready.
CREATE TRIGGER IF NOT EXISTS trg_require_maintenance_checklist_before_complete
BEFORE UPDATE OF status ON repairs
WHEN NEW.source IN ('scheduled-pm','scheduled-annual')
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
  AND NOT EXISTS (
    SELECT 1
    FROM maintenance_checklist_runs c
    WHERE c.repair_id = NEW.id AND c.status = 'ready'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete the PM/annual checklist before closing this work order.');
END;

-- Closing a scheduled PM records history, advances the PM sequence, and resets
-- the PM baseline to the unit's current mileage and today's date.
CREATE TRIGGER IF NOT EXISTS trg_advance_pm_after_checklist_work_order
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-pm'
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
BEGIN
  INSERT OR IGNORE INTO maintenance_events (
    equipment_id, event_type, pm_type, event_date, mileage, notes, source
  )
  SELECT NEW.equipment_id, 'pm',
         COALESCE(ps.pm_type, CAST(json_extract(p.sequence_json, '$[0]') AS TEXT)),
         date('now'), e.current_mileage,
         'Completed from PM checklist work order', printf('checklist-wo-%d', NEW.id)
  FROM equipment e
  JOIN equipment_pm_settings s ON s.equipment_id = e.id
  JOIN pm_profiles p ON p.id = s.profile_id
  LEFT JOIN pm_status ps ON ps.equipment_id = e.id
  WHERE e.id = NEW.equipment_id;

  INSERT INTO pm_status (equipment_id, pm_type, status, last_mileage, service_date, updated_at)
  SELECT
    e.id,
    COALESCE(
      (
        SELECT CAST(next_item.value AS TEXT)
        FROM json_each(p.sequence_json) AS next_item
        WHERE CAST(next_item.key AS INTEGER) = (
          (
            COALESCE(
              (
                SELECT CAST(current_item.key AS INTEGER)
                FROM json_each(p.sequence_json) AS current_item
                WHERE lower(trim(CAST(current_item.value AS TEXT))) = lower(trim(COALESCE(ps.pm_type, CAST(json_extract(p.sequence_json, '$[0]') AS TEXT))))
                LIMIT 1
              ),
              0
            ) + 1
          ) % json_array_length(p.sequence_json)
        )
        LIMIT 1
      ),
      COALESCE(ps.pm_type, CAST(json_extract(p.sequence_json, '$[0]') AS TEXT), 'Service')
    ),
    'Current',
    e.current_mileage,
    date('now'),
    CURRENT_TIMESTAMP
  FROM equipment e
  JOIN equipment_pm_settings s ON s.equipment_id = e.id
  JOIN pm_profiles p ON p.id = s.profile_id
  LEFT JOIN pm_status ps ON ps.equipment_id = e.id
  WHERE e.id = NEW.equipment_id
  ON CONFLICT(equipment_id) DO UPDATE SET
    pm_type = excluded.pm_type,
    status = 'Current',
    last_mileage = COALESCE(excluded.last_mileage, pm_status.last_mileage),
    service_date = excluded.service_date,
    updated_at = CURRENT_TIMESTAMP;

  UPDATE equipment
  SET service_date = date('now'), updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.equipment_id;

  UPDATE maintenance_checklist_runs
  SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE repair_id = NEW.id AND status = 'ready';
END;

-- Closing a scheduled annual records history and resets the annual baseline.
CREATE TRIGGER IF NOT EXISTS trg_advance_annual_after_checklist_work_order
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-annual'
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
BEGIN
  INSERT OR IGNORE INTO maintenance_events (
    equipment_id, event_type, pm_type, event_date, mileage, notes, source
  ) VALUES (
    NEW.equipment_id, 'annual', NULL, date('now'), NULL,
    'Completed from annual inspection checklist work order', printf('checklist-wo-%d', NEW.id)
  );

  INSERT INTO pm_status (equipment_id, annual_date, status, updated_at)
  VALUES (NEW.equipment_id, date('now'), 'Current', CURRENT_TIMESTAMP)
  ON CONFLICT(equipment_id) DO UPDATE SET
    annual_date = excluded.annual_date,
    status = 'Current',
    updated_at = CURRENT_TIMESTAMP;

  UPDATE equipment
  SET annual_date = date('now'), updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.equipment_id;

  UPDATE maintenance_checklist_runs
  SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE repair_id = NEW.id AND status = 'ready';
END;
