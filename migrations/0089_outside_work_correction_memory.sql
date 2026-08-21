CREATE TABLE IF NOT EXISTS outside_work_correction_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  detected_value TEXT NOT NULL,
  detected_key TEXT NOT NULL,
  corrected_value TEXT NOT NULL,
  corrected_key TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outside_work_correction_unique
ON outside_work_correction_memory(vendor_id,field_name,detected_key,corrected_key);

CREATE INDEX IF NOT EXISTS idx_outside_work_correction_lookup
ON outside_work_correction_memory(field_name,detected_key,vendor_id,confirmations);
