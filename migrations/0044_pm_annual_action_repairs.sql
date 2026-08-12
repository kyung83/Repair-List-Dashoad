PRAGMA foreign_keys = ON;

-- Generalize the existing next-PM queue into a PM/Annual maintenance action link.
-- Every active queue item owns a real repair so parts can be planned before
-- the target maintenance visit without consuming inventory.
ALTER TABLE pm_next_repairs
ADD COLUMN repair_id INTEGER REFERENCES repairs(id) ON DELETE SET NULL;

ALTER TABLE pm_next_repairs
ADD COLUMN target_event_type TEXT NOT NULL DEFAULT 'pm'
CHECK (target_event_type IN ('pm', 'annual'));

CREATE INDEX IF NOT EXISTS idx_pm_next_repairs_repair
ON pm_next_repairs(repair_id, status);

CREATE INDEX IF NOT EXISTS idx_pm_next_repairs_event_pending
ON pm_next_repairs(equipment_id, target_event_type, status, target_repair_id);

DROP TRIGGER IF EXISTS trg_attach_next_pm_repairs_to_new_pm;
DROP TRIGGER IF EXISTS trg_requeue_unfinished_next_pm_repairs;

-- Convert existing attached Next PM items into active real repairs.
INSERT INTO repairs (
  equipment_id, title, description, status, source, technician_id,
  opened_at, updated_at
)
SELECT
  n.equipment_id,
  '[MAINT-ACTION-' || n.id || '] ' || substr(n.description, 1, 440),
  n.description,
  'New',
  'maintenance-action',
  COALESCE(
    (SELECT r.technician_id FROM repairs r WHERE r.id = n.target_repair_id),
    n.tagged_by_technician_id
  ),
  COALESCE(n.tagged_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM pm_next_repairs n
WHERE n.repair_id IS NULL
  AND n.status = 'attached';

-- Convert existing pending Next PM items into deferred real repairs.
INSERT INTO repairs (
  equipment_id, title, description, status, source, technician_id,
  opened_at, updated_at
)
SELECT
  n.equipment_id,
  '[MAINT-ACTION-' || n.id || '] ' || substr(n.description, 1, 440),
  n.description,
  'Deferred to Next PM',
  'maintenance-action',
  NULL,
  COALESCE(n.tagged_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM pm_next_repairs n
WHERE n.repair_id IS NULL
  AND n.status = 'pending';

UPDATE pm_next_repairs
SET repair_id = (
  SELECT r.id
  FROM repairs r
  WHERE r.source = 'maintenance-action'
    AND r.title = '[MAINT-ACTION-' || pm_next_repairs.id || '] ' || substr(pm_next_repairs.description, 1, 440)
  ORDER BY r.id DESC
  LIMIT 1
)
WHERE repair_id IS NULL
  AND status IN ('pending', 'attached');

UPDATE repairs
SET title = COALESCE((
      SELECT n.description
      FROM pm_next_repairs n
      WHERE n.repair_id = repairs.id
      ORDER BY n.id
      LIMIT 1
    ), title),
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'maintenance-action'
  AND title LIKE '[MAINT-ACTION-%';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pm_next_repairs_repair_target_unique
ON pm_next_repairs(repair_id, target_repair_id)
WHERE repair_id IS NOT NULL AND target_repair_id IS NOT NULL;

-- Attach existing open repairs to any PM that is already open.
INSERT OR IGNORE INTO pm_next_repairs (
  equipment_id, description, status, origin_repair_id, queued_from_repair_id,
  target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
)
SELECT
  target.equipment_id,
  child.title,
  'attached',
  target.id,
  child.id,
  target.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  child.id,
  'pm'
FROM repairs target
JOIN repairs child
  ON child.equipment_id = target.equipment_id
 AND child.id <> target.id
WHERE target.source = 'scheduled-pm'
  AND lower(COALESCE(target.status, '')) NOT LIKE '%complete%'
  AND child.source NOT IN ('scheduled-pm', 'scheduled-annual')
  AND lower(COALESCE(child.status, '')) NOT LIKE '%complete%'
  AND lower(COALESCE(child.status, '')) NOT LIKE 'deferred to next%'
  AND NOT EXISTS (
    SELECT 1
    FROM pm_next_repairs n
    WHERE n.repair_id = child.id
      AND n.target_repair_id = target.id
  );

-- Attach existing open repairs to any Annual that is already open.
INSERT OR IGNORE INTO pm_next_repairs (
  equipment_id, description, status, origin_repair_id, queued_from_repair_id,
  target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
)
SELECT
  target.equipment_id,
  child.title,
  'attached',
  target.id,
  child.id,
  target.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  child.id,
  'annual'
FROM repairs target
JOIN repairs child
  ON child.equipment_id = target.equipment_id
 AND child.id <> target.id
WHERE target.source = 'scheduled-annual'
  AND lower(COALESCE(target.status, '')) NOT LIKE '%complete%'
  AND child.source NOT IN ('scheduled-pm', 'scheduled-annual')
  AND lower(COALESCE(child.status, '')) NOT LIKE '%complete%'
  AND lower(COALESCE(child.status, '')) NOT LIKE 'deferred to next%'
  AND NOT EXISTS (
    SELECT 1
    FROM pm_next_repairs n
    WHERE n.repair_id = child.id
      AND n.target_repair_id = target.id
  );

-- New PM: activate PM-deferred repairs and attach all other open repairs.
CREATE TRIGGER trg_attach_maintenance_actions_to_new_pm
AFTER INSERT ON repairs
WHEN NEW.source = 'scheduled-pm'
  AND NEW.equipment_id IS NOT NULL
BEGIN
  UPDATE pm_next_repairs
  SET status = 'attached',
      target_repair_id = NEW.id,
      attached_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND status = 'pending'
    AND target_repair_id IS NULL
    AND target_event_type = 'pm';

  UPDATE repairs
  SET status = 'New',
      technician_id = COALESCE(technician_id, NEW.technician_id),
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

  INSERT OR IGNORE INTO pm_next_repairs (
    equipment_id, description, status, origin_repair_id, queued_from_repair_id,
    target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
  )
  SELECT
    NEW.equipment_id,
    r.title,
    'attached',
    NEW.id,
    r.id,
    NEW.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    r.id,
    'pm'
  FROM repairs r
  WHERE r.equipment_id = NEW.equipment_id
    AND r.id <> NEW.id
    AND r.source NOT IN ('scheduled-pm', 'scheduled-annual')
    AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
    AND lower(COALESCE(r.status, '')) NOT LIKE 'deferred to next%'
    AND NOT EXISTS (
      SELECT 1
      FROM pm_next_repairs n
      WHERE n.repair_id = r.id
        AND n.target_repair_id = NEW.id
    );
END;

-- New Annual: activate Annual-deferred repairs and attach all other open repairs.
CREATE TRIGGER trg_attach_maintenance_actions_to_new_annual
AFTER INSERT ON repairs
WHEN NEW.source = 'scheduled-annual'
  AND NEW.equipment_id IS NOT NULL
BEGIN
  UPDATE pm_next_repairs
  SET status = 'attached',
      target_repair_id = NEW.id,
      attached_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE equipment_id = NEW.equipment_id
    AND status = 'pending'
    AND target_repair_id IS NULL
    AND target_event_type = 'annual';

  UPDATE repairs
  SET status = 'New',
      technician_id = COALESCE(technician_id, NEW.technician_id),
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

  INSERT OR IGNORE INTO pm_next_repairs (
    equipment_id, description, status, origin_repair_id, queued_from_repair_id,
    target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
  )
  SELECT
    NEW.equipment_id,
    r.title,
    'attached',
    NEW.id,
    r.id,
    NEW.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    r.id,
    'annual'
  FROM repairs r
  WHERE r.equipment_id = NEW.equipment_id
    AND r.id <> NEW.id
    AND r.source NOT IN ('scheduled-pm', 'scheduled-annual')
    AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
    AND lower(COALESCE(r.status, '')) NOT LIKE 'deferred to next%'
    AND NOT EXISTS (
      SELECT 1
      FROM pm_next_repairs n
      WHERE n.repair_id = r.id
        AND n.target_repair_id = NEW.id
    );
END;

-- Normal repair created while a PM is open becomes required on that PM.
CREATE TRIGGER trg_attach_new_repair_to_open_pm
AFTER INSERT ON repairs
WHEN NEW.equipment_id IS NOT NULL
  AND NEW.source NOT IN ('scheduled-pm', 'scheduled-annual')
  AND lower(COALESCE(NEW.status, '')) NOT LIKE '%complete%'
  AND lower(COALESCE(NEW.status, '')) NOT LIKE 'deferred to next%'
BEGIN
  INSERT OR IGNORE INTO pm_next_repairs (
    equipment_id, description, status, origin_repair_id, queued_from_repair_id,
    target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
  )
  SELECT
    NEW.equipment_id,
    NEW.title,
    'attached',
    target.id,
    NEW.id,
    target.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    NEW.id,
    'pm'
  FROM repairs target
  WHERE target.equipment_id = NEW.equipment_id
    AND target.source = 'scheduled-pm'
    AND lower(COALESCE(target.status, '')) NOT LIKE '%complete%'
    AND NOT EXISTS (
      SELECT 1
      FROM pm_next_repairs n
      WHERE n.repair_id = NEW.id
        AND n.target_repair_id = target.id
    );
END;

-- Normal repair created while an Annual is open becomes required on that Annual.
CREATE TRIGGER trg_attach_new_repair_to_open_annual
AFTER INSERT ON repairs
WHEN NEW.equipment_id IS NOT NULL
  AND NEW.source NOT IN ('scheduled-pm', 'scheduled-annual')
  AND lower(COALESCE(NEW.status, '')) NOT LIKE '%complete%'
  AND lower(COALESCE(NEW.status, '')) NOT LIKE 'deferred to next%'
BEGIN
  INSERT OR IGNORE INTO pm_next_repairs (
    equipment_id, description, status, origin_repair_id, queued_from_repair_id,
    target_repair_id, tagged_at, attached_at, updated_at, repair_id, target_event_type
  )
  SELECT
    NEW.equipment_id,
    NEW.title,
    'attached',
    target.id,
    NEW.id,
    target.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    NEW.id,
    'annual'
  FROM repairs target
  WHERE target.equipment_id = NEW.equipment_id
    AND target.source = 'scheduled-annual'
    AND lower(COALESCE(target.status, '')) NOT LIKE '%complete%'
    AND NOT EXISTS (
      SELECT 1
      FROM pm_next_repairs n
      WHERE n.repair_id = NEW.id
        AND n.target_repair_id = target.id
    );
END;

-- Completing the real repair completes every maintenance attachment that points to it.
CREATE TRIGGER trg_complete_maintenance_action_links
AFTER UPDATE OF status ON repairs
WHEN lower(COALESCE(NEW.status, '')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status, '')) NOT LIKE '%complete%'
BEGIN
  UPDATE pm_next_repairs
  SET status = 'completed',
      completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE repair_id = NEW.id
    AND status IN ('pending', 'attached');
END;

-- Old Next-PM controls cannot re-defer or administratively complete a real repair.
CREATE TRIGGER trg_block_redefer_attached_real_repair
BEFORE UPDATE OF status, target_repair_id ON pm_next_repairs
WHEN OLD.repair_id IS NOT NULL
  AND OLD.status = 'attached'
  AND NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'This repair is attached to the current PM/Annual and must be completed before closing it.');
