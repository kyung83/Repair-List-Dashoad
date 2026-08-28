-- The original Twilio template was seeded with literal backslash-n text. SQLite
-- does not treat \n as an escape inside a quoted string, so phones displayed the
-- characters "\n" instead of real line breaks. Only replace the untouched
-- original template so any administrator customization remains intact.
UPDATE breakdown_sms_templates
SET body = 'ROADSIDE BREAKDOWN

Submitted: {{submitted_at}}
Driver: {{driver_name}}
{{unit_label}}: {{unit}}
Location: {{city}}, {{state}}
Category: {{category}}
{{tire_line}}Description: {{description}}
Breakdown #: {{breakdown_id}}

Reply {{breakdown_id}} to claim this breakdown.',
    updated_at = CURRENT_TIMESTAMP
WHERE template_key = 'new_breakdown'
  AND body = 'ROADSIDE BREAKDOWN\n\nSubmitted: {{submitted_at}}\nDriver: {{driver_name}}\n{{unit_label}}: {{unit}}\nLocation: {{city}}, {{state}}\nCategory: {{category}}\n{{tire_line}}{{description}}\n\nReply {{breakdown_id}} to claim this breakdown.';
