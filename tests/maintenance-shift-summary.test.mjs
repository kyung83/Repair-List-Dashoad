import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../migrations/0137_maintenance_shifts.sql',import.meta.url),'utf8');
const usersApi=readFileSync(new URL('../app/api/admin/users/route.ts',import.meta.url),'utf8');
const shiftsApi=readFileSync(new URL('../app/api/admin/maintenance-shifts/route.ts',import.meta.url),'utf8');
const usersPage=readFileSync(new URL('../app/admin/users/page.tsx',import.meta.url),'utf8');
const summary=readFileSync(new URL('../lib/maintenance-shift-summary.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
const wrangler=readFileSync(new URL('../wrangler.template.jsonc',import.meta.url),'utf8');

test('maintenance shifts have one user assignment and an idempotent send ledger',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_shifts/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_shift_assignments/);
  assert.match(migration,/user_id INTEGER PRIMARY KEY/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_shift_summary_runs/);
  assert.match(migration,/UNIQUE \(shift_id, shift_work_date\)/);
  assert.match(migration,/REFERENCES app_users\(id\) ON DELETE CASCADE/);
});

test('only technicians and managers receive shift assignments from Users setup',()=>{
  assert.match(usersApi,/return role === 'mechanic' \|\| role === 'manager'/);
  assert.match(usersApi,/DELETE FROM maintenance_shift_assignments WHERE user_id=\?/);
  assert.match(usersApi,/INSERT INTO maintenance_shift_assignments\(user_id,shift_id\)/);
  assert.match(usersPage,/function canHaveShift\(role:Role\)\{return role==='mechanic'\|\|role==='manager';\}/);
  assert.match(usersPage,/TECHNICIANS \+ MANAGERS/);
});

test('admins can define shifts and the recipient is fixed to Maintenance',()=>{
  assert.match(shiftsApi,/Administrator access is required/);
  assert.match(shiftsApi,/Maintenance@norloworld\.com/);
  assert.match(usersPage,/Maintenance@norloworld\.com/);
  assert.match(usersPage,/type="time"/);
  assert.match(usersPage,/WORKDAYS/);
});

test('summary scheduler uses Detroit time and fires 30 minutes after shift end',()=>{
  assert.match(summary,/America\/Detroit/);
  assert.match(summary,/MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES = 30/);
  assert.match(summary,/const due = new Date\(end\.getTime\(\)\+CLOSEOUT_MS\)/);
  assert.match(worker,/controller\.cron === '\*\/5 \* \* \* \*'/);
  assert.match(worker,/processDueMaintenanceShiftSummaries/);
  assert.match(wrangler,/"\*\/5 \* \* \* \*"/);
});

test('shift email includes labor, repairs, parts, waiting, completed and handoffs',()=>{
  assert.match(summary,/repair_labor_entries/);
  assert.match(summary,/inventory_operations/);
  assert.match(summary,/line_type='part_issue'/);
  assert.match(summary,/completed/);
  assert.match(summary,/waiting_on_part/);
  assert.match(summary,/shift_handoff/);
  assert.match(summary,/Still clocked in/);
  assert.match(summary,/No recorded repair activity during this shift/);
  assert.match(summary,/sendGmailRuntimeEmail/);
  assert.match(summary,/to:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT/);
});

test('dispatch and admins are excluded from emailed shift membership',()=>{
  assert.match(summary,/COALESCE\(u\.dispatch_access,0\)=0/);
  assert.match(summary,/u\.role IN \('mechanic','manager'\)/);
});
