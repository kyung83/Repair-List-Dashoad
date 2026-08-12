PRAGMA foreign_keys = ON;

ALTER TABLE maintenance_checklist_runs ADD COLUMN mileage_at_start INTEGER;
ALTER TABLE maintenance_checklist_runs ADD COLUMN mileage_at_completion INTEGER;
ALTER TABLE maintenance_checklist_runs ADD COLUMN mileage_source TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN mileage_updated_at TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN ready_by_user_id INTEGER;

UPDATE maintenance_checklist_runs
SET mileage_at_start = (
      SELECT e.current_mileage FROM equipment e WHERE e.id = maintenance_checklist_runs.equipment_id
    ),
    mileage_source = CASE
      WHEN EXISTS (
        SELECT 1 FROM equipment e
        WHERE e.id = maintenance_checklist_runs.equipment_id
          AND e.geotab_device_id IS NOT NULL AND trim(e.geotab_device_id) <> ''
      ) THEN 'Geotab'
      ELSE 'Manual'
    END,
    mileage_updated_at = (
      SELECT e.mileage_updated_at FROM equipment e WHERE e.id = maintenance_checklist_runs.equipment_id
    )
WHERE mileage_at_start IS NULL;
