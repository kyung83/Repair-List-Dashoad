PRAGMA foreign_keys = ON;

-- Optional per-person overrides for the Breakdown Alerts SMS group.
-- mode=default follows breakdown_sms_schedule, mode=always ignores the default
-- window, and mode=custom uses this row's own days and time window.
CREATE TABLE IF NOT EXISTS breakdown_sms_contact_schedules (
  contact_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'default' CHECK (mode IN ('default','always','custom')),
  days_mask INTEGER NOT NULL DEFAULT 127,
  start_minute INTEGER NOT NULL DEFAULT 0,
  end_minute INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (contact_id) REFERENCES notification_group_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (days_mask BETWEEN 0 AND 127),
  CHECK (start_minute BETWEEN 0 AND 1439),
  CHECK (end_minute BETWEEN 0 AND 1439)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_sms_contact_schedules_mode
ON breakdown_sms_contact_schedules(mode, contact_id);
