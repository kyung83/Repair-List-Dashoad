PRAGMA foreign_keys = ON;

-- A failed PM/annual checklist item owns one corrective repair. The repair stays
-- attached to the same equipment and remains in normal Shop Jobs/history.
ALTER TABLE repairs
ADD COLUMN maintenance_checklist_item_id INTEGER
REFERENCES maintenance_checklist_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_maintenance_checklist_item
ON repairs(maintenance_checklist_item_id)
WHERE maintenance_checklist_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repairs_maintenance_checklist_equipment
ON repairs(equipment_id, maintenance_checklist_item_id);
