PRAGMA foreign_keys = ON;

-- A repair can leave the internal Repair Board, live with an outside vendor,
-- then come back only after the vendor is finished or the invoice is attached.
-- The same repairs.id is preserved throughout the workflow.
CREATE TABLE IF NOT EXISTS outside_repair_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  outside_vendor_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting_vendor'
    CHECK (status IN ('waiting_vendor','waiting_invoice','completed','returned_shop')),
  previous_repair_status TEXT NOT NULL DEFAULT 'New',
  previous_technician_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vendor_finished_at TEXT,
  invoice_received_at TEXT,
  returned_to_shop_at TEXT,
  completed_at TEXT,
  assigned_by_user_id INTEGER,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (outside_vendor_id) REFERENCES outside_work_vendors(id),
  FOREIGN KEY (previous_technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outside_repair_assignments_status
ON outside_repair_assignments(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_outside_repair_assignments_vendor
ON outside_repair_assignments(outside_vendor_id, status);
