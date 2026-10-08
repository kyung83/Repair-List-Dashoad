import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workOrders = readFileSync(new URL('../lib/work-orders.ts', import.meta.url), 'utf8');

test('Completed Work requires proof of technician work for completed repairs', () => {
  assert.match(workOrders, /lower\(COALESCE\(r\.status,''\)\) NOT LIKE '%complete%'/);
  assert.match(workOrders, /completed_by_tech\.technician_id IS NOT NULL/);
  assert.match(workOrders, /completed_by_tech\.action='completed'/);
  assert.match(workOrders, /FROM repair_labor_entries tech_labor/);
  assert.match(workOrders, /tech_labor\.technician_id IS NOT NULL/);
});

test('driver or Geotab completion alone is not a Completed Work eligibility path', () => {
  assert.doesNotMatch(workOrders, /OR\s+r\.driver\s+IS NOT NULL/);
  assert.doesNotMatch(workOrders, /OR\s+dvir.*repaired/i);
});
