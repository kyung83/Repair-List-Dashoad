PRAGMA foreign_keys = ON;

-- Normalize the legacy strict-40 profile name when it is safe to do so.
UPDATE pm_profiles
SET name = 'Strict 40 PM', updated_at = CURRENT_TIMESTAMP
WHERE name = 'Strict 40 NY PM'
  AND NOT EXISTS (SELECT 1 FROM pm_profiles WHERE name = 'Strict 40 PM');

INSERT OR IGNORE INTO pm_profiles (name, sequence_json)
VALUES
  ('Strict 40 PM', '["40"]'),
  ('Trailer Service', '["Service"]');
