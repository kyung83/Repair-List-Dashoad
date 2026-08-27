import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const resolver = readFileSync(new URL('../lib/breakdown-geotab-snapshot.ts', import.meta.url), 'utf8');
const breakdowns = readFileSync(new URL('../lib/roadside-breakdowns.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/report-breakdown/page.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0098_breakdown_geotab_snapshots.sql', import.meta.url), 'utf8');

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

test('breakdown create snapshots Geotab evidence and falls back to manual fields only when needed', () => {
  assert.match(breakdowns, /resolveBreakdownGeotabSnapshot/);
  assert.match(breakdowns, /snapshotSource = geotabSnapshot \? ['"]geotab['"] : ['"]manual-fallback['"]/);
  assert.match(route, /ManualBreakdownSnapshotRequiredError/);
  assert.match(route, /manualFallbackRequired:\s*true/);
  assert.match(route, /status:\s*422/);
  assert.match(page, /manualFallback &&/);
  assert.match(page, /Driver and location will be captured from Geotab/);
  assert.doesNotMatch(page, /name="driverName" required[\s\S]{0,200}manualFallback \?/);
});

test('migration 0098 contains every breakdown Geotab snapshot field', () => {
  for (const column of SNAPSHOT_COLUMNS) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}\\b`));
    assert.match(breakdowns, new RegExp(`\\b${column}\\b`));
  }
});

test('photo uploads occur only after snapshot validation and breakdown creation', () => {
  const createIndex = route.indexOf('await createBreakdown');
  const uploadIndex = route.indexOf('await env.FILES.put');
  assert.ok(createIndex >= 0 && uploadIndex > createIndex);
});
