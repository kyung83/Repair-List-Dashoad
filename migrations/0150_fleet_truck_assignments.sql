PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fleet_truck_assignments (
  equipment_id INTEGER PRIMARY KEY,
  home_driver TEXT NOT NULL DEFAULT '',
  home_location TEXT NOT NULL DEFAULT '',
  current_driver TEXT NOT NULL DEFAULT '',
  current_location TEXT NOT NULL DEFAULT '',
  pool_status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (pool_status IN ('assigned','open','spare','coverage','service','cleaning')),
  truck_class TEXT NOT NULL DEFAULT '',
  flatbed INTEGER NOT NULL DEFAULT 0,
  automatic INTEGER NOT NULL DEFAULT 0,
  scheduler_notes TEXT NOT NULL DEFAULT '',
  coverage_for_equipment_id INTEGER,
  coverage_for_driver TEXT NOT NULL DEFAULT '',
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (coverage_for_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_truck_assignments_status
ON fleet_truck_assignments(pool_status, current_location);

CREATE INDEX IF NOT EXISTS idx_fleet_truck_assignments_home_driver
ON fleet_truck_assignments(home_driver COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS fleet_coverage_swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver TEXT NOT NULL,
  home_equipment_id INTEGER NOT NULL,
  coverage_equipment_id INTEGER NOT NULL,
  working_location TEXT NOT NULL DEFAULT '',
  service_location TEXT NOT NULL DEFAULT 'Clare',
  reason TEXT NOT NULL DEFAULT '',
  coverage_return_pool TEXT NOT NULL DEFAULT 'spare'
    CHECK (coverage_return_pool IN ('open','spare')),
  opened_by_user_id INTEGER,
  closed_by_user_id INTEGER,
  ready_by_user_id INTEGER,
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (home_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (coverage_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (opened_by_user_id) REFERENCES app_users(id),
  FOREIGN KEY (closed_by_user_id) REFERENCES app_users(id),
  FOREIGN KEY (ready_by_user_id) REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_coverage_swaps_open_home
ON fleet_coverage_swaps(home_equipment_id)
WHERE closed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_coverage_swaps_open_coverage
ON fleet_coverage_swaps(coverage_equipment_id)
WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS fleet_assignment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  driver TEXT NOT NULL DEFAULT '',
  primary_equipment_id INTEGER,
  secondary_equipment_id INTEGER,
  from_location TEXT NOT NULL DEFAULT '',
  to_location TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (secondary_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_fleet_assignment_events_created
ON fleet_assignment_events(created_at DESC);

-- Bootstrap permanent/current assignments from the fleet data already in Master Equipment.
-- OPEN/Floater-style rows become dispatchable pool trucks instead of fake drivers.
INSERT OR IGNORE INTO fleet_truck_assignments (
  equipment_id, home_driver, home_location, current_driver, current_location, pool_status
)
SELECT
  e.id,
  CASE
    WHEN lower(trim(COALESCE(e.driver,''))) = 'open' THEN ''
    WHEN lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN ''
    ELSE trim(COALESCE(e.driver,''))
  END,
  trim(COALESCE(e.location,'')),
  CASE
    WHEN lower(trim(COALESCE(e.driver,''))) = 'open' THEN ''
    WHEN lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN ''
    ELSE trim(COALESCE(e.driver,''))
  END,
  trim(COALESCE(e.location,'')),
  CASE
    WHEN lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN 'spare'
    WHEN trim(COALESCE(e.driver,'')) = '' OR lower(trim(COALESCE(e.driver,''))) = 'open' THEN 'open'
    ELSE 'assigned'
  END
FROM equipment e
WHERE e.active = 1
  AND e.merged_into_equipment_id IS NULL
  AND lower(COALESCE(e.equipment_type,'')) IN ('truck','vehicle','glider','switcher');
