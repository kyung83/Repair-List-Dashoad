PRAGMA foreign_keys = ON;

-- A DVIR is already visible as an unclaimed Geotab defect on Repair Board, but
-- it becomes a real shop visit only when someone creates/claims the DVIR work
-- order. Match the existing manual/PM/Annual first-visit behavior at that point.
--
-- The source of a real DVIR repair is 'geotab-dvir'. The alternate 'dvir-repair'
-- is supported for older integration rows. Do NOT fire on roadside-breakdown
-- or raw (not yet converted) DVIR defects.
DROP TRIGGER IF EXISTS trg_pull_future_repairs_to_new_dvir_visit;
CREATE TRIGGER trg_pull_future_repairs_to_new_dvir_visit
AFTER INSERT ON repairs
WHEN NEW.source IN ('geotab-dvir', 'dvir-repair')
  AND NEW.equipment_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) NOT LIKE '%complete%'
  AND lower(COALESCE(NEW.status,'')) NOT LIKE 'deferred to next%'
  AND NOT EXISTS (
    SELECT 1 FROM repairs parent
    WHERE parent.equipment_id = NEW.equipment_id
      AND parent.id <> NEW.id
      AND parent.source IN ('scheduled-pm','scheduled-annual')
      AND lower(COALESCE(parent.status,'')) NOT LIKE '%complete%'
  )
BEGIN
  UPDATE pm_next_repairs
  SET status='attached',
      target_repair_id=NEW.id,
      attached_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  WHERE equipment_id=NEW.equipment_id
    AND status='pending' AND target_repair_id IS NULL
    AND repair_id IS NOT NULL;

  UPDATE repairs
  SET technician_id=COALESCE(technician_id,NEW.technician_id),
      status=CASE WHEN COALESCE(technician_id,NEW.technician_id) IS NULL THEN 'New' ELSE 'Assigned' END,
      completed_at=NULL, updated_at=CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT n.repair_id FROM pm_next_repairs n
    WHERE n.target_repair_id=NEW.id AND n.status='attached'
      AND n.repair_id IS NOT NULL
  )
    AND source='maintenance-action'
    AND lower(COALESCE(status,'')) LIKE 'deferred to next%';
END;

-- A converted DVIR may already be on the board before this migration.
-- When its FIRST technician claims it, promote its waiting future work then.
-- Do not backfill every old unassigned DVIR just by installing a migration,
-- and do not re-activate new deferrals when someone later reassigns a job.
DROP TRIGGER IF EXISTS trg_pull_future_repairs_when_dvir_first_claimed;
CREATE TRIGGER trg_pull_future_repairs_when_dvir_first_claimed
AFTER UPDATE OF technician_id ON repairs
WHEN NEW.source IN ('geotab-dvir','dvir-repair')
  AND NEW.equipment_id IS NOT NULL
  AND OLD.technician_id IS NULL AND NEW.technician_id IS NOT NULL
  AND lower(COALESCE(NEW.status,'')) NOT LIKE '%complete%'
  AND lower(COALESCE(NEW.status,'')) NOT LIKE 'deferred to next%'
  AND NOT EXISTS (
    SELECT 1 FROM repairs parent
    WHERE parent.equipment_id = NEW.equipment_id
      AND parent.id <> NEW.id
      AND parent.source IN ('scheduled-pm','scheduled-annual')
      AND lower(COALESCE(parent.status,'')) NOT LIKE '%complete%'
  )
BEGIN
  UPDATE pm_next_repairs
  SET status='attached',
      target_repair_id=NEW.id,
      attached_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  WHERE equipment_id=NEW.equipment_id
    AND status='pending' AND target_repair_id IS NULL
    AND repair_id IS NOT NULL;

  UPDATE repairs
  SET technician_id=COALESCE(technician_id,NEW.technician_id),
      status=CASE WHEN COALESCE(technician_id,NEW.technician_id) IS NULL THEN 'New' ELSE 'Assigned' END,
      completed_at=NULL, updated_at=CURRENT_TIMESTAMP
  WHERE id IN (
    SELECT n.repair_id FROM pm_next_repairs n
    WHERE n.target_repair_id=NEW.id AND n.status='attached'
      AND n.repair_id IS NOT NULL
  )
    AND source='maintenance-action'
    AND lower(COALESCE(status,'')) LIKE 'deferred to next%';
