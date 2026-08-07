PRAGMA foreign_keys = ON;

-- Category-level maintenance templates. Units inherit these rules when a category
-- rule is saved or when the unit is assigned to that category.
CREATE TABLE IF NOT EXISTS pm_category_presets (
  category TEXT PRIMARY KEY,
  profile_id INTEGER,
  mileage_interval INTEGER,
  time_interval_days INTEGER,
  annual_interval_days INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES pm_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_pm_category_presets_active
ON pm_category_presets(active);

CREATE INDEX IF NOT EXISTS idx_repairs_maintenance_source
ON repairs(source, equipment_id, status);
