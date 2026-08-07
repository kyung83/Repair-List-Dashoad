UPDATE app_users
SET
  password_hash = 'FAYs1YRazuSsrs_yiWoyS-unGc2W4qUiCk2tq7gUfNI',
  password_salt = 'A3C4LLez48JG5hXSRyV89A',
  password_iterations = 0,
  password_algorithm = 'scrypt-v1',
  role = 'admin',
  active = 1,
  force_password_change = 0,
  updated_at = CURRENT_TIMESTAMP
WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE;

DELETE FROM app_sessions
WHERE user_id IN (
  SELECT id
  FROM app_users
  WHERE email = 'dashboard-admin@norlow.invalid' COLLATE NOCASE
);

DELETE FROM app_login_attempts;
