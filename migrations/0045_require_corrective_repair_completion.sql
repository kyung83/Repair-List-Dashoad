PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_require_corrective_repair_complete_before_clear_fail;

CREATE TRIGGER trg_require_corrective_repair_complete_before_clear_fail
BEFORE UPDATE OF result ON maintenance_checklist_items
WHEN OLD.result = 'fail'
  AND NEW.result IN ('pass', 'na')
  AND EXISTS (
    SELECT 1
    FROM repairs r
    WHERE r.maintenance_checklist_item_id = OLD.id
      AND r.source = 'maintenance-checklist'
      AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete the failed-item repair in Shop Jobs before verifying this checklist item.');
END;
