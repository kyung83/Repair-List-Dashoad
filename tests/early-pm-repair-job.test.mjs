import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PM Schedule Setup can release the current PM step early', async () => {
  const page = await read('app/pm-schedules/page.tsx');
  assert.match(page, /Create PM Job Now/);
  assert.match(page, /createPmRepairNow/);
  assert.match(page, /openPmRepairId/);
  assert.match(page, /PM Job Open/);
  assert.match(page, /customRotationItem/);
  assert.match(page, /does NOT change the PM mileage\/date baseline or advance the rotation until the mechanic completes the PM/);
});

test('early PM API creates a real scheduled PM repair and blocks duplicates', async () => {
  const route = await read('app/api/maintenance-setup/route.ts');
  assert.match(route, /createPmRepairNow/);
  assert.match(route, /getSessionUser/);
  assert.match(route, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route, /source = 'scheduled-pm'/);
  assert.match(route, /'scheduled-pm'/);
  assert.match(route, /maintenance_source_id/);
  assert.match(route, /maintenance_program_step_id/);
  assert.match(route, /custom-rotation-\$\{equipmentId\}-\$\{step\.step_id\}/);
  assert.match(route, /WHERE NOT EXISTS/);
  assert.match(route, /early_pm_created/);
});

test('custom rotational PMs use scheduled PM checklist workflow when they become due normally', async () => {
  const sync = await read('lib/custom-maintenance-repairs.ts');
  assert.match(sync, /function repairSource/);
  assert.match(sync, /row\.kind === 'rotation' \? 'scheduled-pm' : 'custom-maintenance'/);
  assert.match(sync, /mechanic PM checklist required/);
  assert.match(sync, /source IN \('custom-maintenance', 'scheduled-pm'\)/);
});
