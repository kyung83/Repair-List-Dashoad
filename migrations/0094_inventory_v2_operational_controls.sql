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

-- Keep recovered tire source records uniquely attributable to one repair/position
-- while allowing multiple positions on the same repair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovered_tire_source_position
ON recovered_used_tires(repair_id, position_code, source_operation_id)
WHERE repair_id IS NOT NULL AND position_code IS NOT NULL;
