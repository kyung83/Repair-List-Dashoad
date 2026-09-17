PRAGMA foreign_keys = ON;

-- A failed NEW EQUIPMENT CHECK or LOOK OVER item creates a normal corrective
-- repair. Keep that child repair in the same Repair Type so review/reporting
-- never loses the category.
CREATE TRIGGER IF NOT EXISTS repair_type_checklist_corrective_category
AFTER UPDATE OF corrective_repair_id ON repair_type_checklist_items
WHEN NEW.corrective_repair_id IS NOT NULL
BEGIN
  UPDATE repairs
  SET repair_type_id = (
    SELECT run.repair_type_id
    FROM repair_type_checklist_runs run
    WHERE run.id = NEW.checklist_run_id
  ),
  updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.corrective_repair_id
    AND repair_type_id IS NULL;
END;

-- Backfill any checklist-created corrective repair that may already exist.
UPDATE repairs
SET repair_type_id = (
  SELECT run.repair_type_id
  FROM repair_type_checklist_items item
  JOIN repair_type_checklist_runs run ON run.id = item.checklist_run_id
  WHERE item.corrective_repair_id = repairs.id
  ORDER BY item.id DESC
  LIMIT 1
),
updated_at = CURRENT_TIMESTAMP
WHERE repair_type_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM repair_type_checklist_items item
    WHERE item.corrective_repair_id = repairs.id
  );
