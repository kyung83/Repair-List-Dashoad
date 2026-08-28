-- Keep the Geotab driver phone number as part of the point-in-time breakdown
-- snapshot. Existing breakdowns remain NULL; new Geotab-backed breakdowns fill it.
ALTER TABLE roadside_breakdowns ADD COLUMN driver_phone TEXT;

-- Add the phone line to the untouched default new-breakdown SMS template. The
-- variable includes its own trailing newline only when Geotab supplied a number,
-- so manual/corrected breakdowns do not show an empty Driver Phone line.
UPDATE breakdown_sms_templates
SET body = 'ROADSIDE BREAKDOWN

Submitted: {{submitted_at}}
Driver: {{driver_name}}
{{driver_phone_line}}{{unit_label}}: {{unit}}
Location: {{city}}, {{state}}
Category: {{category}}
{{tire_line}}Description: {{description}}
Breakdown #: {{breakdown_id}}

Reply {{breakdown_id}} to claim this breakdown.',
    updated_at = CURRENT_TIMESTAMP
WHERE template_key = 'new_breakdown'
  AND body = 'ROADSIDE BREAKDOWN

Submitted: {{submitted_at}}
Driver: {{driver_name}}
{{unit_label}}: {{unit}}
Location: {{city}}, {{state}}
Category: {{category}}
{{tire_line}}Description: {{description}}
Breakdown #: {{breakdown_id}}

Reply {{breakdown_id}} to claim this breakdown.';
