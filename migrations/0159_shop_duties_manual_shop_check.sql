PRAGMA foreign_keys = ON;

-- Shop Check is now manager-assigned each time, not shift-driven.
UPDATE shop_duty_templates
SET assignment_mode='fixed',
    shift_id=NULL,
    active=1,
    updated_at=CURRENT_TIMESTAMP
WHERE template_key='shift-shop-inspection';
