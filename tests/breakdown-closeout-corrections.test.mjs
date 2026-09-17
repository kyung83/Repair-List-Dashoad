import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('completed breakdown corrections are manager protected and audited', async () => {
  const route = await read('app/api/reports/breakdowns/[id]/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route, /Open breakdowns should be edited from the active Breakdown screen/);
  assert.match(route, /UPDATE repairs[\s\S]*outside_cost=\?/);
  assert.match(route, /UPDATE roadside_breakdowns[\s\S]*service_provider=\?/);
  assert.match(route, /UPDATE roadside_breakdown_receipts/);
  assert.match(route, /breakdown_closeout_corrected/);
  assert.match(route, /INSERT INTO repair_job_events/);
});

test('normal closeout persists invoice and notes even without a receipt', async () => {
  const route = await read('app/api/breakdowns/receipts/route.ts');
  assert.match(route, /closeout_invoice_number=\?/);
  assert.match(route, /closeout_invoice_date=\?/);
  assert.match(route, /closeout_notes=\?/);
  assert.match(route, /service_provider=CASE WHEN \?='' THEN service_provider ELSE \? END/);
});

test('breakdown report exposes an edit action for completed records', async () => {
  const [page, editor] = await Promise.all([
    read('app/reports/breakdowns/page.tsx'),
    read('app/reports/breakdowns/edit-breakdown-button.tsx'),
  ]);
  assert.match(page, /EditBreakdownButton/);
  assert.match(page, /row\.stage >= 5/);
  assert.match(editor, /Edit Breakdown/);
  assert.match(editor, /Final Total Cost/);
  assert.match(editor, /Service Provider/);
  assert.match(editor, /Invoice #/);
  assert.match(editor, /Closeout Notes/);
  assert.match(editor, /method: 'PATCH'/);
});

test('breakdown correction migration stores closeout details on the breakdown', async () => {
  const migration = await read('migrations/0144_breakdown_closeout_corrections.sql');
  assert.match(migration, /closeout_invoice_number/);
  assert.match(migration, /closeout_invoice_date/);
  assert.match(migration, /closeout_notes/);
});
