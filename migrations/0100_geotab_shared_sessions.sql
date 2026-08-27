PRAGMA foreign_keys = ON;

-- Share the short-lived MyGeotab API session across Cloudflare isolates/POPs.
-- Different phones and browsers can be routed to different Worker isolates; without
-- a shared session every isolate authenticates independently and can be throttled.
-- The session id is encrypted by the Worker before it is stored here.
CREATE TABLE IF NOT EXISTS geotab_runtime_sessions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  session_ciphertext TEXT NOT NULL,
  session_iv TEXT NOT NULL,
  authenticated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
