-- Add-only audit table. No equipment or assignment is changed by deployment.
CREATE TABLE IF NOT EXISTS geotab_device_release_events (
  id TEXT PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  unit TEXT NOT NULL,
  geotab_device_id TEXT NOT NULL,
  previous_assignment_id INTEGER,
  previous_legacy_device_id TEXT,
  released_by_user_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  released_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  guard_verified INTEGER NOT NULL CHECK (guard_verified = 1)
);
CREATE INDEX IF NOT EXISTS idx_geotab_device_release_equipment
ON geotab_device_release_events(equipment_id, released_at);
