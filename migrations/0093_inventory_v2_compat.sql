PRAGMA foreign_keys = ON;

ALTER TABLE repair_parts ADD COLUMN inventory_operation_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_repair_parts_inventory_operation
ON repair_parts(inventory_operation_id);

ALTER TABLE vendors ADD COLUMN normalized_name TEXT;
UPDATE vendors
SET normalized_name = lower(trim(replace(replace(replace(replace(name, '.', ''), ',', ''), '-', ' '), '  ', ' ')))
WHERE normalized_name IS NULL OR normalized_name = '';
CREATE INDEX IF NOT EXISTS idx_vendors_normalized_name
ON vendors(normalized_name, active, id);
