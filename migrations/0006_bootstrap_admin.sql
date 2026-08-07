PRAGMA foreign_keys = ON;

-- One-time bootstrap administrator. The repository contains only the PBKDF2
-- hash/salt; the temporary plaintext password is never committed.
INSERT INTO app_users (
  email,
  display_name,
  role,
  password_hash,
  password_salt,
  password_iterations,
  active,
  force_password_change
)
SELECT
  'dashboard-admin@norlow.invalid',
  'Norlow Bootstrap Admin',
  'admin',
  'mP6M9T-mlTfCxLFI7wCUpRrRgpDzAD51lh0eZeIWtWk',
  'LGrKWrzxnV4S8A3YOy53wg',
  210000,
  1,
  0
WHERE NOT EXISTS (SELECT 1 FROM app_users);
