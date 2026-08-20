CREATE TABLE IF NOT EXISTS geotab_runtime_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  credential_version INTEGER NOT NULL DEFAULT 1,
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);
