PRAGMA foreign_keys = ON;

-- Financial fields needed for true unit ownership-cost reporting.
ALTER TABLE equipment ADD COLUMN purchase_date TEXT;
ALTER TABLE equipment ADD COLUMN purchase_price REAL;
ALTER TABLE equipment ADD COLUMN in_service_date TEXT;
ALTER TABLE equipment ADD COLUMN acquisition_mileage INTEGER;
ALTER TABLE equipment ADD COLUMN expected_residual_value REAL;
ALTER TABLE equipment ADD COLUMN retired_date TEXT;

-- Capture labor and outside/vendor charges alongside the parts already issued to repairs.
ALTER TABLE repairs ADD COLUMN labor_hours REAL NOT NULL DEFAULT 0;
ALTER TABLE repairs ADD COLUMN labor_rate REAL;
ALTER TABLE repairs ADD COLUMN outside_cost REAL NOT NULL DEFAULT 0;

-- Expenses that are part of owning/operating a unit but are not a repair-part issue.
CREATE TABLE IF NOT EXISTS unit_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  vendor TEXT,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unit_expenses_equipment_date
ON unit_expenses(equipment_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_unit_expenses_category_date
ON unit_expenses(category, expense_date);

-- PM/annual history must persist after the current reminder advances.
CREATE TABLE IF NOT EXISTS maintenance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual','service')),
  pm_type TEXT,
  event_date TEXT NOT NULL,
  mileage INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  UNIQUE(equipment_id, event_type, event_date, source)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_events_equipment_date
ON maintenance_events(equipment_id, event_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_events_type_date
ON maintenance_events(event_type, event_date);

-- Seed one historical baseline from the PM data already loaded into the dashboard.
INSERT OR IGNORE INTO maintenance_events (
  equipment_id, event_type, pm_type, event_date, mileage, notes, source
)
SELECT equipment_id, 'pm', pm_type, service_date, last_mileage,
       'Baseline imported from existing PM history', 'baseline'
FROM pm_status
WHERE service_date IS NOT NULL AND service_date <> '';

INSERT OR IGNORE INTO maintenance_events (
  equipment_id, event_type, pm_type, event_date, mileage, notes, source
)
SELECT equipment_id, 'annual', NULL, annual_date, NULL,
       'Baseline imported from existing annual history', 'baseline'
FROM pm_status
WHERE annual_date IS NOT NULL AND annual_date <> '';
