PRAGMA foreign_keys = ON;

-- Operational configuration for core-return obligations.
ALTER TABLE parts ADD COLUMN core_return_part_id INTEGER;
ALTER TABLE parts ADD COLUMN core_return_quantity REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_parts_core_return_part
ON parts(core_return_part_id)
WHERE core_return_part_id IS NOT NULL;

-- Make core obligations idempotent per issued inventory operation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_obligation_source_operation
ON part_core_obligations(source_operation_id);

-- Open the obligation at the database boundary for every committed part issue.
-- The returned core is NOT added to saleable stock; it remains an obligation until
-- a manager records returned/waived disposition. A failed D1 operation batch rolls
-- this trigger insert back with the rest of the batch.
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

-- Undoing an untouched part issue removes its still-open core obligation with the
-- same D1 batch. Once a manager has returned or waived the core, undo must fail.
CREATE TRIGGER IF NOT EXISTS trg_inventory_operation_undo_core_guard
BEFORE UPDATE OF status ON inventory_operations
FOR EACH ROW
WHEN OLD.status = 'applied' AND NEW.status = 'undone'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM part_core_obligations c
    WHERE c.source_operation_id = OLD.id AND c.status <> 'open'
  ) THEN RAISE(ABORT, 'Undo blocked: core obligation already returned or waived.') END;

  DELETE FROM part_core_obligations
  WHERE source_operation_id = OLD.id AND status = 'open';
END;

ALTER TABLE recovered_used_tires ADD COLUMN disposition_repair_id INTEGER;
ALTER TABLE recovered_used_tires ADD COLUMN disposition_position_code TEXT;

-- One recovered tire can originate from one wheel position on a repair. Idempotency
-- keys handle request retries; this index also prevents a second operation key from
-- recording the same removed tire twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovered_tire_source_position
ON recovered_used_tires(repair_id, position_code)
WHERE repair_id IS NOT NULL AND position_code IS NOT NULL;