END;

CREATE TRIGGER trg_block_manual_complete_attached_real_repair
BEFORE UPDATE OF status ON pm_next_repairs
WHEN OLD.repair_id IS NOT NULL
  AND NEW.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM repairs r
    WHERE r.id = OLD.repair_id
      AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete the actual repair in Shop Jobs before marking this maintenance action complete.');
END;

-- Cancelling a still-deferred future item closes its real repair record too.
CREATE TRIGGER trg_cancel_deferred_maintenance_action_repair
AFTER UPDATE OF status ON pm_next_repairs
WHEN OLD.repair_id IS NOT NULL
  AND OLD.status = 'pending'
  AND NEW.status = 'cancelled'
BEGIN
  UPDATE repairs
  SET status = 'Completed - Cancelled Future Work',
      completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.repair_id
    AND lower(COALESCE(status, '')) LIKE 'deferred to next%';
END;

-- The inspection cannot be marked ready while an attached real repair is open.
CREATE TRIGGER trg_block_checklist_ready_with_open_repairs
BEFORE UPDATE OF status ON maintenance_checklist_runs
WHEN NEW.status = 'ready'
  AND OLD.status <> 'ready'
  AND EXISTS (
    SELECT 1
    FROM pm_next_repairs n
    JOIN repairs r ON r.id = n.repair_id
    WHERE n.target_repair_id = NEW.repair_id
      AND n.status <> 'cancelled'
      AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete all repairs attached to this PM/Annual before finishing the inspection.');
END;

-- Defense in depth: the scheduled maintenance work order cannot close either.
CREATE TRIGGER trg_block_maintenance_close_with_open_repairs
BEFORE UPDATE OF status ON repairs
WHEN NEW.source IN ('scheduled-pm', 'scheduled-annual')
  AND lower(COALESCE(NEW.status, '')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status, '')) NOT LIKE '%complete%'
  AND EXISTS (
    SELECT 1
    FROM pm_next_repairs n
    JOIN repairs r ON r.id = n.repair_id
    WHERE n.target_repair_id = NEW.id
      AND n.status <> 'cancelled'
      AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete all repairs attached to this PM/Annual before closing the work order.');
END;
