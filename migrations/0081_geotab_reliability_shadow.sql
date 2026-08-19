PRAGMA foreign_keys = ON;

-- GPS/yard reliability pilot. Operational state is intentionally bounded to
-- one current/last-known-good row per equipment record. Geotab remains the
-- system of record for deep historical telemetry.
CREATE TABLE IF NOT EXISTS geotab_unit_state (
  equipment_id INTEGER PRIMARY KEY,
  geotab_device_id TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  gps_observed_at TEXT,
  gps_received_at TEXT,
  gps_source TEXT NOT NULL DEFAULT 'NO_DATA',
  communicating INTEGER CHECK (communicating IN (0, 1) OR communicating IS NULL),
  communication_observed_at TEXT,
  yard TEXT NOT NULL DEFAULT '',
  yard_zone_id TEXT,
  yard_zone_name TEXT,
  yard_confirmed_at TEXT,
  last_successful_sync_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id)
);

CREATE INDEX IF NOT EXISTS idx_geotab_unit_state_device
ON geotab_unit_state(geotab_device_id);

CREATE INDEX IF NOT EXISTS idx_geotab_unit_state_yard
ON geotab_unit_state(yard, gps_observed_at);

-- One durable cursor per future feed pipeline. The GPS shadow pilot does not
-- require GetFeed for correctness yet, but the cursor table is created now so
-- later delta feeds do not invent a second persistence pattern.
CREATE TABLE IF NOT EXISTS geotab_feed_cursors (
  feed TEXT PRIMARY KEY,
  version TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TEXT,
  last_error TEXT
);

-- Lease expiry is governed only by locked_until. heartbeat_at is monitoring
-- information; a live owner extends locked_until when it heartbeats.
CREATE TABLE IF NOT EXISTS geotab_sync_leases (
  pipeline TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Bounded operational diagnostics. The trigger keeps a hard maximum and the
-- application also performs time-based cleanup, so storage cannot grow forever.
CREATE TABLE IF NOT EXISTS geotab_sync_runs (
  run_id TEXT PRIMARY KEY,
  pipeline TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  result_status TEXT NOT NULL DEFAULT 'running',
  api_status TEXT NOT NULL DEFAULT 'unknown',
  expected_count INTEGER NOT NULL DEFAULT 0,
  returned_count INTEGER NOT NULL DEFAULT 0,
  fresh_count INTEGER NOT NULL DEFAULT 0,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  no_data_count INTEGER NOT NULL DEFAULT 0,
  identity_error_count INTEGER NOT NULL DEFAULT 0,
  equivalent_count INTEGER NOT NULL DEFAULT 0,
  improvement_count INTEGER NOT NULL DEFAULT 0,
  regression_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_geotab_sync_runs_pipeline_started
ON geotab_sync_runs(pipeline, started_at DESC);

DROP TRIGGER IF EXISTS trg_geotab_sync_runs_retention_cap;
CREATE TRIGGER trg_geotab_sync_runs_retention_cap
AFTER INSERT ON geotab_sync_runs
BEGIN
  DELETE FROM geotab_sync_runs
  WHERE started_at < datetime('now', '-90 days');

  DELETE FROM geotab_sync_runs
  WHERE run_id NOT IN (
    SELECT run_id
    FROM geotab_sync_runs
    ORDER BY started_at DESC, run_id DESC
    LIMIT 5000
  );
END;

-- Yard identifiers are pinned after the first successful exact-name discovery.
-- Once geotab_zone_id is known, runtime resolution trusts the ID rather than a
-- mutable Geotab display name.
CREATE TABLE IF NOT EXISTS geotab_yard_zones (
  yard_key TEXT PRIMARY KEY,
  expected_name TEXT NOT NULL,
  geotab_zone_id TEXT,
  geotab_zone_name TEXT,
  pinned_at TEXT,
  last_seen_at TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved'
);

INSERT INTO geotab_yard_zones (yard_key, expected_name)
VALUES
  ('clare', 'Z'),
  ('cadillac', 'New cadillac yard'),
  ('gr', 'G - Byron Center Yard'),
  ('taylor', 'T'),
  ('boyne', 'New Boyne Yard')
ON CONFLICT(yard_key) DO UPDATE SET expected_name = excluded.expected_name;

-- Seed the reliability cache from the application's current last-known values.
-- This gives every currently mapped active unit a structured row immediately;
-- the shadow sync replaces these fields only with newer valid Geotab facts.
INSERT INTO geotab_unit_state (
  equipment_id,
  geotab_device_id,
  latitude,
  longitude,
  gps_observed_at,
  gps_received_at,
  gps_source,
  yard,
  yard_zone_name,
  yard_confirmed_at,
  last_successful_sync_at,
  updated_at
)
SELECT
  e.id,
  d.geotab_device_id,
  e.geotab_latitude,
  e.geotab_longitude,
  e.geotab_position_at,
  e.yard_updated_at,
  CASE WHEN e.geotab_position_at IS NULL OR TRIM(e.geotab_position_at) = '' THEN 'NO_DATA' ELSE 'LEGACY_SEED' END,
  COALESCE(e.current_yard, ''),
  NULLIF(TRIM(COALESCE(e.current_yard_zone, '')), ''),
  e.yard_updated_at,
  e.yard_updated_at,
  CURRENT_TIMESTAMP
FROM equipment_geotab_devices d
JOIN equipment e ON e.id = d.equipment_id
WHERE d.current = 1
  AND e.active = 1
  AND e.archived_at IS NULL
  AND e.merged_into_equipment_id IS NULL
ON CONFLICT(equipment_id) DO NOTHING;
