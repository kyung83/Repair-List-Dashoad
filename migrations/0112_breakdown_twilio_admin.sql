PRAGMA foreign_keys = ON;

-- Runtime Twilio credentials are entered once from the admin dashboard. The
-- Auth Token is encrypted with the same dashboard runtime encryption key used
-- for the Geotab/Gmail runtime credentials.
CREATE TABLE IF NOT EXISTS twilio_runtime_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_sid TEXT NOT NULL,
  auth_token_ciphertext TEXT NOT NULL,
  auth_token_iv TEXT NOT NULL,
  sender TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

-- Text wording lives in D1 so an administrator can change what Twilio sends
-- without a code deploy.
CREATE TABLE IF NOT EXISTS breakdown_sms_templates (
  template_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO breakdown_sms_templates(template_key,label,body,active) VALUES
(
  'new_breakdown',
  'New breakdown alert',
  'ROADSIDE BREAKDOWN\n\nSubmitted: {{submitted_at}}\nDriver: {{driver_name}}\n{{unit_label}}: {{unit}}\nLocation: {{city}}, {{state}}\nCategory: {{category}}\n{{tire_line}}{{description}}\n\nReply {{breakdown_id}} to claim this breakdown.',
  1
),
(
  'claim_confirmed',
  'Claim confirmed reply',
  'Breakdown #{{breakdown_id}} is assigned to {{contact_label}}.',
  1
),
(
  'claim_already',
  'Already claimed reply',
  'Breakdown #{{breakdown_id}} was already claimed by someone else.',
  1
),
(
  'claim_invalid',
  'Invalid claim reply',
  'Reply with only the breakdown number shown in the alert.',
  1
);

-- A Twilio reply can now claim a breakdown by a configured Breakdown Alerts
-- contact, not only by a dashboard app_user.
ALTER TABLE roadside_breakdowns ADD COLUMN claimed_by_notification_contact_id INTEGER REFERENCES notification_group_contacts(id) ON DELETE SET NULL;
ALTER TABLE roadside_breakdowns ADD COLUMN claimed_by_label TEXT;

CREATE INDEX IF NOT EXISTS idx_roadside_breakdowns_claimed_sms_contact
  ON roadside_breakdowns(claimed_by_notification_contact_id);
CREATE INDEX IF NOT EXISTS idx_notification_group_contacts_phone
  ON notification_group_contacts(group_id, phone);
