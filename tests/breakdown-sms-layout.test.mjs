import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../migrations/0114_fix_breakdown_sms_layout.sql', import.meta.url), 'utf8');

test('new breakdown SMS uses real line breaks and mirrors the email field layout', () => {
  assert.ok(migration.includes("SET body = 'ROADSIDE BREAKDOWN\n\nSubmitted: {{submitted_at}}\nDriver: {{driver_name}}"));
  assert.ok(migration.includes('Category: {{category}}\n{{tire_line}}Description: {{description}}\nBreakdown #: {{breakdown_id}}'));
  assert.ok(migration.includes('Reply {{breakdown_id}} to claim this breakdown.'));
});

test('migration only replaces the untouched legacy literal-backslash template', () => {
  assert.ok(migration.includes("AND body = 'ROADSIDE BREAKDOWN\\n\\nSubmitted: {{submitted_at}}"));
});
