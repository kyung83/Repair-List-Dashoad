PRAGMA foreign_keys = OFF;

CREATE TABLE breakdown_sms_contact_away_periods_fixed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  backup_contact_id INTEGER,
  label TEXT NOT NULL DEFAULT 'Vacation / Away',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (contact_id) REFERENCES notification_group_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (backup_contact_id) REFERENCES notification_group_contacts(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (start_date <= end_date),
  CHECK (backup_contact_id IS NULL OR backup_contact_id <> contact_id)
);

INSERT INTO breakdown_sms_contact_away_periods_fixed (
  id,
  contact_id,
  start_date,
  end_date,
  backup_contact_id,
  label,
  active,
  created_at,
  updated_at,
  updated_by_user_id
)
SELECT
  id,
  contact_id,
  start_date,
  end_date,
  backup_contact_id,
  label,
  active,
  created_at,
  updated_at,
  updated_by_user_id
FROM breakdown_sms_contact_away_periods;

DROP TABLE breakdown_sms_contact_away_periods;
ALTER TABLE breakdown_sms_contact_away_periods_fixed RENAME TO breakdown_sms_contact_away_periods;

CREATE INDEX IF NOT EXISTS idx_breakdown_sms_away_contact_dates
  ON breakdown_sms_contact_away_periods(contact_id, active, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_breakdown_sms_away_backup_dates
  ON breakdown_sms_contact_away_periods(backup_contact_id, active, start_date, end_date);

PRAGMA foreign_keys = ON;
