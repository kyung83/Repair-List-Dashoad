PRAGMA foreign_keys=ON;

-- Sale progress and operational assignment are intentionally independent:
-- a truck listed For Sale remains eligible to drive, while off_road trucks
-- are unavailable even though fleet_truck_assignments still has a pool_status.
-- Sold equipment is archived, never deleted, preserving WO/PM/annual/expense history.
CREATE TABLE IF NOT EXISTS fleet_truck_sales (
  equipment_id INTEGER PRIMARY KEY REFERENCES equipment(id) ON DELETE RESTRICT,
  sale_status TEXT NOT NULL CHECK(sale_status IN ('for_sale','off_road','sold','cancelled')),
  asking_price REAL CHECK(asking_price IS NULL OR (asking_price>=0 AND asking_price<=100000000)),
  sale_notes TEXT NOT NULL DEFAULT '',
  listed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  off_road_at TEXT,
  sold_at TEXT,
  sale_price REAL CHECK(sale_price IS NULL OR (sale_price>=0 AND sale_price<=100000000)),
  buyer TEXT NOT NULL DEFAULT '',
  updated_by_user_id INTEGER REFERENCES app_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(sale_status<>'sold' OR (off_road_at IS NOT NULL AND sold_at IS NOT NULL AND sale_price IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_fleet_truck_sales_status ON fleet_truck_sales(sale_status,equipment_id);

-- Immutable audit of every manager-approved lifecycle transition. Including
-- an expected-state guard inside the same D1 batch prevents stale concurrent
-- edits without a partially applied transition.
CREATE TABLE IF NOT EXISTS fleet_truck_sale_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('mark_for_sale','update_listing','cancel_sale','remove_from_road','return_to_road','mark_sold')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  driver_snapshot TEXT NOT NULL DEFAULT '',
  location_snapshot TEXT NOT NULL DEFAULT '',
  asking_price REAL,
  sale_price REAL,
  buyer TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES app_users(id),
  guard_verified INTEGER NOT NULL DEFAULT 1 CHECK(guard_verified=1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fleet_truck_sale_events_unit ON fleet_truck_sale_events(equipment_id,id DESC);
