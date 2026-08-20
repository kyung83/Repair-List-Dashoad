PRAGMA foreign_keys = ON;

-- PM/Annual completion is governed by the completed checklist and signature,
-- never by whether Geotab happened to return a fresh odometer. Use the mileage
-- captured on the checklist (fresh Geotab, verified manual, stale last-known,
-- or NULL when unavailable) as the permanent maintenance record.

DROP TRIGGER IF EXISTS trg_advance_pm_after_checklist_work_order;
CREATE TRIGGER trg_advance_pm_after_checklist_work_order
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
         date('now'), c.mileage_at_completion,
         CASE
           WHEN COALESCE(TRIM(c.mileage_source),'') = '' THEN 'Completed from PM checklist work order'
           ELSE 'Completed from PM checklist work order; mileage source: ' || c.mileage_source
         END,
         printf('checklist-wo-%d', NEW.id)
  FROM equipment e
  JOIN equipment_pm_settings s ON s.equipment_id = e.id
  JOIN pm_profiles p ON p.id = s.profile_id
  LEFT JOIN pm_status ps ON ps.equipment_id = e.id
  JOIN maintenance_checklist_runs c ON c.repair_id = NEW.id AND c.status = 'ready'
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
    c.mileage_at_completion,
    date('now'),
    CURRENT_TIMESTAMP
  FROM equipment e
  JOIN equipment_pm_settings s ON s.equipment_id = e.id
  JOIN pm_profiles p ON p.id = s.profile_id
  LEFT JOIN pm_status ps ON ps.equipment_id = e.id
  JOIN maintenance_checklist_runs c ON c.repair_id = NEW.id AND c.status = 'ready'
  WHERE e.id = NEW.equipment_id
  ON CONFLICT(equipment_id) DO UPDATE SET
    pm_type = excluded.pm_type,
    status = 'Current',
    last_mileage = excluded.last_mileage,
    service_date = excluded.service_date,
    updated_at = CURRENT_TIMESTAMP;

  UPDATE equipment
  SET service_date = date('now'), updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.equipment_id;

  UPDATE maintenance_checklist_runs
  SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE repair_id = NEW.id AND status = 'ready';
END;

DROP TRIGGER IF EXISTS trg_advance_annual_after_checklist_work_order;
CREATE TRIGGER trg_advance_annual_after_checklist_work_order
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-annual'
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
BEGIN
  INSERT OR IGNORE INTO maintenance_events (
    equipment_id, event_type, pm_type, event_date, mileage, notes, source
  )
  SELECT NEW.equipment_id, 'annual', NULL, date('now'), c.mileage_at_completion,
         CASE
           WHEN COALESCE(TRIM(c.mileage_source),'') = '' THEN 'Completed from annual inspection checklist work order'
           ELSE 'Completed from annual inspection checklist work order; mileage source: ' || c.mileage_source
         END,
         printf('checklist-wo-%d', NEW.id)
  FROM maintenance_checklist_runs c
  WHERE c.repair_id = NEW.id AND c.status = 'ready';

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