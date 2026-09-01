import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const resolver = readFileSync(new URL('../lib/breakdown-geotab-snapshot.ts', import.meta.url), 'utf8');
const geotabClient = readFileSync(new URL('../lib/geotab-client.ts', import.meta.url), 'utf8');
const breakdowns = readFileSync(new URL('../lib/roadside-breakdowns.ts', import.meta.url), 'utf8');
const smsMessage = readFileSync(new URL('../lib/breakdown-sms-message.ts', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../lib/notifications.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');
const previewRoute = readFileSync(new URL('../app/api/breakdowns/geotab-preview/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/report-breakdown/page.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0098_breakdown_geotab_snapshots.sql', import.meta.url), 'utf8');
const tireMigration = readFileSync(new URL('../migrations/0099_breakdown_tire_details.sql', import.meta.url), 'utf8');
const sessionMigration = readFileSync(new URL('../migrations/0100_geotab_shared_sessions.sql', import.meta.url), 'utf8');
const recipientMigration = readFileSync(new URL('../migrations/0101_breakdown_email_recipient.sql', import.meta.url), 'utf8');
const threadMigration = readFileSync(new URL('../migrations/0102_breakdown_email_threads.sql', import.meta.url), 'utf8');
const driverPhoneMigration = readFileSync(new URL('../migrations/0115_breakdown_driver_phone.sql', import.meta.url), 'utf8');
const wranglerTemplate = readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');

const SNAPSHOT_COLUMNS = [
  'snapshot_source',
  'geotab_driver_id',
  'driver_observed_at',
  'geotab_device_id',
  'latitude',
  'longitude',
  'gps_observed_at',
  'gps_source',
  'snapshot_captured_at',
];

test('trailer lookup uses Geotab association privately without creating a second affected unit', () => {
  assert.match(resolver, /typeName:\s*['"]TrailerAttachment['"]/);
  assert.match(resolver, /trailerSearch:\s*\{\s*id:\s*trailerId\s*\}/);
  assert.match(resolver, /typeName:\s*['"]DeviceStatusInfo['"]/);
  assert.match(resolver, /GetAddresses/);
  assert.match(resolver, /never written as an affected unit or equipment FK/);
  assert.doesNotMatch(breakdowns, /trailer_equipment_id\s*[,)]/);
  assert.match(breakdowns, /INSERT INTO roadside_breakdowns[\s\S]*repair_id, equipment_id/);
});

test('trailer identity resolution does not use unsupported Trailer name search', () => {
  assert.match(resolver, /typeName:\s*['"]Trailer['"]/);
  assert.match(resolver, /resultsLimit:\s*TRAILER_LIST_LIMIT/);
  assert.match(resolver, /function trailerUnitKey/);
  assert.doesNotMatch(resolver, /typeName:\s*['"]Trailer['"][\s\S]{0,160}search:\s*\{\s*name:/);
  assert.match(resolver, /SET geotab_trailer_id = \?/);
  assert.match(resolver, /exactTrailerId\(client, env\.DB, equipment\)/);
});

test('Geotab preview resolves driver independently from fresh GPS and address', () => {
  assert.match(previewRoute, /resolveBreakdownGeotabPreview/);
  assert.match(previewRoute, /driverAvailable:\s*preview\.driverAvailable/);
  assert.match(previewRoute, /locationAvailable:\s*preview\.locationAvailable/);
  assert.match(previewRoute, /partial:\s*!\(preview\.driverAvailable && preview\.locationAvailable\)/);
  assert.match(resolver, /if \(!driver && !address\) return null/);
  assert.match(resolver, /driverAvailable:\s*Boolean\(driver\)/);
  assert.match(resolver, /locationAvailable:\s*Boolean\(address\)/);
  assert.doesNotMatch(previewRoute, /headers\.get\(['"]origin['"]\)/);
  assert.match(page, /VERIFY DRIVER & LOCATION/);
  assert.match(page, /Geotab found/);
  assert.match(page, /Yes, correct/);
  assert.match(page, /No, correct it/);
});

test('Geotab API session is shared across Cloudflare isolates and refreshed when invalid', () => {
  assert.match(sessionMigration, /CREATE TABLE IF NOT EXISTS geotab_runtime_sessions/);
  assert.match(sessionMigration, /session_ciphertext TEXT NOT NULL/);
  assert.match(geotabClient, /loadSharedAuth/);
  assert.match(geotabClient, /saveSharedAuth/);
  assert.match(geotabClient, /geotab_runtime_sessions/);
  assert.match(geotabClient, /encryptGeotabRuntimeSecret/);
  assert.match(geotabClient, /looksLikeAuthenticationFailure/);
  assert.match(geotabClient, /clearSharedAuth/);
  assert.match(geotabClient, /auth = await freshAuth\(env, login\)/);
});

test('driver sees Geotab preview and can verify or correct it before submit', () => {
  assert.match(previewRoute, /driverName:\s*preview\.driverName/);
  assert.match(previewRoute, /city:\s*preview\.city/);
  assert.match(previewRoute, /state:\s*preview\.state/);
  assert.match(route, /headers\.get\(['"]sec-fetch-site['"]\)/);
  assert.match(route, /fetchSite === ['"]cross-site['"]/);
  assert.match(page, /snapshotVerification/);
  assert.match(breakdowns, /wantsCorrection/);
  assert.match(breakdowns, /geotab-corrected/);
});

test('breakdown create snapshots Geotab evidence and falls back to manual fields only when needed', () => {
  assert.match(breakdowns, /resolveBreakdownGeotabSnapshot/);
  assert.match(breakdowns, /manual-fallback/);
  assert.match(route, /ManualBreakdownSnapshotRequiredError/);
  assert.match(route, /manualFallbackRequired:\s*true/);
  assert.match(route, /status:\s*422/);
  assert.match(page, /manualFallback\s*&&\s*selectedUnit/);
});

test('migration 0098 contains every breakdown Geotab snapshot field', () => {
  for (const column of SNAPSHOT_COLUMNS) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}\\b`));
    assert.match(breakdowns, new RegExp(`\\b${column}\\b`));
  }
});

test('Geotab driver phone is snapshotted without exposing it on the public preview', () => {
  assert.match(resolver, /phoneNumber/);
  assert.match(resolver, /phoneNumberExtension/);
  assert.match(resolver, /driverPhone:\s*driver\.phone/);
  assert.doesNotMatch(previewRoute, /driverPhone|driver_phone/);
  assert.match(driverPhoneMigration, /ADD COLUMN driver_phone TEXT/);
  assert.match(breakdowns, /b\.driver_name, b\.driver_phone/);
  assert.match(breakdowns, /const driverPhone = wantsCorrection[\s\S]{0,160}manualPhone/);
  assert.match(breakdowns, /driverPhone \|\| null/);
});

test('Geotab driver phone is included in the initial breakdown email and SMS', () => {
  assert.match(route, /actual\.driver_phone/);
  assert.match(route, /Driver Phone:/);
  assert.match(breakdowns, /Driver Phone:/);
  assert.match(smsMessage, /b\.driver_phone/);
  assert.match(smsMessage, /driver_phone_line/);
  assert.match(smsMessage, /ensureDriverPhone/);
  assert.match(driverPhoneMigration, /\{\{driver_phone_line\}\}/);
});

test('tire breakdown reporting stores structured positions and tire sizes', () => {
  assert.match(page, /Tire position and size/);
  assert.match(page, /name="tirePosition"/);
  assert.match(page, /tireSize_\$\{position\.code\}/);
  assert.match(page, /A1L/);
  assert.match(page, /A3RO/);
  assert.match(page, /A2RO/);
  assert.match(route, /form\.getAll\(['"]tirePosition['"]\)/);
  assert.match(breakdowns, /normalizeTirePositions/);
  assert.match(breakdowns, /INSERT INTO roadside_breakdown_tires/);
  assert.match(breakdowns, /Tires:\s*\$\{tireDetails/);
  assert.match(tireMigration, /CREATE TABLE IF NOT EXISTS roadside_breakdown_tires/);
  assert.match(tireMigration, /position_code TEXT NOT NULL/);
  assert.match(tireMigration, /tire_size TEXT NOT NULL/);
  assert.match(tireMigration, /UNIQUE \(breakdown_id, position_code\)/);
});

test('breakdown emails go to the roadside mailbox with timestamps and threaded provider ETA replies', () => {
  assert.match(recipientMigration, /breakdown@norloworld\.com/i);
  assert.match(wranglerTemplate, /"send_email"/);
  assert.match(wranglerTemplate, /"name":\s*"BREAKDOWN_EMAIL"/);
  assert.match(notifications, /BREAKDOWN_EMAIL_FROM/);
  assert.match(notifications, /messageId/);
  assert.match(notifications, /'In-Reply-To':\s*rootMessageId/);
  assert.match(notifications, /References:\s*rootMessageId/);
  assert.match(notifications, /roadside_breakdown_email_threads/);
  assert.match(threadMigration, /CREATE TABLE IF NOT EXISTS roadside_breakdown_email_threads/);
  assert.match(threadMigration, /PRIMARY KEY \(breakdown_id, recipient\)/);
  assert.match(breakdowns, /Submitted:/);
  assert.match(breakdowns, /`Breakdown - \$\{driverName\}`/);
  assert.match(breakdowns, /Original Submitted:/);
  assert.match(breakdowns, /notifyBreakdownEmailGroup/);
  assert.match(breakdowns, /\(providerChanged \|\| etaChanged\) && provider && eta/);
});

test('photo uploads occur only after snapshot and tire validation plus breakdown creation', () => {
  const createIndex = route.indexOf('await createBreakdown');
  const uploadIndex = route.indexOf('await env.FILES.put');
  assert.ok(createIndex >= 0 && uploadIndex > createIndex);
});
