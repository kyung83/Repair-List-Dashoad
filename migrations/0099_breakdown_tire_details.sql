PRAGMA foreign_keys = ON;

-- Driver-reported tire details are preserved separately from technician tire work.
-- The repair/breakdown still has exactly one affected equipment_id.
CREATE TABLE IF NOT EXISTS roadside_breakdown_tires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  breakdown_id INTEGER NOT NULL,
  repair_id INTEGER NOT NULL,
  position_code TEXT NOT NULL CHECK (position_code IN (
    'A1L','A1R',
    'A1LO','A1LI','A1RI','A1RO',
    'A2LO','A2LI','A2RI','A2RO',
    'A3LO','A3LI','A3RI','A3RO'
  )),
  tire_size TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (breakdown_id) REFERENCES roadside_breakdowns(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  UNIQUE (breakdown_id, position_code)
);

CREATE INDEX IF NOT EXISTS idx_roadside_breakdown_tires_breakdown
ON roadside_breakdown_tires(breakdown_id, position_code);

CREATE INDEX IF NOT EXISTS idx_roadside_breakdown_tires_repair
ON roadside_breakdown_tires(repair_id, position_code);
