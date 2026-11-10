PRAGMA foreign_keys = ON;

-- Warehouse-specific catalog status. A part can remain active at one terminal
-- while being archived or removed from another. Missing rows mean active.
CREATE TABLE IF NOT EXISTS part_warehouse_catalog_status (
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','removed')),
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (part_id, warehouse_id),
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_part_warehouse_catalog_status
ON part_warehouse_catalog_status(warehouse_id, status, part_id);
