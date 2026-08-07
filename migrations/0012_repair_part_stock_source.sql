ALTER TABLE repair_parts ADD COLUMN warehouse_stock_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_repair_parts_warehouse_stock ON repair_parts(warehouse_stock_id);
