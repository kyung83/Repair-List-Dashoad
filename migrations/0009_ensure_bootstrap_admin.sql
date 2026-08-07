PRAGMA foreign_keys = ON;

-- Ensure the temporary bootstrap administrator actually exists even if another
-- user row was created before the bootstrap migration ran.
INSERT INTO app_users (
  email,
  display_name,
  role,
  password_hash,
  password_salt,
  password_iterations,
  active,
  force_password_change,
  updated_at
) VALUES (
  'dashboard-admin@norlow.invalid',
  'Norlow Bootstrap Admin',
  'admin',
  '-uLLbYzMW07HfNn-p28D9B400IVLE_XQczZmp6CQwuA',
  'wIzuqZEKY7FLRf08_JDRAQ',
  210000,
  1,
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  role = 'admin',
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  password_iterations = excluded.password_iterations,
  active = 1,
  force_password_change = 0,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM app_login_attempts;
DELETE FROM app_sessions WHERE user_id IN (
  SELECT id FROM app_users WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE
);
