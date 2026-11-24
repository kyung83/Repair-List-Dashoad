ALTER TABLE roadside_breakdowns ADD COLUMN rolling_confirmation_source TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS breakdown_rolling_checks (
  breakdown_id INTEGER PRIMARY KEY REFERENCES roadside_breakdowns(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  scanned_through TEXT NOT NULL,
  ignore_before TEXT,
  anchor_at TEXT,
  anchor_latitude REAL,
  anchor_longitude REAL,
  candidate_at TEXT,
  evidence_at TEXT,
  distance_miles REAL,
  max_speed_mph REAL,
  duration_minutes REAL,
  state TEXT NOT NULL DEFAULT 'watching' CHECK(state IN ('watching','pending','confirmed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A reassignment must never carry movement evidence from the previous unit.
CREATE TRIGGER IF NOT EXISTS trg_reset_breakdown_rolling_check_on_unit_change
AFTER UPDATE OF equipment_id ON roadside_breakdowns
WHEN OLD.equipment_id <> NEW.equipment_id
BEGIN
  DELETE FROM breakdown_rolling_checks WHERE breakdown_id=NEW.id;
END;
