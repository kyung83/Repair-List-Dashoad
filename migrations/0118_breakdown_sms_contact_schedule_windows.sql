PRAGMA foreign_keys = ON;

-- Each Breakdown Text User can have several personal coverage windows in
-- addition to the shared office-hours schedule. Existing one-window custom
-- schedules are copied into this table so deployment preserves coverage.
CREATE TABLE IF NOT EXISTS breakdown_sms_contact_schedule_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  days_mask INTEGER NOT NULL DEFAULT 127,
  start_minute INTEGER NOT NULL DEFAULT 0,
  end_minute INTEGER NOT NULL DEFAULT 0,
  week_interval INTEGER NOT NULL DEFAULT 1 CHECK (week_interval IN (1,2)),
  anchor_week_start TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (contact_id) REFERENCES notification_group_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (days_mask BETWEEN 0 AND 127),
  CHECK (start_minute BETWEEN 0 AND 1439),
  CHECK (end_minute BETWEEN 0 AND 1439),
  CHECK (sort_order >= 0)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_sms_contact_windows_contact
ON breakdown_sms_contact_schedule_windows(contact_id, sort_order, id);

INSERT INTO breakdown_sms_contact_schedule_windows (
  contact_id,
  label,
  days_mask,
  start_minute,
  end_minute,
  week_interval,
  anchor_week_start,
  timezone,
  sort_order,
  created_at,
  updated_at,
  updated_by_user_id
)
SELECT
  s.contact_id,
  'Existing personal coverage',
  s.days_mask,
  s.start_minute,
  s.end_minute,
  s.week_interval,
  s.anchor_week_start,
  s.timezone,
  0,
  COALESCE(s.updated_at, CURRENT_TIMESTAMP),
  COALESCE(s.updated_at, CURRENT_TIMESTAMP),
  s.updated_by_user_id
FROM breakdown_sms_contact_schedules s
WHERE s.mode = 'custom'
  AND NOT EXISTS (
    SELECT 1
    FROM breakdown_sms_contact_schedule_windows w
    WHERE w.contact_id = s.contact_id
  );
