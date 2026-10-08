import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workOrders = readFileSync(new URL('../lib/work-orders.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/work-orders/page.tsx', import.meta.url), 'utf8');

test('Completed Work never treats the repair driver field as a technician fallback', () => {
  assert.match(workOrders, /assignedTo:row\.technician_name\?\?'',technicianId:row\.technician_id/);
  assert.doesNotMatch(workOrders, /assignedTo:row\.technician_name\?\?row\.driver/);
  assert.match(workOrders, /technicianKey=repair\.technicianId===null\?'unassigned':`technician-\$\{repair\.technicianId\}`/);
});

test('unassigned shop repairs display as Unassigned in open and completed work views', () => {
  assert.match(page, /repair\.assignedTo\|\|"Unassigned"/);
  assert.match(page, /item\.technician\|\|"Unassigned"/);
});
