PRAGMA foreign_keys = ON;

ALTER TABLE custom_maintenance_events ADD COLUMN repair_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_maintenance_events_repair
ON custom_maintenance_events(repair_id)
WHERE repair_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_complete_custom_maintenance_repair;
CREATE TRIGGER trg_complete_custom_maintenance_repair
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'custom-maintenance'
  AND NEW.equipment_id IS NOT NULL
  AND NEW.maintenance_program_step_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
BEGIN
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
    e.current_mileage,
    'repair-board',
    NEW.id
  FROM maintenance_program_steps s
  LEFT JOIN equipment e ON e.id = NEW.equipment_id
  WHERE s.id = NEW.maintenance_program_step_id;

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
        SELECT current_mileage FROM equipment WHERE id = NEW.equipment_id
      ),
      rotation_last_date = COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND program_id = (
      SELECT program_id FROM maintenance_program_steps WHERE id = NEW.maintenance_program_step_id
    )
    AND rotation_position = (
      SELECT position FROM maintenance_program_steps WHERE id = NEW.maintenance_program_step_id
    )
    AND EXISTS (
      SELECT 1
      FROM maintenance_program_steps s
      WHERE s.id = NEW.maintenance_program_step_id
        AND s.step_type = 'rotation'
        AND s.active = 1
    );

  INSERT INTO equipment_maintenance_step_status (
    equipment_id,
    program_step_id,
    last_mileage,
    last_date,
    last_completed_at,
    updated_at
  )
  SELECT
    NEW.equipment_id,
    s.id,
    e.current_mileage,
    COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM maintenance_program_steps s
  JOIN equipment_maintenance_programs a
    ON a.equipment_id = NEW.equipment_id
   AND a.program_id = s.program_id
  LEFT JOIN equipment e ON e.id = NEW.equipment_id
  WHERE s.id = NEW.maintenance_program_step_id
    AND s.step_type = 'interval'
    AND s.active = 1
  ON CONFLICT(equipment_id, program_step_id) DO UPDATE SET
    last_mileage = excluded.last_mileage,
    last_date = excluded.last_date,
    last_completed_at = excluded.last_completed_at,
    updated_at = CURRENT_TIMESTAMP;

  INSERT INTO equipment_maintenance_step_status (
    equipment_id,
    program_step_id,
    last_mileage,
    last_date,
    last_completed_at,
    updated_at
  )
  SELECT
    NEW.equipment_id,
    reset_step.id,
    e.current_mileage,
    COALESCE(NULLIF(substr(COALESCE(NEW.completed_at,''),1,10),''), date('now')),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM maintenance_program_steps completed_step
  JOIN equipment_maintenance_programs a
    ON a.equipment_id = NEW.equipment_id
   AND a.program_id = completed_step.program_id
  JOIN json_each(COALESCE(completed_step.resets_item_ids_json,'[]')) reset_item
  JOIN maintenance_program_steps reset_step
    ON reset_step.program_id = completed_step.program_id
   AND reset_step.step_type = 'interval'
   AND reset_step.active = 1
   AND reset_step.maintenance_item_id = CAST(reset_item.value AS INTEGER)
  LEFT JOIN equipment e ON e.id = NEW.equipment_id
  WHERE completed_step.id = NEW.maintenance_program_step_id
    AND completed_step.step_type = 'interval'
    AND completed_step.active = 1
  ON CONFLICT(equipment_id, program_step_id) DO UPDATE SET
    last_mileage = excluded.last_mileage,
    last_date = excluded.last_date,
    last_completed_at = excluded.last_completed_at,
    updated_at = CURRENT_TIMESTAMP;
END;
