PRAGMA foreign_keys = ON;

-- Warehouse-specific minimum stock targets for each part.
CREATE TABLE IF NOT EXISTS part_warehouse_minimums (
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  minimum_quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (part_id, warehouse_id),
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_part_warehouse_minimums_warehouse
ON part_warehouse_minimums(warehouse_id);

-- Equipment compatibility: one part can be used by many units and one unit can use many parts.
CREATE TABLE IF NOT EXISTS part_equipment (
  part_id INTEGER NOT NULL,
  equipment_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (part_id, equipment_id),
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_part_equipment_equipment
ON part_equipment(equipment_id);
