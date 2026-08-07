PRAGMA foreign_keys = ON;

-- Reset the one-time bootstrap administrator to a simple alphanumeric temporary password.
-- Only the PBKDF2 hash/salt are stored in the repository.
UPDATE app_users
SET password_hash = '-uLLbYzMW07HfNn-p28D9B400IVLE_XQczZmp6CQwuA',
    password_salt = 'wIzuqZEKY7FLRf08_JDRAQ',
    password_iterations = 210000,
    active = 1,
    force_password_change = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE;

DELETE FROM app_login_attempts;
DELETE FROM app_sessions WHERE user_id IN (
  SELECT id FROM app_users WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE
);
