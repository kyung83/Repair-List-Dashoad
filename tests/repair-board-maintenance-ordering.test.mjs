import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const maintenanceBoard=readFileSync(new URL('../lib/maintenance-board.ts',import.meta.url),'utf8');
const customRepairs=readFileSync(new URL('../lib/custom-maintenance-repairs.ts',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/repair-board/route.ts',import.meta.url),'utf8');
const planning=readFileSync(new URL('../app/repair-board/planning-center.tsx',import.meta.url),'utf8');

test('standard mileage PMs show remaining or overdue miles instead of only the target odometer',()=>{
  assert.match(maintenanceBoard,/milesRemaining <= 0[\s\S]*miles overdue[\s\S]*due in .* miles/);
  assert.doesNotMatch(maintenanceBoard,/dueBits\.push\(`\$\{mileageDue\.toLocaleString\(\)\} mi`\)/);
});

test('raw PM and annual due descriptions are not collapsed to generic labels',()=>{
  assert.doesNotMatch(route,/issue:\s*'PM'/);
  assert.doesNotMatch(route,/issue:\s*'Annual'/);
});

test('maintenance rows carry a normalized due sort value',()=>{
  assert.match(maintenanceBoard,/dueSort/);
  assert.match(customRepairs,/dueSort/);
});

test('Planning Center sorts truck and trailer maintenance by most overdue first',()=>{
  assert.match(planning,/sortMaintenanceGroups/);
  assert.match(planning,/pms:sortMaintenanceGroups/);
  assert.match(planning,/trailerServices:sortMaintenanceGroups/);
});
