PRAGMA foreign_keys = ON;

-- Reset the temporary bootstrap administrator after the initial login test failed.
-- Only the PBKDF2 hash/salt are stored here; the temporary plaintext password is not committed.
UPDATE app_users
SET password_hash = 'B871MO1nBtvpPvrKuywcio8YoroP6t3rFfOE304_3tY',
    password_salt = 'dcy3ML74h1I6LtjnWsFEkw',
    password_iterations = 210000,
    active = 1,
    force_password_change = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE;

DELETE FROM app_login_attempts;
DELETE FROM app_sessions WHERE user_id IN (
  SELECT id FROM app_users WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE
);
