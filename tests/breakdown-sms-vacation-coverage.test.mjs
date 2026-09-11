import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  breakdownSmsLocalDateKey,
  isBreakdownSmsAwayPeriodActive,
} from '../lib/breakdown-sms-away-core.js';

const migration = readFileSync(new URL('../migrations/0133_breakdown_sms_vacation_coverage.sql', import.meta.url), 'utf8');
const vacationRuntime = readFileSync(new URL('../lib/breakdown-sms-vacation.ts', import.meta.url), 'utf8');
const scheduleApi = readFileSync(new URL('../app/api/admin/twilio/schedule/route.ts', import.meta.url), 'utf8');
const schedulePage = readFileSync(new URL('../app/admin/twilio/schedule/page.tsx', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../lib/notifications.ts', import.meta.url), 'utf8');

test('vacation dates are inclusive and evaluated in Detroit local time', () => {
  const period = { active: true, startDate: '2026-09-14', endDate: '2026-09-21' };
  assert.equal(breakdownSmsLocalDateKey(new Date('2026-09-14T03:30:00Z')), '2026-09-13');
  assert.equal(breakdownSmsLocalDateKey(new Date('2026-09-14T04:30:00Z')), '2026-09-14');
  assert.equal(isBreakdownSmsAwayPeriodActive(period, new Date('2026-09-14T04:30:00Z')), true);
  assert.equal(isBreakdownSmsAwayPeriodActive(period, new Date('2026-09-22T03:59:59Z')), true);
  assert.equal(isBreakdownSmsAwayPeriodActive(period, new Date('2026-09-22T04:00:00Z')), false);
});

test('vacation coverage persists dates and a different backup contact', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS breakdown_sms_contact_away_periods/);
  assert.match(migration, /backup_contact_id INTEGER/);
  assert.match(migration, /start_date TEXT NOT NULL/);
  assert.match(migration, /end_date TEXT NOT NULL/);
  assert.match(migration, /backup_contact_id IS NULL OR backup_contact_id <> contact_id/);
  assert.match(vacationRuntime, /saveBreakdownSmsAwayPeriod/);
  assert.match(vacationRuntime, /already has a vacation\/away period that overlaps/);
  assert.match(vacationRuntime, /Choose a different breakdown person as the vacation backup/);
});

test('away primary is suppressed and active backup inherits the primary normal window', () => {
  assert.match(vacationRuntime, /if \(!primary\.allowedNow\) continue/);
  assert.match(vacationRuntime, /if \(awayNowById\.get\(backup\.contactId\)\) continue/);
  assert.match(vacationRuntime, /!awayNow && \(normalAllowedNow \|\| coveringFor\.length > 0\)/);
  assert.match(notifications, /breakdownSmsContactAllows/);
});

test('admin can save and cancel vacation coverage without changing the normal schedule', () => {
  assert.match(scheduleApi, /action === 'save-away'/);
  assert.match(scheduleApi, /action === 'remove-away'/);
  assert.match(schedulePage, /VACATION \/ AWAY/);
  assert.match(schedulePage, /Backup person/);
  assert.match(schedulePage, /Save Vacation \/ Away/);
  assert.match(schedulePage, /normal schedule stays saved/i);
  assert.match(schedulePage, /resumes automatically/i);
  assert.match(schedulePage, /Pause Live Texts/);
  assert.match(schedulePage, /Enable Live Texts/);
});
