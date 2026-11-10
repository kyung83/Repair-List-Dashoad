-- EMDECS locations belong to a part in a warehouse, independent of stock variants.
-- Keep complete location paths together so multiple bins do not duplicate stock.
CREATE TABLE IF NOT EXISTS part_warehouse_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  bin_location TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  UNIQUE (part_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_part_warehouse_locations_warehouse
ON part_warehouse_locations(warehouse_id);
