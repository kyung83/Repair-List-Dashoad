PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  days_of_week TEXT NOT NULL DEFAULT '1,2,3,4,5',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  summary_delay_minutes INTEGER NOT NULL DEFAULT 30 CHECK (summary_delay_minutes = 30),
  summary_recipient TEXT NOT NULL DEFAULT 'Maintenance@norloworld.com',
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_maintenance_shifts_active
ON maintenance_shifts(active, start_time, end_time);

CREATE TABLE IF NOT EXISTS maintenance_shift_assignments (
  user_id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES maintenance_shifts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_maintenance_shift_assignments_shift
ON maintenance_shift_assignments(shift_id, user_id);

CREATE TABLE IF NOT EXISTS maintenance_shift_summary_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  shift_work_date TEXT NOT NULL,
  shift_started_at TEXT NOT NULL,
  shift_ended_at TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  sent_at TEXT,
  error TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shift_id, shift_work_date),
  FOREIGN KEY (shift_id) REFERENCES maintenance_shifts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_maintenance_shift_summary_due
ON maintenance_shift_summary_runs(status, scheduled_for, last_attempt_at);
