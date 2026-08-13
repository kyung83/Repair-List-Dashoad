PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_require_maintenance_signature_before_ready;
CREATE TRIGGER trg_require_maintenance_signature_before_ready
BEFORE UPDATE OF status ON maintenance_checklist_runs
WHEN NEW.status = 'ready'
  AND OLD.status <> 'ready'
  AND (
    NEW.signed_by_user_id IS NULL
    OR NEW.signed_at IS NULL
    OR trim(COALESCE(NEW.signature_strokes, '')) = ''
  )
BEGIN
  SELECT RAISE(ABORT, 'Technician signature is required before finishing this PM/Annual inspection.');
END;

DROP TRIGGER IF EXISTS trg_clear_maintenance_signature_on_item_change;
CREATE TRIGGER trg_clear_maintenance_signature_on_item_change
AFTER UPDATE OF result, notes ON maintenance_checklist_items
WHEN EXISTS (
  SELECT 1 FROM maintenance_checklist_runs c
  WHERE c.id = NEW.checklist_run_id
    AND c.status = 'in_progress'
    AND c.signature_strokes IS NOT NULL
)
BEGIN
  UPDATE maintenance_checklist_runs
  SET signature_strokes = NULL, signed_by_user_id = NULL, signed_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.checklist_run_id AND status = 'in_progress';
END;
