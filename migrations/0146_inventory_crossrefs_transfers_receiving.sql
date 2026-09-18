PRAGMA foreign_keys = ON;

-- Inventory aliases, auditable transfers, and invoice-driven receiving.
CREATE TABLE IF NOT EXISTS part_cross_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  cross_part_number TEXT NOT NULL,
  normalized_cross_part_number TEXT NOT NULL UNIQUE,
  brand TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_part_cross_reference_lookup
ON part_cross_references(normalized_cross_part_number, active);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL UNIQUE,
  part_id INTEGER NOT NULL,
  source_warehouse_id INTEGER NOT NULL,
  destination_warehouse_id INTEGER,
  transfer_kind TEXT NOT NULL CHECK (transfer_kind IN ('terminal','outside','remove')),
  destination_label TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  notes TEXT NOT NULL CHECK (length(trim(notes)) > 0),
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (source_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (destination_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_recent
ON inventory_transfers(created_at DESC, part_id);

CREATE TABLE IF NOT EXISTS parts_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_group_key TEXT NOT NULL,
  operation_id INTEGER NOT NULL UNIQUE,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  vendor_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  source_part_number TEXT,
  source_description TEXT,
  received_quantity REAL NOT NULL CHECK (received_quantity > 0),
  unit_cost REAL,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operation_id) REFERENCES inventory_operations(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_parts_receipts_invoice
ON parts_receipts(invoice_number, vendor_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_parts_receipts_group
ON parts_receipts(receipt_group_key, id);
