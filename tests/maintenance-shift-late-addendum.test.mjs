import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('lib/maintenance-shift-summary.ts');

test('normal 30-minute summary remains and a separate 120-minute later addendum is scheduled',()=>{
 assert.match(source,/MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES = 30/);
 assert.match(source,/MAINTENANCE_SHIFT_LATE_ADDENDUM_MINUTES = 120/);
 assert.match(source,/new Date\(window\.due\.getTime\(\)\+LATE_ADDENDUM_MS\)/);
 assert.match(source,/sendLateShiftAddendum\(db,shift,window\.workDate,window\.due,addendumDue\)/);
});
test('late summary requires original sent and one-time deduplication',()=>{
 assert.match(source,/original\?\.status!=='sent'/);
 assert.match(source,/old\?\.status==='sent'\|\|old\?\.status==='skipped'/);
 assert.match(source,/maintenance_shift_late_addendum_runs/);
 assert.match(source,/const hasLateWork=lateActivities\.length>0/);
 assert.match(source,/status='skipped'/);
 assert.match(source,/renderSummary\(shift,workDate,originalDue,addendumDue,addendumDue,lateActivities,true\)/);
 assert.match(source,/Late Work Addendum/);
 assert.match(read('migrations/0171_maintenance_shift_late_addendum.sql'),/UNIQUE \(shift_id,shift_work_date\)/);
});
test('technician notes are preserved beside worked jobs, including completed jobs',()=>{
 assert.match(source,/\['technician_note','shift_handoff'\]\.includes\(event\.action\)/);
 assert.match(source,/job\.notes\.add\(event\.detail\.trim\(\)\)/);
 assert.match(source,/part_requested_awaiting/);
 assert.match(source,/repair_labor_entries/);
 assert.match(source,/inventory_operations/);
});
