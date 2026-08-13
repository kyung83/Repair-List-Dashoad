PRAGMA foreign_keys = ON;

-- A deferred repair means "do it the next time this unit is in the shop",
-- regardless of whether it was originally tagged Next PM or Next Annual.
-- Keep the original target_event_type for history/reporting, but once a real
-- scheduled maintenance or manual repair visit opens, pull both types in.

DROP TRIGGER IF EXISTS trg_pull_all_future_repairs_to_new_scheduled;
CREATE TRIGGER trg_pull_all_future_repairs_to_new_scheduled
AFTER INSERT ON repairs
WHEN NEW.source IN ('scheduled-pm', 'scheduled-annual')
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status, '')) NOT LIKE '%complete%'
BEGIN
  UPDATE pm_next_repairs
  SET status = 'attached',
      target_repair_id = NEW.id,
      attached_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND status = 'pending'
    AND target_repair_id IS NULL;

  UPDATE repairs
  SET technician_id = COALESCE(technician_id, NEW.technician_id),
      status = CASE
        WHEN COALESCE(technician_id, NEW.technician_id) IS NULL THEN 'New'
        ELSE 'Assigned'
      END,
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT n.repair_id
    FROM pm_next_repairs n
    WHERE n.target_repair_id = NEW.id
      AND n.status = 'attached'
      AND n.repair_id IS NOT NULL
  )
    AND lower(COALESCE(status, '')) LIKE 'deferred to next%';
END;

DROP TRIGGER IF EXISTS trg_pull_all_future_repairs_to_new_manual;
CREATE TRIGGER trg_pull_all_future_repairs_to_new_manual
AFTER INSERT ON repairs
WHEN NEW.source = 'manual'
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status, '')) NOT LIKE '%complete%'
  AND lower(COALESCE(NEW.status, '')) NOT LIKE 'deferred to next%'
  AND NOT EXISTS (
    SELECT 1
    FROM repairs parent
    WHERE parent.equipment_id = NEW.equipment_id
      AND parent.id <> NEW.id
      AND parent.source IN ('scheduled-pm', 'scheduled-annual')
      AND lower(COALESCE(parent.status, '')) NOT LIKE '%complete%'
  )
BEGIN
  UPDATE pm_next_repairs
  SET status = 'attached',
      target_repair_id = NEW.id,
      attached_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND status = 'pending'
    AND target_repair_id IS NULL;

  UPDATE repairs
  SET technician_id = COALESCE(technician_id, NEW.technician_id),
      status = CASE
        WHEN COALESCE(technician_id, NEW.technician_id) IS NULL THEN 'New'
        ELSE 'Assigned'
      END,
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT n.repair_id
    FROM pm_next_repairs n
    WHERE n.target_repair_id = NEW.id
      AND n.status = 'attached'
      AND n.repair_id IS NOT NULL
  )
    AND lower(COALESCE(status, '')) LIKE 'deferred to next%';
END;

-- If the parent visit is assigned after creation, keep the pulled future work
-- with that technician. This only follows actual deferred maintenance-action
-- repairs; ordinary repairs attached to a PM/Annual keep their own assignment.
DROP TRIGGER IF EXISTS trg_follow_pulled_future_repair_assignment;
CREATE TRIGGER trg_follow_pulled_future_repair_assignment
AFTER UPDATE OF technician_id ON repairs
WHEN COALESCE(OLD.technician_id, 0) <> COALESCE(NEW.technician_id, 0)
BEGIN
  UPDATE repairs
  SET technician_id = NEW.technician_id,
      status = CASE
        WHEN NEW.technician_id IS NULL AND status = 'Assigned' THEN 'New'
        WHEN NEW.technician_id IS NOT NULL AND status = 'New' THEN 'Assigned'
        ELSE status
      END,
      updated_at = CURRENT_TIMESTAMP
  WHERE source = 'maintenance-action'
    AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
    AND id IN (
      SELECT n.repair_id
      FROM pm_next_repairs n
      WHERE n.target_repair_id = NEW.id
        AND n.status = 'attached'
        AND n.repair_id IS NOT NULL
    );
END;

-- Backfill visits that are already open when this migration lands. Prefer an
-- open scheduled PM/Annual; if there is none, use the newest open manual repair.
UPDATE pm_next_repairs
SET target_repair_id = (
      SELECT parent.id
      FROM repairs parent
      WHERE parent.equipment_id = pm_next_repairs.equipment_id
        AND parent.source IN ('scheduled-pm', 'scheduled-annual')
        AND lower(COALESCE(parent.status, '')) NOT LIKE '%complete%'
      ORDER BY parent.id DESC
      LIMIT 1
    ),
    status = 'attached',
    attached_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending'
  AND target_repair_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM repairs parent
    WHERE parent.equipment_id = pm_next_repairs.equipment_id
      AND parent.source IN ('scheduled-pm', 'scheduled-annual')
      AND lower(COALESCE(parent.status, '')) NOT LIKE '%complete%'
  );

UPDATE pm_next_repairs
SET target_repair_id = (
      SELECT parent.id
      FROM repairs parent
      WHERE parent.equipment_id = pm_next_repairs.equipment_id
        AND parent.source = 'manual'
        AND lower(COALESCE(parent.status, '')) NOT LIKE '%complete%'
        AND lower(COALESCE(parent.status, '')) NOT LIKE 'deferred to next%'
      ORDER BY parent.id DESC
      LIMIT 1
    ),
    status = 'attached',
    attached_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending'
  AND target_repair_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM repairs parent
    WHERE parent.equipment_id = pm_next_repairs.equipment_id
      AND parent.source = 'manual'
      AND lower(COALESCE(parent.status, '')) NOT LIKE '%complete%'
      AND lower(COALESCE(parent.status, '')) NOT LIKE 'deferred to next%'
  );

-- Activate any real deferred repair that the backfill just attached and inherit
-- the current visit's technician when there is one.
UPDATE repairs
SET technician_id = COALESCE(
      technician_id,
      (
        SELECT parent.technician_id
        FROM pm_next_repairs n
        JOIN repairs parent ON parent.id = n.target_repair_id
        WHERE n.repair_id = repairs.id
          AND n.status = 'attached'
          AND n.target_repair_id IS NOT NULL
        ORDER BY n.id DESC
        LIMIT 1
      )
    ),
    status = CASE
      WHEN COALESCE(
        technician_id,
        (
          SELECT parent.technician_id
          FROM pm_next_repairs n
          JOIN repairs parent ON parent.id = n.target_repair_id
          WHERE n.repair_id = repairs.id
            AND n.status = 'attached'
            AND n.target_repair_id IS NOT NULL
          ORDER BY n.id DESC
          LIMIT 1
        )
      ) IS NULL THEN 'New'
      ELSE 'Assigned'
    END,
    completed_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'maintenance-action'
  AND lower(COALESCE(status, '')) LIKE 'deferred to next%'
  AND EXISTS (
    SELECT 1
    FROM pm_next_repairs n
    WHERE n.repair_id = repairs.id
      AND n.status = 'attached'
      AND n.target_repair_id IS NOT NULL
  );
