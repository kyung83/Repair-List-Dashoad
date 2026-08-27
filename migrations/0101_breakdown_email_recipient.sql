PRAGMA foreign_keys = ON;

-- Keep the operational roadside mailbox in the existing configurable alert group.
INSERT INTO notification_group_contacts (group_id, label, phone, email, active)
SELECT g.id, 'Roadside Breakdown Mailbox', NULL, 'breakdown@norloworld.com', 1
FROM notification_groups g
WHERE g.name = 'Breakdown Alerts'
  AND NOT EXISTS (
    SELECT 1
    FROM notification_group_contacts c
    WHERE c.group_id = g.id
      AND lower(trim(COALESCE(c.email, ''))) = 'breakdown@norloworld.com'
  );

UPDATE notification_group_contacts
SET active = 1,
    label = CASE WHEN trim(COALESCE(label, '')) = '' THEN 'Roadside Breakdown Mailbox' ELSE label END
WHERE group_id = (SELECT id FROM notification_groups WHERE name = 'Breakdown Alerts')
  AND lower(trim(COALESCE(email, ''))) = 'breakdown@norloworld.com';
