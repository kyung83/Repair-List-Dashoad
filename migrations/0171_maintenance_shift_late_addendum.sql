-- Non-destructive, idempotent ledger for supplemental late work reports.
-- The original 30-minute shift summary and its send ledger are unchanged.
CREATE TABLE IF NOT EXISTS maintenance_shift_late_addendum_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  shift_work_date TEXT NOT NULL,
  range_started_at TEXT NOT NULL,
  range_ended_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  error TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shift_id,shift_work_date),
  FOREIGN KEY (shift_id) REFERENCES maintenance_shifts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maintenance_shift_late_addendum_status
  ON maintenance_shift_late_addendum_runs(status,last_attempt_at);
