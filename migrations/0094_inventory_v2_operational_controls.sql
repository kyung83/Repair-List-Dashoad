PRAGMA foreign_keys = ON;

-- Operational configuration for core-return obligations.
ALTER TABLE parts ADD COLUMN core_return_part_id INTEGER;
ALTER TABLE parts ADD COLUMN core_return_quantity REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_parts_core_return_part
ON parts(core_return_part_id)
WHERE core_return_part_id IS NOT NULL;

-- Make core obligations idempotent per issued inventory operation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_obligation_source_operation
ON part_core_obligations(source_operation_id)
WHERE status IN ('open','returned','waived');

-- Open the obligation at the database boundary for every committed part issue.
-- The returned core is NOT added to saleable stock; it remains an obligation until
-- a manager records returned/waived disposition.
CREATE TRIGGER IF NOT EXISTS trg_inventory_part_issue_open_core
AFTER INSERT ON inventory_operation_lines
FOR EACH ROW
WHEN NEW.line_type = 'part_issue'
  AND EXISTS (
    SELECT 1 FROM parts p
    WHERE p.id = NEW.part_id
      AND p.core_return_part_id IS NOT NULL
      AND p.core_return_quantity > 0
  )
BEGIN
  INSERT OR IGNORE INTO part_core_obligations
    (source_operation_id,repair_id,issued_part_id,core_part_id,quantity,status)
  SELECT NEW.operation_id,o.repair_id,NEW.part_id,p.core_return_part_id,
         ABS(NEW.quantity_delta) * p.core_return_quantity,'open'
  FROM inventory_operations o
  JOIN parts p ON p.id = NEW.part_id
  WHERE o.id = NEW.operation_id;
END;

-- Keep recovered tire source records uniquely attributable to one repair/position
-- while allowing multiple positions on the same repair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovered_tire_source_position
ON recovered_used_tires(repair_id, position_code, source_operation_id)
WHERE repair_id IS NOT NULL AND position_code IS NOT NULL;
