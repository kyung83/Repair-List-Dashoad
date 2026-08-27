PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roadside_breakdown_email_threads (
  breakdown_id INTEGER NOT NULL,
  recipient TEXT NOT NULL COLLATE NOCASE,
  root_message_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (breakdown_id, recipient),
  FOREIGN KEY (breakdown_id) REFERENCES roadside_breakdowns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_breakdown_email_threads_breakdown
ON roadside_breakdown_email_threads(breakdown_id);
