PRAGMA foreign_keys = ON;

-- Snapshot the driver and GPS/location evidence used when the breakdown is
-- created. These fields describe HOW the selected affected unit was located;
-- they do not add a second affected unit. In particular, trailer tractor
-- association is resolved transiently and is never stored as an equipment FK.
ALTER TABLE roadside_breakdowns ADD COLUMN snapshot_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE roadside_breakdowns ADD COLUMN geotab_driver_id TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN driver_observed_at TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN geotab_device_id TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN latitude REAL;
ALTER TABLE roadside_breakdowns ADD COLUMN longitude REAL;
ALTER TABLE roadside_breakdowns ADD COLUMN gps_observed_at TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN gps_source TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN snapshot_captured_at TEXT;

CREATE INDEX IF NOT EXISTS idx_roadside_breakdowns_snapshot_source
ON roadside_breakdowns(snapshot_source);
