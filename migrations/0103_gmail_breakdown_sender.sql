PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gmail_runtime_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  client_secret_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  connected_email TEXT,
  connected_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS gmail_oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gmail_oauth_states_expires_at
  ON gmail_oauth_states(expires_at);

ALTER TABLE roadside_breakdown_email_threads ADD COLUMN gmail_thread_id TEXT;