END;

-- Previously, closing a normal repair or converted DVIR while Future Repairs
-- remained incomplete left their queue rows attached to a CLOSED work order.
-- Requeue ONLY the unfinished, originally deferred maintenance-action repairs.
-- Never drop notes/parts/photos/labor; the same child repair ID will be reused
-- when the next legitimate shop visit begins.
--
-- Keep PM/Annual checklist close guards unchanged: those require resolving
-- attached work before a PM/Annual may be finalized.
DROP TRIGGER IF EXISTS trg_block_redefer_attached_real_repair;
CREATE TRIGGER trg_block_redefer_attached_real_repair
BEFORE UPDATE OF status, target_repair_id ON pm_next_repairs
WHEN OLD.repair_id IS NOT NULL
  AND OLD.status='attached'
  AND NEW.status='pending'
  AND NOT (
    OLD.target_repair_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM repairs parent
      WHERE parent.id=OLD.target_repair_id
        AND parent.source IN ('manual','geotab-dvir','dvir-repair')
        AND lower(COALESCE(parent.status,'')) LIKE '%complete%'
    )
    AND EXISTS (
      SELECT 1 FROM repairs child
      WHERE child.id=OLD.repair_id AND child.source='maintenance-action'
        AND lower(COALESCE(child.status,'')) LIKE 'deferred to next%'
    )
  )
BEGIN
  SELECT RAISE(ABORT,'This repair is attached to the current shop visit and cannot be manually removed.');
END;

-- Never silently defer a future repair while a technician still has its labor
-- timer running. Finish/stop active work before closing the parent repair.
DROP TRIGGER IF EXISTS trg_block_close_visit_with_future_active_timer;
CREATE TRIGGER trg_block_close_visit_with_future_active_timer
BEFORE UPDATE OF status ON repairs
WHEN NEW.source IN ('manual','geotab-dvir','dvir-repair')
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
  AND EXISTS (
    SELECT 1 FROM pm_next_repairs n
    JOIN repair_labor_timers timer ON timer.repair_id=n.repair_id
    WHERE n.target_repair_id=NEW.id AND n.status='attached'
  )
BEGIN
  SELECT RAISE(ABORT,'Stop labor on attached Future Repairs before closing this work order.');
END;

DROP TRIGGER IF EXISTS trg_requeue_unfinished_future_repairs_after_repair_visit;
CREATE TRIGGER trg_requeue_unfinished_future_repairs_after_repair_visit
AFTER UPDATE OF status ON repairs
WHEN NEW.source IN ('manual','geotab-dvir','dvir-repair')
  AND lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status,'')) NOT LIKE '%complete%'
BEGIN
  UPDATE repairs
  SET status=CASE
    WHEN EXISTS (
      SELECT 1 FROM pm_next_repairs n
      WHERE n.repair_id=repairs.id AND n.target_repair_id=NEW.id
        AND n.status='attached' AND n.target_event_type='annual'
    ) THEN 'Deferred to Next Annual'
    ELSE 'Deferred to Next PM'
  END,
      technician_id=NULL,
      completed_at=NULL,
      updated_at=CURRENT_TIMESTAMP
  WHERE source='maintenance-action'
    AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    AND id IN (
      SELECT n.repair_id FROM pm_next_repairs n
      WHERE n.target_repair_id=NEW.id AND n.status='attached' AND n.repair_id IS NOT NULL
    );

  UPDATE pm_next_repairs
  SET status='pending', target_repair_id=NULL,
      attached_at=NULL, queued_from_repair_id=NEW.id,
      defer_count=defer_count+1, updated_at=CURRENT_TIMESTAMP
  WHERE target_repair_id=NEW.id AND status='attached'
    AND repair_id IN (
      SELECT r.id FROM repairs r WHERE r.source='maintenance-action'
        AND lower(COALESCE(r.status,'')) LIKE 'deferred to next%'
    );
END;
