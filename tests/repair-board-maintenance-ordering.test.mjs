import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const maintenanceBoard=readFileSync(new URL('../lib/maintenance-board.ts',import.meta.url),'utf8');
const customRepairs=readFileSync(new URL('../lib/custom-maintenance-repairs.ts',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/repair-board/route.ts',import.meta.url),'utf8');

test('standard mileage PMs show remaining or overdue miles instead of only the target odometer',()=>{
  assert.match(maintenanceBoard,/milesRemaining <= 0[\s\S]*miles overdue[\s\S]*due in .* miles/);
  assert.doesNotMatch(maintenanceBoard,/dueBits\.push\(`\$\{mileageDue\.toLocaleString\(\)\} mi`\)/);
});

test('raw PM and annual due descriptions are not collapsed to generic labels',()=>{
  assert.doesNotMatch(route,/issue:\s*'PM'/);
  assert.doesNotMatch(route,/issue:\s*'Annual'/);
});

test('custom PM rows keep current mileage or time due wording',()=>{
  assert.match(customRepairs,/boardIssue/);
  assert.match(customRepairs,/miles overdue/);
  assert.match(customRepairs,/due in .* miles/);
  assert.match(customRepairs,/days overdue/);
  assert.match(customRepairs,/due in .* days/);
});

test('Repair Board orders all maintenance slots by urgency before Planning Center splits truck and trailer panels',()=>{
  assert.match(route,/function maintenanceUrgency/);
  assert.match(route,/function orderMaintenanceRows/);
  assert.match(route,/filter\(\(repair\) => maintenanceSource\(repair\.source\)\)/);
  assert.match(route,/maintenanceUrgency\(a\) - maintenanceUrgency\(b\)/);
  assert.match(route,/payload\.repairs = repairs/);
});
