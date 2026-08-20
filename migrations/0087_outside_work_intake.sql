PRAGMA foreign_keys = ON;

-- Outside-vendor invoices are stored as completed repair history while the
-- original invoice remains available in R2. Invoice mileage is provenance only;
-- it does not overwrite equipment/Geotab mileage.
CREATE TABLE IF NOT EXISTS outside_work_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  repair_id INTEGER NOT NULL UNIQUE,
  vendor_name TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_date TEXT,
  mileage INTEGER,
  total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  original_file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_sha256 TEXT NOT NULL UNIQUE,
  ocr_text TEXT NOT NULL DEFAULT '',
  service_summary TEXT NOT NULL DEFAULT '',
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE RESTRICT,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outside_work_equipment_created
ON outside_work_documents(equipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outside_work_vendor_invoice
ON outside_work_documents(vendor_name, invoice_number);
