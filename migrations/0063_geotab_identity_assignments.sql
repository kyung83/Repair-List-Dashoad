PRAGMA foreign_keys = ON;

-- Separate permanent Norlow equipment identity from the telematics hardware
-- currently installed on it. Historical duplicate equipment rows are preserved;
-- this table enforces uniqueness only for the current hardware assignment.
CREATE TABLE IF NOT EXISTS equipment_geotab_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  geotab_device_id TEXT NOT NULL,
  serial_number TEXT,
  geotab_name TEXT,
  vin_seen TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
  linked_by TEXT NOT NULL DEFAULT 'sync',
  FOREIGN KEY (equipment_id) REFERENCES equipment(id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_geotab_devices_equipment
ON equipment_geotab_devices(equipment_id, current, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_equipment_geotab_devices_serial
ON equipment_geotab_devices(serial_number, current);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_geotab_devices_current_device
ON equipment_geotab_devices(geotab_device_id)
WHERE current = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_geotab_devices_current_equipment
ON equipment_geotab_devices(equipment_id)
WHERE current = 1;

-- Seed only rows that are already the sole active owner of a device. Ambiguous
-- historical aliases are deliberately not guessed here; the sync will quarantine
-- them until a deterministic mapping exists.
INSERT OR IGNORE INTO equipment_geotab_devices (
  equipment_id,
  geotab_device_id,
  geotab_name,
  vin_seen,
  assigned_at,
  last_seen_at,
  current,
  linked_by
)
SELECT
  e.id,
  e.geotab_device_id,
  e.unit,
  e.vin,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  1,
  '0063-active-backfill'
FROM equipment e
WHERE e.active = 1
  AND e.geotab_device_id IS NOT NULL
  AND TRIM(e.geotab_device_id) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM equipment other
    WHERE other.id <> e.id
      AND other.geotab_device_id = e.geotab_device_id
      AND other.active = 1
  );

-- Devices that cannot be linked with high confidence are retained here instead
-- of silently creating a second equipment row or overwriting a questionable one.
CREATE TABLE IF NOT EXISTS geotab_reconciliation_queue (
  geotab_device_id TEXT PRIMARY KEY,
  serial_number TEXT,
  geotab_name TEXT NOT NULL,
  vin TEXT,
  reason TEXT NOT NULL,
  candidate_equipment_ids TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_equipment_id INTEGER,
  resolved_at TEXT,
  FOREIGN KEY (resolved_equipment_id) REFERENCES equipment(id)
);

CREATE INDEX IF NOT EXISTS idx_geotab_reconciliation_status
ON geotab_reconciliation_queue(status, last_seen_at);

-- Preserve questionable mileage observations without allowing them to silently
-- change the trusted mileage used by PM scheduling.
CREATE TABLE IF NOT EXISTS geotab_mileage_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  geotab_device_id TEXT NOT NULL,
  serial_number TEXT,
  previous_mileage INTEGER,
  incoming_mileage INTEGER NOT NULL,
  previous_updated_at TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('decrease', 'implausible_increase')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id)
);

CREATE INDEX IF NOT EXISTS idx_geotab_mileage_anomalies_pending
ON geotab_mileage_anomalies(status, equipment_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geotab_mileage_anomalies_dedupe
ON geotab_mileage_anomalies(equipment_id, geotab_device_id, incoming_mileage)
WHERE status = 'pending';
