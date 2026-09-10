import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('custom PM builder lives in Setup beside PM Schedule Setup', async () => {
  const navigation = await read('app/navigation-config.ts');
  assert.match(navigation, /href:\s*"\/pm-schedules",\s*label:\s*"PM Schedule Setup"/);
  assert.match(navigation, /href:\s*"\/maintenance-programs",\s*label:\s*"Custom PM Builder"/);
});

test('maintenance program schema supports custom items rotations intervals and independent status', async () => {
  const migration = await read('migrations/0129_custom_maintenance_programs.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS maintenance_items/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS maintenance_programs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS maintenance_program_steps/);
  assert.match(migration, /step_type TEXT NOT NULL CHECK \(step_type IN \('rotation', 'interval'\)\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_maintenance_step_status/);
  assert.match(migration, /resets_item_ids_json/);
});

test('custom maintenance builder API is manager restricted', async () => {
  const route = await read('app/api/maintenance-programs/route.ts');
  assert.match(route, /getSessionUser/);
  assert.match(route, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route, /saveMaintenanceItem/);
  assert.match(route, /saveMaintenanceProgram/);
  assert.match(route, /assignMaintenanceProgram/);
});

test('due custom maintenance becomes a distinct normal repair job', async () => {
  const sync = await read('lib/custom-maintenance-repairs.ts');
  assert.match(sync, /source = 'custom-maintenance'/);
  assert.match(sync, /maintenance_source_id/);
  assert.match(sync, /maintenance_program_step_id/);
  assert.match(sync, /WHERE NOT EXISTS/);
  assert.match(sync, /custom-rotation-\$\{row\.equipmentId\}-\$\{row\.programStepId\}/);
  assert.match(sync, /custom-item-\$\{row\.equipmentId\}-\$\{row\.programStepId\}/);
});

test('Repair Board materializes custom due jobs but builder remains separate', async () => {
  const route = await read('app/api/repair-board/route.ts');
  assert.match(route, /syncCustomMaintenanceRepairs\(env\.DB\)/);
  assert.match(route, /getOpenCustomMaintenanceRepairs\(env\.DB\)/);
  assert.match(route, /source:'pm-repair'/);
  assert.doesNotMatch(route, /saveMaintenanceProgram/);
});

test('completing custom jobs advances rotations and resets linked interval counters', async () => {
  const migration = await read('migrations/0131_custom_maintenance_completion.sql');
  assert.match(migration, /CREATE TRIGGER trg_complete_custom_maintenance_repair/);
  assert.match(migration, /NEW\.source = 'custom-maintenance'/);
  assert.match(migration, /rotation_position =/);
  assert.match(migration, /s\.step_type = 'rotation'/);
  assert.match(migration, /s\.step_type = 'interval'/);
  assert.match(migration, /json_each\(COALESCE\(completed_step\.resets_item_ids_json,'\[\]'\)\)/);
  assert.match(migration, /INSERT OR IGNORE INTO custom_maintenance_events/);
});
