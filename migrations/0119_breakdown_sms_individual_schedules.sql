PRAGMA foreign_keys = ON;

-- The shared office-hours schedule is retired. Preserve the exact coverage that
-- existed before this migration by copying the shared window into each person's
-- own list of coverage windows. After this migration, recipient eligibility is
-- determined only by that person's mode and personal windows.

-- Make room for the migrated office-hours window at the top of each applicable
-- person's list.
UPDATE breakdown_sms_contact_schedule_windows
SET sort_order = sort_order + 1
WHERE contact_id IN (
  SELECT c.id
  FROM notification_group_contacts c
  JOIN notification_groups g
    ON g.id = c.group_id
   AND g.name = 'Breakdown Alerts'
  JOIN breakdown_sms_schedule shared
    ON shared.id = 1
   AND shared.enabled = 1
  LEFT JOIN breakdown_sms_contact_schedules personal
    ON personal.contact_id = c.id
  WHERE c.phone IS NOT NULL
    AND trim(c.phone) <> ''
    AND COALESCE(personal.mode, 'default') <> 'always'
);

-- Copy the old shared window into every person who previously depended on it.
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
  c.id,
  'Office hours (migrated)',
  shared.days_mask,
  shared.start_minute,
  shared.end_minute,
  shared.week_interval,
  shared.anchor_week_start,
  shared.timezone,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  shared.updated_by_user_id
FROM notification_group_contacts c
JOIN notification_groups g
  ON g.id = c.group_id
 AND g.name = 'Breakdown Alerts'
JOIN breakdown_sms_schedule shared
  ON shared.id = 1
 AND shared.enabled = 1
LEFT JOIN breakdown_sms_contact_schedules personal
  ON personal.contact_id = c.id
WHERE c.phone IS NOT NULL
  AND trim(c.phone) <> ''
  AND COALESCE(personal.mode, 'default') <> 'always'
  AND NOT EXISTS (
    SELECT 1
    FROM breakdown_sms_contact_schedule_windows existing
    WHERE existing.contact_id = c.id
      AND existing.label = 'Office hours (migrated)'
  );

-- Ensure everyone who received the old shared window now uses their own windows.
INSERT OR IGNORE INTO breakdown_sms_contact_schedules (
  contact_id,
  mode,
  days_mask,
  start_minute,
  end_minute,
  week_interval,
  anchor_week_start,
  timezone,
  updated_at,
  updated_by_user_id
)
SELECT
  c.id,
  'custom',
  shared.days_mask,
  shared.start_minute,
  shared.end_minute,
  shared.week_interval,
  shared.anchor_week_start,
  shared.timezone,
  CURRENT_TIMESTAMP,
  shared.updated_by_user_id
FROM notification_group_contacts c
JOIN notification_groups g
  ON g.id = c.group_id
 AND g.name = 'Breakdown Alerts'
JOIN breakdown_sms_schedule shared
  ON shared.id = 1
 AND shared.enabled = 1
LEFT JOIN breakdown_sms_contact_schedules personal
  ON personal.contact_id = c.id
WHERE c.phone IS NOT NULL
  AND trim(c.phone) <> ''
  AND COALESCE(personal.mode, 'default') <> 'always';

UPDATE breakdown_sms_contact_schedules
SET mode = 'custom',
    updated_at = CURRENT_TIMESTAMP
WHERE contact_id IN (
  SELECT c.id
  FROM notification_group_contacts c
  JOIN notification_groups g
    ON g.id = c.group_id
   AND g.name = 'Breakdown Alerts'
  JOIN breakdown_sms_schedule shared
    ON shared.id = 1
   AND shared.enabled = 1
  LEFT JOIN breakdown_sms_contact_schedules personal
    ON personal.contact_id = c.id
  WHERE c.phone IS NOT NULL
    AND trim(c.phone) <> ''
    AND COALESCE(personal.mode, 'default') <> 'always'
);

-- An old disabled shared window meant shared coverage was Always On. Preserve
-- that behavior by moving those people to their own Always mode. This also
-- covers installations where the legacy shared row never existed.
INSERT OR IGNORE INTO breakdown_sms_contact_schedules (
  contact_id,
  mode,
  days_mask,
  start_minute,
  end_minute,
  week_interval,
  anchor_week_start,
  timezone,
  updated_at,
  updated_by_user_id
)
SELECT
  c.id,
  'always',
  127,
  0,
  0,
  1,
  NULL,
  'America/Detroit',
  CURRENT_TIMESTAMP,
  NULL
FROM notification_group_contacts c
JOIN notification_groups g
  ON g.id = c.group_id
 AND g.name = 'Breakdown Alerts'
WHERE c.phone IS NOT NULL
  AND trim(c.phone) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM breakdown_sms_schedule shared
    WHERE shared.id = 1
      AND shared.enabled = 1
  );

UPDATE breakdown_sms_contact_schedules
SET mode = 'always',
    updated_at = CURRENT_TIMESTAMP
WHERE contact_id IN (
  SELECT c.id
  FROM notification_group_contacts c
  JOIN notification_groups g
    ON g.id = c.group_id
   AND g.name = 'Breakdown Alerts'
  WHERE c.phone IS NOT NULL
    AND trim(c.phone) <> ''
)
AND mode <> 'always'
AND NOT EXISTS (
  SELECT 1
  FROM breakdown_sms_schedule shared
  WHERE shared.id = 1
    AND shared.enabled = 1
);
