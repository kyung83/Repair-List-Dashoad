PRAGMA foreign_keys = ON;

-- Tire position history is attached to the repair so tire usage can be traced
-- back to the exact wheel position after the work order is completed.
CREATE TABLE IF NOT EXISTS repair_tire_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  position_code TEXT NOT NULL CHECK (position_code IN (
    'A1L','A1R',
    'A1LO','A1LI','A1RI','A1RO',
    'A2LO','A2LI','A2RI','A2RO',
    'A3LO','A3LI','A3RI','A3RO'
  )),
  technician_id INTEGER,
  recorded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES app_users(id),
  UNIQUE (repair_id, position_code)
);

CREATE INDEX IF NOT EXISTS idx_repair_tire_positions_repair
ON repair_tire_positions(repair_id, created_at);

CREATE INDEX IF NOT EXISTS idx_repair_tire_positions_position
ON repair_tire_positions(position_code, created_at);
