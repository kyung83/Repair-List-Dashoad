import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authMigration = readFileSync(new URL('../migrations/0005_app_auth.sql', import.meta.url), 'utf8');
const fixMigration = readFileSync(new URL('../migrations/0134_fix_breakdown_sms_vacation_user_fk.sql', import.meta.url), 'utf8');

test('breakdown vacation audit user points at app_users instead of nonexistent users table', () => {
  assert.match(authMigration, /CREATE TABLE IF NOT EXISTS app_users/);
  assert.match(fixMigration, /REFERENCES app_users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(fixMigration, /REFERENCES users\(id\)/);
});

test('vacation FK repair preserves existing away rows while rebuilding the table', () => {
  assert.match(fixMigration, /INSERT INTO breakdown_sms_contact_away_periods_fixed/);
  assert.match(fixMigration, /FROM breakdown_sms_contact_away_periods/);
  assert.match(fixMigration, /DROP TABLE breakdown_sms_contact_away_periods/);
  assert.match(fixMigration, /RENAME TO breakdown_sms_contact_away_periods/);
});
