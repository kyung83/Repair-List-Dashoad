PRAGMA foreign_keys = ON;

-- Existing schedules remain weekly. Setting week_interval=2 activates an
-- every-other-week rotation anchored to a Monday in America/Detroit time.
ALTER TABLE breakdown_sms_schedule
ADD COLUMN week_interval INTEGER NOT NULL DEFAULT 1 CHECK (week_interval IN (1,2));

ALTER TABLE breakdown_sms_schedule
ADD COLUMN anchor_week_start TEXT;

ALTER TABLE breakdown_sms_contact_schedules
ADD COLUMN week_interval INTEGER NOT NULL DEFAULT 1 CHECK (week_interval IN (1,2));

ALTER TABLE breakdown_sms_contact_schedules
ADD COLUMN anchor_week_start TEXT;
