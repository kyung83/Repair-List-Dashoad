import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Annual Schedule Setup can release an Annual into the mechanic workflow early', async () => {
  const page = await read('app/annual-schedules/page.tsx');
  assert.match(page, /Create Annual Job Now/);
  assert.match(page, /createAnnualRepairNow/);
  assert.match(page, /Annual Job Open/);
  assert.match(page, /will NOT change the stored last-completed Annual date until the mechanic completes the inspection/);
});

test('early Annual creation makes a real scheduled-annual repair and prevents duplicates', async () => {
  const source = await read('lib/annual-schedules.ts');
  assert.match(source, /export async function createAnnualRepairNow/);
  assert.match(source, /source = 'scheduled-annual'/);
  assert.match(source, /'scheduled-annual'/);
  assert.match(source, /lower\(COALESCE\(status,''\)\) NOT LIKE '%complete%'/);
  assert.match(source, /Annual \/ inspection requested early/);
  assert.match(source, /The stored last-completed Annual date was not changed/);
});

test('Annual API exposes the early repair action only through the manager Annual route', async () => {
  const route = await read('app/api/annual-schedules/route.ts');
  assert.match(route, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route, /action === 'createAnnualRepairNow'/);
  assert.match(route, /createAnnualRepairNow\(env\.DB/);
});

test('completed Annual forms remain tied to scheduled-annual repair jobs', async () => {
  const forms = await read('app/api/annual-inspections/route.ts');
  assert.match(forms, /scheduled-annual/);
  assert.match(forms, /maintenance_checklist_runs/);
});
