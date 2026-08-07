PRAGMA foreign_keys = ON;

-- Global settings are deliberately small and auditable. Rates are snapshotted onto
-- labor entries and invoices so changing a setting never rewrites history.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('shop_labor_rate', '100');

CREATE TABLE IF NOT EXISTS repair_labor_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  technician_id INTEGER,
  labor_date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0),
  rate REAL NOT NULL CHECK (rate >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id)
);

CREATE INDEX IF NOT EXISTS idx_repair_labor_repair_date
ON repair_labor_entries(repair_id, labor_date);
CREATE INDEX IF NOT EXISTS idx_repair_labor_technician_date
ON repair_labor_entries(technician_id, labor_date);

CREATE TABLE IF NOT EXISTS invoice_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE,
  repair_id INTEGER,
  equipment_id INTEGER,
  customer_id INTEGER,
  bill_to_name TEXT,
  bill_to_contact TEXT,
  bill_to_email TEXT,
  bill_to_phone TEXT,
  bill_to_address TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES invoice_customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_repair ON invoices(repair_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(status, invoice_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  line_type TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
ON invoice_lines(invoice_id, sort_order, id);
