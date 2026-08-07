PRAGMA foreign_keys = ON;

-- Normalize the strict profile label and add a trailer-specific service profile.
UPDATE pm_profiles
SET name = 'Strict 40 PM', updated_at = CURRENT_TIMESTAMP
WHERE name = 'Strict 40 NY PM'
  AND NOT EXISTS (SELECT 1 FROM pm_profiles WHERE name = 'Strict 40 PM');

INSERT OR IGNORE INTO pm_profiles (name, sequence_json)
VALUES ('Strict 40 PM', '["40"]');

INSERT OR IGNORE INTO pm_profiles (name, sequence_json)
VALUES ('Trailer Service', '["Service"]');

CREATE INDEX IF NOT EXISTS idx_equipment_pm_profile ON equipment_pm_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_pm_status_service_date ON pm_status(service_date);
CREATE INDEX IF NOT EXISTS idx_pm_status_annual_date ON pm_status(annual_date);
