PRAGMA foreign_keys = ON;

-- Fleet identity and PM mileage fields. The Geotab sync owns these values.
ALTER TABLE equipment ADD COLUMN vin TEXT;
ALTER TABLE equipment ADD COLUMN license_plate TEXT;
ALTER TABLE equipment ADD COLUMN license_state TEXT;
ALTER TABLE equipment ADD COLUMN model_year INTEGER;
ALTER TABLE equipment ADD COLUMN make TEXT;
ALTER TABLE equipment ADD COLUMN model TEXT;
ALTER TABLE equipment ADD COLUMN engine TEXT;
ALTER TABLE equipment ADD COLUMN mileage_updated_at TEXT;
ALTER TABLE equipment ADD COLUMN vin_decoded_at TEXT;
ALTER TABLE equipment ADD COLUMN vin_decode_source TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_vin ON equipment(vin);
CREATE INDEX IF NOT EXISTS idx_equipment_license_plate ON equipment(license_plate);

-- Preserve the supplier master fields from the Northern supplier report.
ALTER TABLE vendors ADD COLUMN vendor_code TEXT;
ALTER TABLE vendors ADD COLUMN address TEXT;
ALTER TABLE vendors ADD COLUMN fax TEXT;
ALTER TABLE vendors ADD COLUMN payment_terms TEXT;
ALTER TABLE vendors ADD COLUMN supplier_type TEXT;
ALTER TABLE vendors ADD COLUMN tax_exempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendors ADD COLUMN tax_info TEXT;
ALTER TABLE vendors ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendors ADD COLUMN source_updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_vendor_code
ON vendors(vendor_code)
WHERE vendor_code IS NOT NULL AND vendor_code <> '';

-- The source inventory is warehouse-specific. Do not flatten shop quantities.
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO warehouses (code, name) VALUES
  ('BOYNE', 'Boyne Shop'),
  ('CADILLAC', 'Cadillac shop'),
  ('CLARE', 'Clare shop'),
  ('LUDINGTON', 'Ludington shop'),
  ('NO_WAREHOUSE', 'No Warehouse');

ALTER TABLE parts ADD COLUMN source_active_flag TEXT;
ALTER TABLE parts ADD COLUMN source_stock_flag TEXT;
ALTER TABLE parts ADD COLUMN product_group TEXT;
ALTER TABLE parts ADD COLUMN markup_group TEXT;
ALTER TABLE parts ADD COLUMN charge_price REAL;
ALTER TABLE parts ADD COLUMN source_updated_at TEXT;

CREATE TABLE IF NOT EXISTS part_warehouse_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  variant_key TEXT NOT NULL DEFAULT '',
  core_type TEXT,
  quantity_on_hand REAL NOT NULL DEFAULT 0,
  unit_of_measure TEXT,
  unit_cost REAL,
  charge_price REAL,
  on_order REAL NOT NULL DEFAULT 0,
  cm TEXT,
  inventory_line TEXT,
  last_purchase_received TEXT,
  last_issue TEXT,
  source_page INTEGER,
  source_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  UNIQUE (part_id, warehouse_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_part_stock_part ON part_warehouse_stock(part_id);
CREATE INDEX IF NOT EXISTS idx_part_stock_warehouse ON part_warehouse_stock(warehouse_id);
