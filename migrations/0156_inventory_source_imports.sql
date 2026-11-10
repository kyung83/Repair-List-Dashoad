PRAGMA foreign_keys = ON;

-- Private source snapshots are imported through authenticated CI administration.
-- No uploaded inventory or private source values belong in repository migrations.
CREATE TABLE IF NOT EXISTS inventory_source_imports (
  import_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_as_of TEXT,
  payload_sha256 TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applying','applied')),
  source_row_count INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  quantity_before REAL NOT NULL,
  quantity_after REAL NOT NULL,
  guard INTEGER NOT NULL DEFAULT 1 CHECK (guard = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_source_import_rows (
  import_key TEXT NOT NULL REFERENCES inventory_source_imports(import_key),
  source_row_id TEXT NOT NULL,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  warehouse_stock_id INTEGER NOT NULL REFERENCES part_warehouse_stock(id),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES inventory_operations(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (import_key, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_source_import_part
ON inventory_source_import_rows(part_id, warehouse_id, applied_at);
