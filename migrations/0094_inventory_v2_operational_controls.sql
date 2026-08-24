PRAGMA foreign_keys = ON;

-- Operational configuration for core-return obligations. Core creation and undo
-- are performed by the shared inventory operation service inside the same D1
-- batch as the stock/ledger mutation; no database triggers are required.
ALTER TABLE parts ADD COLUMN core_return_part_id INTEGER;
ALTER TABLE parts ADD COLUMN core_return_quantity REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_parts_core_return_part
ON parts(core_return_part_id)
WHERE core_return_part_id IS NOT NULL;

-- One obligation per issued inventory operation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_obligation_source_operation
ON part_core_obligations(source_operation_id);

ALTER TABLE recovered_used_tires ADD COLUMN disposition_repair_id INTEGER;
ALTER TABLE recovered_used_tires ADD COLUMN disposition_position_code TEXT;

-- One recovered tire can originate from one wheel position on a repair. Idempotency
-- keys handle request retries; this index also prevents a second operation key from
-- recording the same removed tire twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovered_tire_source_position
ON recovered_used_tires(repair_id, position_code)
WHERE repair_id IS NOT NULL AND position_code IS NOT NULL;
