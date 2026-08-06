CREATE TABLE IF NOT EXISTS integration_credentials (
  name TEXT PRIMARY KEY,
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
