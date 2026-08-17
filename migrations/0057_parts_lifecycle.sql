PRAGMA foreign_keys = ON;

-- One lifecycle row per repair/part/warehouse. Requested and used quantities are
-- cumulative for the repair; reserved_quantity is the stock currently committed
-- to this job but not yet physically consumed.
CREATE TABLE IF NOT EXISTS repair_part_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  requested_quantity REAL NOT NULL DEFAULT 0,
  reserved_quantity REAL NOT NULL DEFAULT 0,
  used_quantity REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  requested_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id),
  UNIQUE (repair_id, part_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_repair_part_requests_queue
ON repair_part_requests(warehouse_id, part_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_repair_part_requests_repair
ON repair_part_requests(repair_id, status, updated_at DESC);

-- Audit trail for automatic handoffs. from/to warehouse columns deliberately
-- support future inter-yard transfers without changing the event model later.
CREATE TABLE IF NOT EXISTS part_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  repair_id INTEGER,
  warehouse_id INTEGER,
  from_warehouse_id INTEGER,
  to_warehouse_id INTEGER,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_part_lifecycle_events_part_warehouse
ON part_lifecycle_events(part_id, warehouse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_part_lifecycle_events_repair
ON part_lifecycle_events(repair_id, created_at DESC);

-- Transfer-ready storage. No transfer UI is enabled by this migration; this table
-- simply prevents a future Clare <-> Cadillac workflow from requiring a stock
-- model rewrite.
CREATE TABLE IF NOT EXISTS part_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  from_warehouse_id INTEGER NOT NULL,
  to_warehouse_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_transit','received','cancelled')),
  requested_by_user_id INTEGER,
  shipped_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id),
  CHECK (from_warehouse_id <> to_warehouse_id),
  CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_part_transfers_status
ON part_transfers(status, from_warehouse_id, to_warehouse_id, created_at);
