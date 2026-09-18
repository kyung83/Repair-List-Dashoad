PRAGMA foreign_keys = ON;

-- Parts warehouses are managed independently from shop-yard visibility.
-- Keep existing yard assignments for Repair Board scoping, but give working users
-- an explicit parts warehouse that can be changed without code changes.
ALTER TABLE app_users ADD COLUMN parts_warehouse_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_app_users_parts_warehouse
ON app_users(parts_warehouse_id);

-- Preserve the two real warehouse assignments already in use.
UPDATE app_users
SET parts_warehouse_id = (
  SELECT id FROM warehouses
  WHERE code = CASE lower(trim(COALESCE(app_users.yard,'')))
    WHEN 'clare' THEN 'CLARE'
    WHEN 'cadillac' THEN 'CADILLAC'
    ELSE ''
  END
  LIMIT 1
)
WHERE parts_warehouse_id IS NULL
  AND lower(trim(COALESCE(yard,''))) IN ('clare','cadillac');

-- Current production only has Clare and Cadillac as active parts warehouses.
-- Other historical warehouse rows remain intact so receiving, repair, transfer,
-- and inventory history is never destroyed.
UPDATE warehouses
SET active = CASE WHEN code IN ('CLARE','CADILLAC') THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP;
