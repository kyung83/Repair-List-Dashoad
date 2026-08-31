CREATE TABLE IF NOT EXISTS breakdown_driver_directory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  first_name_norm TEXT NOT NULL,
  last_name_norm TEXT NOT NULL,
  full_name_norm TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  phone_display TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (generation, source_row)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_driver_directory_generation_name
ON breakdown_driver_directory(generation, full_name_norm);

CREATE INDEX IF NOT EXISTS idx_breakdown_driver_directory_generation_first
ON breakdown_driver_directory(generation, first_name_norm);

CREATE INDEX IF NOT EXISTS idx_breakdown_driver_directory_generation_last
ON breakdown_driver_directory(generation, last_name_norm);

CREATE TABLE IF NOT EXISTS breakdown_driver_directory_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO breakdown_driver_directory_sync (
  id,
  active_generation,
  last_attempt_at,
  last_success_at,
  last_error,
  row_count
) VALUES (1, NULL, NULL, NULL, NULL, 0);
