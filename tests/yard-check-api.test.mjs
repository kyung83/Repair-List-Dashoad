import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../lib/yard-check-api.ts', import.meta.url), 'utf8');
const publicRoute = readFileSync(new URL('../app/api/integrations/yard-check/repair-board/route.ts', import.meta.url), 'utf8');
const adminRoute = readFileSync(new URL('../app/api/admin/yard-check-api/route.ts', import.meta.url), 'utf8');
const scriptRoute = readFileSync(new URL('../app/api/admin/yard-check-api/google-script/route.ts', import.meta.url), 'utf8');
const googleScript = readFileSync(new URL('../lib/yard-check-google-script.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/admin/yard-check-api/page.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/navigation-config.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0135_yard_check_api_keys.sql', import.meta.url), 'utf8');

test('Yard Check API keys are revocable hashes and never stored raw', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS yard_check_api_keys/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /REFERENCES app_users\(id\)/);
  assert.doesNotMatch(migration, /token\s+TEXT/);
  assert.match(service, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(service, /revoked_at IS NULL/);
});

test('external Yard Check endpoint is GET-only and API-key protected', () => {
  assert.match(publicRoute, /export async function GET/);
  assert.doesNotMatch(publicRoute, /export async function POST/);
  assert.match(publicRoute, /authenticateYardCheckApiRequest/);
  assert.match(publicRoute, /Invalid or revoked Yard Check API key/);
  assert.doesNotMatch(publicRoute, /getSessionUser/);
});

test('Yard Check export stays narrow but mirrors Repair Board maintenance and live yards', () => {
  assert.match(service, /getMaintenanceBoardItems/);
  assert.match(service, /syncCustomMaintenanceRepairs/);
  assert.match(service, /geotab_unit_state/);
  assert.match(service, /equipment_geotab_devices/);
  assert.match(service, /DVIR - Needs Repair/);
  assert.match(service, /Custom Maintenance/);
  assert.match(service, /repairTypes/);
  assert.match(service, /workingNow/);
  assert.doesNotMatch(publicRoute, /driver|phone|invoice|parts/i);
});

test('only managers and admins can create or revoke Yard Check keys', () => {
  assert.match(adminRoute, /getSessionUser/);
  assert.match(adminRoute, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(adminRoute, /createKey/);
  assert.match(adminRoute, /revokeKey/);
  assert.match(scriptRoute, /user\.role !== 'manager' && user\.role !== 'admin'/);
});

test('Setup exposes one Yard Check API screen with copy-ready Google Apps Script', () => {
  assert.match(nav, /\/admin\/yard-check-api/);
  assert.match(nav, /Yard Check API/);
  assert.match(page, /Generate Read-Only Key/);
  assert.match(page, /Copy Full Google Apps Script/);
  assert.match(page, /Repair Board Import/);
  assert.match(page, /Yard Check Comparison/);
});

test('Google script protects source tab and supports comparison plus five-minute refresh', () => {
  assert.match(googleScript, /X-Northern-Yard-Key/);
  assert.match(googleScript, /PropertiesService\.getScriptProperties/);
  assert.match(googleScript, /NORTHERN_IMPORT_TAB = 'Repair Board Import'/);
  assert.match(googleScript, /NORTHERN_COMPARE_TAB = 'Yard Check Comparison'/);
  assert.match(googleScript, /refreshNorthernYardCheckComparison/);
  assert.match(googleScript, /everyMinutes\(5\)/);
  assert.match(googleScript, /findUnitColumn_/);
  assert.match(googleScript, /!sourceUnits\[key\]/);
  assert.doesNotMatch(googleScript, /source\.clear|source\.setValues/);
});
