import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  breakdownSmsAnchorForCurrentWeek,
  currentBreakdownSmsWeekStart,
  isBreakdownSmsScheduleAllowed,
  isBreakdownSmsWeekActive,
} from '../lib/breakdown-sms-schedule-core.js';

const runtime = readFileSync(new URL('../lib/twilio-runtime.ts', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../lib/notifications.ts', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('../app/api/webhook/twilio-sms/route.ts', import.meta.url), 'utf8');
const claims = readFileSync(new URL('../lib/breakdown-sms-claims.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/api/admin/twilio/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/admin/twilio/page.tsx', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../app/navigation-config.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0112_breakdown_twilio_admin.sql', import.meta.url), 'utf8');
const scheduleRuntime = readFileSync(new URL('../lib/breakdown-sms-schedule.ts', import.meta.url), 'utf8');
const scheduleCore = readFileSync(new URL('../lib/breakdown-sms-schedule-core.js', import.meta.url), 'utf8');
const scheduleApi = readFileSync(new URL('../app/api/admin/twilio/schedule/route.ts', import.meta.url), 'utf8');
const schedulePage = readFileSync(new URL('../app/admin/twilio/schedule/page.tsx', import.meta.url), 'utf8');
const contactScheduleMigration = readFileSync(new URL('../migrations/0116_breakdown_sms_contact_schedules.sql', import.meta.url), 'utf8');
const biweeklyMigration = readFileSync(new URL('../migrations/0117_breakdown_sms_biweekly_rotation.sql', import.meta.url), 'utf8');
const multipleWindowMigration = readFileSync(new URL('../migrations/0118_breakdown_sms_contact_schedule_windows.sql', import.meta.url), 'utf8');
const individualScheduleMigration = readFileSync(new URL('../migrations/0119_breakdown_sms_individual_schedules.sql', import.meta.url), 'utf8');

test('Twilio credentials are admin-managed and auth token is encrypted', () => {
  assert.match(api, /user\.role !== 'admin'/);
  assert.match(runtime, /encryptGeotabRuntimeSecret\(authToken, env\)/);
  assert.match(runtime, /decryptGeotabRuntimeSecret/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS twilio_runtime_credentials/);
  assert.match(page, /Replace Twilio credentials/);
  assert.match(page, /Auth Token/);
  assert.match(page, /never shown back/);
});

test('Twilio outbound breakdown SMS uses Messages API and runtime live switch', () => {
  assert.match(runtime, /api\.twilio\.com\/2010-04-01\/Accounts/);
  assert.match(runtime, /Messages\.json/);
  assert.match(runtime, /MessagingServiceSid/);
  assert.match(runtime, /form\.set\('From'/);
  assert.match(notifications, /twilioRuntimeReady/);
  assert.match(notifications, /sendTwilioRuntimeSms/);
});

test('Admin controls breakdown text recipients and editable wording in D1', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS breakdown_sms_templates/);
  assert.match(runtime, /addBreakdownSmsContact/);
  assert.match(runtime, /updateBreakdownSmsContact/);
  assert.match(runtime, /removeBreakdownSmsContact/);
  assert.match(page, /BREAKDOWN TEXT USERS/);
  assert.match(page, /Messages Twilio reads from Cloudflare/);
  assert.match(navigation, /href: "\/admin\/twilio", label: "Breakdown Texting"/);
  assert.match(notifications, /buildNewBreakdownSms/);
});

test('Inbound Twilio replies are public only at the signed webhook and only active configured users can claim', () => {
  assert.match(worker, /'\/api\/webhook\/twilio-sms'/);
  assert.match(webhook, /validateTwilioWebhook/);
  assert.match(webhook, /findActiveBreakdownSmsContactByPhone/);
  assert.match(runtime, /x-twilio-signature/);
  assert.match(runtime, /HMAC/);
  assert.match(runtime, /SHA-1/);
  assert.match(claims, /claimed_by_notification_contact_id IS NULL/);
  assert.match(claims, /status='assigned'/);
  assert.match(migration, /trg_preserve_roadside_sms_claim/);
});

test('Twilio admin includes webhook URL, live pause, and test text controls', () => {
  assert.match(api, /\/api\/webhook\/twilio-sms/);
  assert.match(page, /Inbound Twilio webhook/);
  assert.match(page, /Enable Live Texts/);
  assert.match(page, /Pause Live Texts/);
  assert.match(page, /Send Test/);
});

test('Breakdown SMS recipient schedules are admin-managed in Detroit time and gate new alerts only', () => {
  assert.match(contactScheduleMigration, /CREATE TABLE IF NOT EXISTS breakdown_sms_contact_schedules/);
  assert.match(contactScheduleMigration, /America\/Detroit/);
  assert.match(scheduleRuntime, /BREAKDOWN_SMS_TIMEZONE/);
  assert.match(scheduleCore, /Overnight window/);
  assert.match(scheduleCore, /previousDay/);
  assert.match(scheduleApi, /user\.role !== 'admin'/);
  assert.match(scheduleApi, /saveBreakdownSmsContactSchedule/);
  assert.match(notifications, /breakdownSmsScheduleAllows/);
  assert.match(notifications, /Outside configured breakdown SMS schedule/);
  assert.match(schedulePage, /Breakdown email still sends immediately/);
  assert.match(schedulePage, /Individual Breakdown Text Schedules/);
  assert.match(schedulePage, /type="time"/);
  assert.doesNotMatch(schedulePage, /SHARED OFFICE HOURS/);
  assert.match(navigation, /href: "\/admin\/twilio\/schedule", label: "Text Schedule"/);
});

test('Each breakdown text user has an independent mode and independent coverage windows', () => {
  assert.match(contactScheduleMigration, /mode IN \('default','always','custom'\)/);
  assert.match(contactScheduleMigration, /REFERENCES notification_group_contacts\(id\) ON DELETE CASCADE/);
  assert.match(scheduleRuntime, /BreakdownSmsContactScheduleMode = 'default' \| 'always' \| 'custom'/);
  assert.match(scheduleRuntime, /getBreakdownSmsContactSchedules/);
  assert.match(scheduleRuntime, /saveBreakdownSmsContactSchedule/);
  assert.match(scheduleRuntime, /breakdownSmsScheduleAllows\(db: D1Database, contactId\?: number\)/);
  assert.match(scheduleApi, /action !== 'save-contact'/);
  assert.match(schedulePage, /Pause scheduled breakdown texts/);
  assert.match(schedulePage, /Always text this person/);
  assert.match(schedulePage, /Use this person’s coverage windows/);
  assert.match(schedulePage, /One person’s hours never change another person’s hours/);
  assert.match(notifications, /sendBreakdownSms\(breakdownId, phone, outboundMessage, contact\.id\)/);
});

test('The old shared schedule is migrated into personal windows and then ignored', () => {
  assert.match(individualScheduleMigration, /Office hours \(migrated\)/);
  assert.match(individualScheduleMigration, /INSERT INTO breakdown_sms_contact_schedule_windows/);
  assert.match(individualScheduleMigration, /SET mode = 'custom'/);
  assert.match(individualScheduleMigration, /SET mode = 'always'/);
  assert.match(scheduleRuntime, /if \(mode === 'default'\) return false/);
  assert.match(scheduleRuntime, /personalCores\.some/);
  assert.match(scheduleRuntime, /if \(!contactId\) return true/);
  assert.match(scheduleApi, /action === 'save-default'/);
  assert.match(scheduleApi, /The shared schedule was removed/);
  assert.match(schedulePage, /There is no shared office-hours setting/);
  assert.doesNotMatch(schedulePage, /Save Shared Office Hours/);
});

test('A person can save several separate personal coverage windows', () => {
  assert.match(multipleWindowMigration, /CREATE TABLE IF NOT EXISTS breakdown_sms_contact_schedule_windows/);
  assert.match(multipleWindowMigration, /INSERT INTO breakdown_sms_contact_schedule_windows/);
  assert.match(multipleWindowMigration, /Existing personal coverage/);
  assert.match(multipleWindowMigration, /REFERENCES notification_group_contacts\(id\) ON DELETE CASCADE/);
  assert.match(scheduleRuntime, /MAX_BREAKDOWN_SMS_PERSONAL_WINDOWS = 12/);
  assert.match(scheduleRuntime, /contactScheduleWindowRows/);
  assert.match(scheduleRuntime, /personalRows\.map\(windowCore\)/);
  assert.match(scheduleRuntime, /db\.batch\(statements\)/);
  assert.match(scheduleApi, /requestedWindows\(body\.windows\)/);
  assert.match(schedulePage, /Add Another Coverage Window/);
  assert.match(schedulePage, /Remove Window/);
  assert.match(schedulePage, /Different start times/);
});

test('Personal coverage windows support a safe every-other-week rotation', () => {
  assert.match(biweeklyMigration, /ALTER TABLE breakdown_sms_contact_schedules[\s\S]*week_interval/);
  assert.match(biweeklyMigration, /CHECK \(week_interval IN \(1,2\)\)/);
  assert.match(scheduleRuntime, /BreakdownSmsWeekInterval = 1 \| 2/);
  assert.match(scheduleRuntime, /activeThisWeek/);
  assert.match(scheduleRuntime, /breakdownSmsAnchorForCurrentWeek/);
  assert.match(scheduleApi, /weekInterval/);
  assert.match(scheduleApi, /activeThisWeek/);
  assert.match(schedulePage, /Every other week/);
  assert.match(schedulePage, /This week ON, next week OFF/);
  assert.match(schedulePage, /This week OFF, next week ON/);
  assert.match(schedulePage, /flips automatically every Monday/);
});

test('Biweekly evaluator alternates Mondays in Detroit and keeps overnight work in the starting week', () => {
  const firstMonday = new Date('2026-08-31T14:00:00Z');
  assert.equal(currentBreakdownSmsWeekStart(firstMonday, 'America/Detroit'), '2026-08-31');
  assert.equal(breakdownSmsAnchorForCurrentWeek(true, firstMonday, 'America/Detroit'), '2026-08-31');
  assert.equal(breakdownSmsAnchorForCurrentWeek(false, firstMonday, 'America/Detroit'), '2026-09-07');

  const mondayDaytime = {
    enabled: true,
    daysMask: 1 << 1,
    startMinute: 6 * 60,
    endMinute: 18 * 60,
    weekInterval: 2,
    anchorWeekStart: '2026-08-31',
    timezone: 'America/Detroit',
  };
  assert.equal(isBreakdownSmsWeekActive(mondayDaytime, firstMonday), true);
  assert.equal(isBreakdownSmsScheduleAllowed(mondayDaytime, firstMonday), true);
  assert.equal(isBreakdownSmsScheduleAllowed(mondayDaytime, new Date('2026-09-07T14:00:00Z')), false);
  assert.equal(isBreakdownSmsScheduleAllowed(mondayDaytime, new Date('2026-09-14T14:00:00Z')), true);

  const sundayOvernight = {
    enabled: true,
    daysMask: 1 << 0,
    startMinute: 18 * 60,
    endMinute: 6 * 60,
    weekInterval: 2,
    anchorWeekStart: '2026-08-24',
    timezone: 'America/Detroit',
  };
  assert.equal(isBreakdownSmsScheduleAllowed(sundayOvernight, new Date('2026-08-31T05:30:00Z')), true);
  assert.equal(isBreakdownSmsScheduleAllowed(sundayOvernight, new Date('2026-09-07T05:30:00Z')), false);

  const everyWeek = { ...mondayDaytime, weekInterval: 1 };
  assert.equal(isBreakdownSmsScheduleAllowed(everyWeek, new Date('2026-09-07T14:00:00Z')), true);
});

test('Independent windows support weekly office hours plus biweekly overnight on-call', () => {
  const weekdays = [1, 2, 3, 4, 5].reduce((mask, day) => mask | (1 << day), 0);
  const officeHours = {
    enabled: true,
    daysMask: weekdays,
    startMinute: 7 * 60,
    endMinute: 16 * 60,
    weekInterval: 1,
    anchorWeekStart: '',
    timezone: 'America/Detroit',
  };
  const overnightOnCall = {
    enabled: true,
    daysMask: weekdays,
    startMinute: 16 * 60,
    endMinute: 7 * 60,
    weekInterval: 2,
    anchorWeekStart: '2026-08-31',
    timezone: 'America/Detroit',
  };
  const windows = [officeHours, overnightOnCall];
  const allowed = date => windows.some(window => isBreakdownSmsScheduleAllowed(window, date));

  assert.equal(allowed(new Date('2026-08-31T11:30:00Z')), true);
  assert.equal(allowed(new Date('2026-08-31T13:00:00Z')), true);
  assert.equal(allowed(new Date('2026-08-31T22:00:00Z')), true);
  assert.equal(allowed(new Date('2026-09-07T22:00:00Z')), false);
  assert.equal(allowed(new Date('2026-09-14T22:00:00Z')), true);
});
