PRAGMA foreign_keys = ON;

-- Roadside breakdowns ride in the same repairs table as everything else
-- (source = 'roadside-breakdown'), so total-cost-per-truck reporting works
-- with no extra joins. This table holds the breakdown-specific fields that
-- don't belong on the generic repairs row.
CREATE TABLE IF NOT EXISTS roadside_breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  equipment_id INTEGER NOT NULL,
  trailer_equipment_id INTEGER,
  driver_name TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  repair_category TEXT NOT NULL,
  repair_needed TEXT,
  description TEXT NOT NULL DEFAULT '',
  stage INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reported',
  service_provider TEXT,
  service_provider_phone TEXT,
  eta TEXT,
  claimed_by_user_id INTEGER,
  claimed_at TEXT,
  on_location_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE RESTRICT,
  FOREIGN KEY (trailer_equipment_id) REFERENCES equipment(id) ON DELETE SET NULL,
  FOREIGN KEY (claimed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roadside_breakdowns_stage ON roadside_breakdowns(stage);
CREATE INDEX IF NOT EXISTS idx_roadside_breakdowns_equipment ON roadside_breakdowns(equipment_id);
CREATE INDEX IF NOT EXISTS idx_roadside_breakdowns_claimed_by ON roadside_breakdowns(claimed_by_user_id);

-- Configurable alert groups, replacing the hardcoded phone/email lists that
-- lived in Apps Script. Admins manage membership from the dashboard.
CREATE TABLE IF NOT EXISTS notification_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_group_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES notification_groups(id) ON DELETE CASCADE,
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_notification_group_contacts_group ON notification_group_contacts(group_id);

-- Every SMS/email attempt gets logged here regardless of whether sending is
-- actually enabled (see lib/notifications.ts) -- useful for testing the flow
-- end to end before Twilio/email are switched on for real.
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  breakdown_id INTEGER,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  recipient TEXT,
  body TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (breakdown_id) REFERENCES roadside_breakdowns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_log_breakdown ON notification_log(breakdown_id);

INSERT OR IGNORE INTO notification_groups (name, active) VALUES ('Breakdown Alerts', 1);
