PRAGMA foreign_keys = ON;

CREATE TABLE app_users (
  id INTEGER PRIMARY KEY,
  username TEXT
);

CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  part_number TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  quantity_on_hand REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  location TEXT,
  preferred_vendor_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL,
  out_of_service INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE repairs (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER,
  status TEXT,
  priority TEXT,
  parts_text TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id)
);

CREATE TABLE part_warehouse_stock (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  quantity_on_hand REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE repair_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost REAL,
  warehouse_stock_id INTEGER,
  FOREIGN KEY (repair_id) REFERENCES repairs(id),
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_stock_id) REFERENCES part_warehouse_stock(id)
);

CREATE TABLE repair_part_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  requested_quantity REAL NOT NULL,
  used_quantity REAL NOT NULL DEFAULT 0,
  reserved_quantity REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id),
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE technicians (
  id INTEGER PRIMARY KEY
);

CREATE TABLE repair_tire_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  position_code TEXT NOT NULL,
  technician_id INTEGER,
  recorded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (repair_id, position_code),
  FOREIGN KEY (repair_id) REFERENCES repairs(id),
  FOREIGN KEY (technician_id) REFERENCES technicians(id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES app_users(id)
);

-- Seed before migration 0093 so the migration's vendor-normalization UPDATE is exercised.
INSERT INTO vendors (id,name,active) VALUES (1,'ACME-Co.',1);
