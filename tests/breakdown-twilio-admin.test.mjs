import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
const scheduleApi = readFileSync(new URL('../app/api/admin/twilio/schedule/route.ts', import.meta.url), 'utf8');
const schedulePage = readFileSync(new URL('../app/admin/twilio/schedule/page.tsx', import.meta.url), 'utf8');
const scheduleMigration = readFileSync(new URL('../migrations/0113_breakdown_sms_schedule.sql', import.meta.url), 'utf8');

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

test('Breakdown SMS schedule is admin-managed in Detroit time and gates texts only', () => {
  assert.match(scheduleMigration, /CREATE TABLE IF NOT EXISTS breakdown_sms_schedule/);
  assert.match(scheduleMigration, /America\/Detroit/);
  assert.match(scheduleRuntime, /BREAKDOWN_SMS_TIMEZONE = 'America\/Detroit'/);
  assert.match(scheduleRuntime, /Overnight window/);
  assert.match(scheduleRuntime, /previousDay/);
  assert.match(scheduleApi, /user\.role !== 'admin'/);
  assert.match(scheduleApi, /saveBreakdownSmsSchedule/);
  assert.match(notifications, /breakdownSmsScheduleAllows/);
  assert.match(notifications, /Outside configured breakdown SMS schedule/);
  assert.match(schedulePage, /This schedule controls Twilio SMS only/);
  assert.match(schedulePage, /Breakdown email continues to send immediately/);
  assert.match(schedulePage, /Always On/);
  assert.match(schedulePage, /type="time"/);
  assert.match(navigation, /href: "\/admin\/twilio\/schedule", label: "Text Schedule"/);
});
