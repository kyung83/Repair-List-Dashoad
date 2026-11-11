PRAGMA foreign_keys = ON;

-- One-time/non-stock repair parts share the normal part catalog so technicians
-- can find them, but they are excluded from stocked-inventory reporting.
ALTER TABLE parts ADD COLUMN inventory_class TEXT NOT NULL DEFAULT 'stock'
  CHECK (inventory_class IN ('stock','one_time'));
ALTER TABLE parts ADD COLUMN converted_to_stock_at TEXT;

-- Preserve how the part was issued even if a one-time item is later converted
-- into a stocked inventory item.
ALTER TABLE repair_parts ADD COLUMN source_type TEXT NOT NULL DEFAULT 'stock'
  CHECK (source_type IN ('stock','one_time'));

CREATE TABLE IF NOT EXISTS one_time_part_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  vendor_id INTEGER,
  quantity_received REAL NOT NULL CHECK (quantity_received > 0),
  unit_cost REAL,
  reference TEXT,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_parts_inventory_class
ON parts(inventory_class, active, part_number);

CREATE INDEX IF NOT EXISTS idx_one_time_part_receipts_part
ON one_time_part_receipts(part_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_one_time_part_receipts_warehouse
ON one_time_part_receipts(warehouse_id, created_at DESC);
