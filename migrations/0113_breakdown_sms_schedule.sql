PRAGMA foreign_keys = ON;

-- Controls when live breakdown SMS alerts are allowed to leave Cloudflare.
-- Email delivery is intentionally separate and is not restricted by this table.
CREATE TABLE IF NOT EXISTS breakdown_sms_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  days_mask INTEGER NOT NULL DEFAULT 127,
  start_minute INTEGER NOT NULL DEFAULT 0,
  end_minute INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (enabled IN (0,1)),
  CHECK (days_mask BETWEEN 0 AND 127),
  CHECK (start_minute BETWEEN 0 AND 1439),
  CHECK (end_minute BETWEEN 0 AND 1439)
);

-- Disabled schedule means Always On. Start=end means a full 24-hour window
-- on each selected day when the schedule is enabled.
INSERT OR IGNORE INTO breakdown_sms_schedule (
  id, enabled, days_mask, start_minute, end_minute, timezone
) VALUES (1, 0, 127, 0, 0, 'America/Detroit');
