PRAGMA foreign_keys = ON;

-- v2 inventory safety model. D1 batch() is the transaction boundary. The guard
-- table deliberately uses a CHECK constraint so a failed invariant aborts the
-- whole D1 batch instead of allowing a conditional UPDATE to silently affect 0 rows.
CREATE TABLE IF NOT EXISTS inventory_batch_guards (
  guard_key TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'apply_part','repair_part_correction','repair_part_remove','receive_stock',
    'return_stock','transfer_stock','count_adjustment','obligation_recovery','undo'
  )),
  source TEXT NOT NULL DEFAULT 'inventory',
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone')),
  repair_id INTEGER,
  work_order_repair_id INTEGER,
  discrepancy_issue_id INTEGER,
  actor_user_id INTEGER,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  undo_of_operation_id INTEGER,
  undone_by_operation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at TEXT,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (work_order_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (undo_of_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (undone_by_operation_id) REFERENCES inventory_operations(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_repair
ON inventory_operations(repair_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_operations_type
ON inventory_operations(operation_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_operation_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  warehouse_stock_id INTEGER,
  warehouse_id INTEGER,
  repair_part_id INTEGER,
  repair_part_request_id INTEGER,
  physical_delta REAL NOT NULL DEFAULT 0,
  on_order_delta REAL NOT NULL DEFAULT 0,
  repair_quantity_delta REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (repair_part_id) REFERENCES repair_parts(id) ON DELETE SET NULL,
  FOREIGN KEY (repair_part_request_id) REFERENCES repair_part_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_effects_stock
ON inventory_operation_effects(warehouse_stock_id, operation_id);
CREATE INDEX IF NOT EXISTS idx_inventory_effects_repair_part
ON inventory_operation_effects(repair_part_id, operation_id);

CREATE TABLE IF NOT EXISTS inventory_operation_dependencies (
  operation_id INTEGER NOT NULL,
  depends_on_operation_id INTEGER NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'stock_sequence',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id, depends_on_operation_id, dependency_type),
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  CHECK (operation_id <> depends_on_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_dependencies_parent
ON inventory_operation_dependencies(depends_on_operation_id, operation_id);

CREATE TABLE IF NOT EXISTS inventory_physical_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  warehouse_stock_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  expected_stock_version INTEGER NOT NULL,
  system_quantity REAL NOT NULL,
  counted_quantity REAL NOT NULL,
  difference REAL NOT NULL,
  counted_by_user_id INTEGER,
  counted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (counted_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_discrepancy_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  physical_count_id INTEGER NOT NULL UNIQUE,
  part_id INTEGER NOT NULL,
  warehouse_stock_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  system_quantity REAL NOT NULL,
  counted_quantity REAL NOT NULL,
  difference REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution TEXT,
  resolved_operation_id INTEGER,
  created_by_user_id INTEGER,
  resolved_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (physical_count_id) REFERENCES inventory_physical_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (resolved_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_open
ON inventory_discrepancy_issues(status, warehouse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_operation_id INTEGER NOT NULL,
  repair_id INTEGER,
  part_id INTEGER NOT NULL,
  obligation_type TEXT NOT NULL CHECK (obligation_type IN ('core_return','used_tire_recovery')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','recovered','returned','waived')),
  recovered_operation_id INTEGER,
  vendor_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (source_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (recovered_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_obligations_open
ON inventory_obligations(status, obligation_type, created_at);

CREATE TABLE IF NOT EXISTS vendor_normalized_aliases (
  normalized_alias TEXT PRIMARY KEY,
  vendor_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

-- Existing stock rows gain an optimistic version. Physical counts must submit the
-- version they were shown; any intervening receive/use/transfer makes that count stale.
ALTER TABLE part_warehouse_stock ADD COLUMN stock_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE part_warehouse_stock ADD COLUMN last_counted_at TEXT;
ALTER TABLE part_warehouse_stock ADD COLUMN last_operation_id INTEGER;

-- Repair-part lines created by the operation service can always be traced to the
-- exact stock operation that created them.
ALTER TABLE repair_parts ADD COLUMN inventory_operation_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_repair_parts_inventory_operation
ON repair_parts(inventory_operation_id);

-- Part setup drives automatic obligations without asking a technician to remember.
ALTER TABLE parts ADD COLUMN core_return_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parts ADD COLUMN used_tire_recovery_required INTEGER NOT NULL DEFAULT 0;

-- Stored reservation quantities from v1 are retired as authoritative state.
-- v2 derives reservations FIFO from requested-used quantity and current physical stock.
UPDATE repair_part_requests SET reserved_quantity = 0 WHERE reserved_quantity <> 0;

-- Seed conservative aliases for existing vendors. Exact collisions intentionally
-- choose the oldest vendor instead of failing the migration or deleting history.
INSERT OR IGNORE INTO vendor_normalized_aliases (normalized_alias, vendor_id, source)
SELECT lower(trim(name)), MIN(id), 'legacy-name'
FROM vendors
WHERE trim(COALESCE(name,'')) <> ''
GROUP BY lower(trim(name));
