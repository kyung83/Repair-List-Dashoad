PRAGMA foreign_keys = ON;

-- Legacy scheduled PMs continue to advance pm_status, but only when they are
-- not linked to a custom maintenance-program rotation step.
DROP TRIGGER IF EXISTS trg_advance_pm_after_checklist_work_order;
CREATE TRIGGER trg_advance_pm_after_checklist_work_order
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-pm'
  AND NEW.equipment_id IS NOT NULL
  AND NEW.maintenance_program_step_id IS NULL
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

-- A custom rotation step is still a real PM. It uses the same PM checklist and
-- signature workflow, but completion advances the custom program instead of
-- the legacy pm_status rotation.
DROP TRIGGER IF EXISTS trg_advance_custom_rotation_after_checklist_work_order;
CREATE TRIGGER trg_advance_custom_rotation_after_checklist_work_order
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-pm'
  AND NEW.equipment_id IS NOT NULL
  AND NEW.maintenance_program_step_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
  AND EXISTS (
    SELECT 1
    FROM maintenance_program_steps s
    JOIN equipment_maintenance_programs a
      ON a.equipment_id = NEW.equipment_id
     AND a.program_id = s.program_id
    WHERE s.id = NEW.maintenance_program_step_id
      AND s.step_type = 'rotation'
      AND s.active = 1
  )
BEGIN
  INSERT OR IGNORE INTO maintenance_events (
    equipment_id, event_type, pm_type, event_date, mileage, notes, source
  )
  SELECT
    NEW.equipment_id,
    'pm',
    i.name,
    COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
    c.mileage_at_completion,
    CASE
      WHEN COALESCE(TRIM(c.mileage_source),'') = '' THEN 'Completed from custom rotational PM checklist work order'
      ELSE 'Completed from custom rotational PM checklist work order; mileage source: ' || c.mileage_source
    END,
    printf('checklist-custom-wo-%d', NEW.id)
  FROM maintenance_program_steps s
  JOIN maintenance_items i ON i.id = s.maintenance_item_id
  JOIN maintenance_checklist_runs c ON c.repair_id = NEW.id AND c.status = 'ready'
  WHERE s.id = NEW.maintenance_program_step_id
    AND s.step_type = 'rotation';

  INSERT OR IGNORE INTO custom_maintenance_events (
    equipment_id,
    program_id,
    program_step_id,
    maintenance_item_id,
    event_date,
    mileage,
    source,
    repair_id
  )
  SELECT
    NEW.equipment_id,
    s.program_id,
    s.id,
    s.maintenance_item_id,
    COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
    c.mileage_at_completion,
    'repair-board',
    NEW.id
  FROM maintenance_program_steps s
  JOIN maintenance_checklist_runs c ON c.repair_id = NEW.id AND c.status = 'ready'
  WHERE s.id = NEW.maintenance_program_step_id
    AND s.step_type = 'rotation';

  UPDATE equipment_maintenance_programs
  SET rotation_position = (
        SELECT (s.position + 1) % (
          SELECT COUNT(*)
          FROM maintenance_program_steps r
          WHERE r.program_id = s.program_id
            AND r.step_type = 'rotation'
            AND r.active = 1
        )
        FROM maintenance_program_steps s
        WHERE s.id = NEW.maintenance_program_step_id
      ),
      rotation_last_mileage = (
        SELECT c.mileage_at_completion
        FROM maintenance_checklist_runs c
        WHERE c.repair_id = NEW.id AND c.status = 'ready'
        LIMIT 1
      ),
      rotation_last_date = COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND program_id = (
      SELECT program_id
      FROM maintenance_program_steps
      WHERE id = NEW.maintenance_program_step_id
    )
    AND rotation_position = (
      SELECT position
      FROM maintenance_program_steps
      WHERE id = NEW.maintenance_program_step_id
    );

  UPDATE maintenance_checklist_runs
  SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE repair_id = NEW.id AND status = 'ready';
END;
