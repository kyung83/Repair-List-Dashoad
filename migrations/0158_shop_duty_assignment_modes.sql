PRAGMA foreign_keys = ON;

-- Match the intended Shop Duties assignment behavior:
-- bathroom = all-mechanic weekly round robin
-- shop check = selected-mechanic rotation on a configured maintenance shift
-- monthly facility = manager assigns the mechanic manually each month
UPDATE shop_duty_templates
SET cadence='weekly', assignment_mode='all_mechanics_rotation', due_day=5, active=1, updated_at=CURRENT_TIMESTAMP
WHERE template_key='bathroom-weekly';

UPDATE shop_duty_templates
SET cadence='shift', assignment_mode='selected_rotation', active=0, updated_at=CURRENT_TIMESTAMP
WHERE template_key='shift-shop-inspection';

UPDATE shop_duty_templates
SET cadence='monthly', assignment_mode='fixed', due_day=28, active=1, updated_at=CURRENT_TIMESTAMP
WHERE template_key='monthly-facility';
