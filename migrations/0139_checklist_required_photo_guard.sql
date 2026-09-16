PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_keep_required_checklist_photo_after_answer
BEFORE DELETE ON maintenance_checklist_photos
WHEN EXISTS (
  SELECT 1
  FROM maintenance_checklist_items i
  WHERE i.id = OLD.checklist_item_id
    AND i.require_photo = 1
    AND i.result <> 'pending'
)
AND NOT EXISTS (
  SELECT 1
  FROM maintenance_checklist_photos p
  WHERE p.checklist_item_id = OLD.checklist_item_id
    AND p.id <> OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'This photo is required for the answered checklist item. Change the answer first or add another photo before removing it.');
END;
