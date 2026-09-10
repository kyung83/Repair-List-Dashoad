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

test('custom maintenance materializer separates rotational PM workflow from standalone maintenance', async () => {
  const sync = await read('lib/custom-maintenance-repairs.ts');
  assert.match(sync, /row\.kind === 'rotation' \? 'scheduled-pm' : 'custom-maintenance'/);
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
  assert.match(route, /source:\s*'pm-repair'/);
  assert.doesNotMatch(route, /saveMaintenanceProgram/);
});

test('standalone custom jobs still reset linked interval counters', async () => {
  const migration = await read('migrations/0131_custom_maintenance_completion.sql');
  assert.match(migration, /CREATE TRIGGER trg_complete_custom_maintenance_repair/);
  assert.match(migration, /NEW\.source = 'custom-maintenance'/);
  assert.match(migration, /s\.step_type = 'interval'/);
  assert.match(migration, /json_each\(COALESCE\(completed_step\.resets_item_ids_json,'\[\]'\)\)/);
  assert.match(migration, /INSERT OR IGNORE INTO custom_maintenance_events/);
});

test('rotational custom PM completion uses the real PM checklist and advances only its custom rotation', async () => {
  const migration = await read('migrations/0132_custom_rotational_pm_checklist.sql');
  assert.match(migration, /NEW\.source = 'scheduled-pm'/);
  assert.match(migration, /NEW\.maintenance_program_step_id IS NULL/);
  assert.match(migration, /CREATE TRIGGER trg_advance_custom_rotation_after_checklist_work_order/);
  assert.match(migration, /NEW\.maintenance_program_step_id IS NOT NULL/);
  assert.match(migration, /c\.mileage_at_completion/);
  assert.match(migration, /rotation_position =/);
  assert.match(migration, /INSERT OR IGNORE INTO custom_maintenance_events/);
  assert.match(migration, /checklist-custom-wo-/);
});
