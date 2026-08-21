PRAGMA foreign_keys = ON;

-- Parts & Inventory v2: one idempotent operation envelope for every physical-stock mutation.
CREATE TABLE IF NOT EXISTS inventory_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone')),
  repair_id INTEGER,
  user_id INTEGER,
  note TEXT,
  undo_of_operation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at TEXT,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(id),
  FOREIGN KEY (undo_of_operation_id) REFERENCES inventory_operations(id)
);

CREATE TABLE IF NOT EXISTS inventory_operation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  warehouse_stock_id INTEGER,
  warehouse_id INTEGER,
  repair_part_id INTEGER,
  quantity_delta REAL NOT NULL,
  unit_cost REAL,
  line_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (repair_part_id) REFERENCES repair_parts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_operation_lines_stock
ON inventory_operation_lines(warehouse_stock_id, id DESC);

CREATE TABLE IF NOT EXISTS inventory_operation_dependencies (
  operation_id INTEGER NOT NULL,
  depends_on_operation_id INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id, depends_on_operation_id),
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  CHECK (operation_id <> depends_on_operation_id)
);

-- The operation service writes this last. applied=0 violates the CHECK and makes
-- D1 batch() roll the complete mutation back instead of accepting a 0-row stock update.
CREATE TABLE IF NOT EXISTS inventory_operation_commits (
  operation_id INTEGER PRIMARY KEY,
  applied INTEGER NOT NULL CHECK (applied = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_discrepancy_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  warehouse_stock_id INTEGER,
  expected_quantity REAL,
  counted_quantity REAL NOT NULL,
  difference_quantity REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  stock_version TEXT,
  created_by_user_id INTEGER,
  resolved_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id),
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
  FOREIGN KEY (resolved_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_discrepancy_open
ON inventory_discrepancy_issues(status, warehouse_id, created_at DESC);

-- Core charges are obligations: issuing the parent item can open an obligation,
-- and receiving the returned core closes it without pretending the core is saleable stock.
CREATE TABLE IF NOT EXISTS part_core_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_operation_id INTEGER NOT NULL,
  repair_id INTEGER,
  issued_part_id INTEGER NOT NULL,
  core_part_id INTEGER,
  quantity REAL NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','returned','waived')),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  closed_by_user_id INTEGER,
  FOREIGN KEY (source_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (issued_part_id) REFERENCES parts(id),
  FOREIGN KEY (core_part_id) REFERENCES parts(id),
  FOREIGN KEY (closed_by_user_id) REFERENCES app_users(id)
);

-- A removed tire that is still usable is tracked separately from new inventory.
CREATE TABLE IF NOT EXISTS recovered_used_tires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_operation_id INTEGER NOT NULL,
  repair_id INTEGER,
  part_id INTEGER,
  warehouse_id INTEGER NOT NULL,
  position_code TEXT,
  condition_note TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reused','scrapped')),
  recovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disposition_at TEXT,
  disposition_operation_id INTEGER,
  FOREIGN KEY (source_operation_id) REFERENCES inventory_operations(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (disposition_operation_id) REFERENCES inventory_operations(id)
);

-- Reservations are derived from open demand and queue priority. The legacy
-- reserved_quantity column remains for compatibility but is no longer authoritative.
CREATE VIEW IF NOT EXISTS derived_repair_part_reservations AS
WITH stock AS (
  SELECT part_id, warehouse_id, SUM(quantity_on_hand) AS physical_on_hand
  FROM part_warehouse_stock GROUP BY part_id, warehouse_id
), demand AS (
  SELECT q.id AS request_id, q.repair_id, q.part_id, q.warehouse_id,
         MAX(0, q.requested_quantity - q.used_quantity) AS remaining_quantity,
         COALESCE(e.out_of_service, 0) AS out_of_service,
         CASE trim(COALESCE(r.priority, '2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END AS priority_rank,
         q.created_at
  FROM repair_part_requests q
  JOIN repairs r ON r.id = q.repair_id
  LEFT JOIN equipment e ON e.id = r.equipment_id
  WHERE q.status = 'open'
    AND q.requested_quantity > q.used_quantity
    AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
), ranked AS (
  SELECT d.*,
         COALESCE(SUM(remaining_quantity) OVER (
           PARTITION BY part_id, warehouse_id
           ORDER BY out_of_service DESC, priority_rank ASC, created_at ASC, request_id ASC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior_demand
  FROM demand d
)
SELECT r.request_id, r.repair_id, r.part_id, r.warehouse_id, r.remaining_quantity,
       MAX(0, MIN(r.remaining_quantity, COALESCE(s.physical_on_hand, 0) - r.prior_demand)) AS reserved_quantity
FROM ranked r
LEFT JOIN stock s ON s.part_id = r.part_id AND s.warehouse_id = r.warehouse_id;
