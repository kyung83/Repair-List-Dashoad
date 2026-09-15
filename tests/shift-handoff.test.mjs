import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/shop/route-legacy.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/shop/page-v2.tsx',import.meta.url),'utf8');
const currentWork=readFileSync(new URL('../app/shop/current-work-home.tsx',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
const ui=`${page}\n${currentWork}`;

test('technician shift handoff uses the already-authorized doneUnit shop action',()=>{
  assert.match(worker,/['"]doneUnit['"]/);
  assert.match(page,/action:"doneUnit",handoff:true/);
  assert.match(route,/action === 'doneUnit' && body\.handoff === true/);
});

test('done working opens the finish-or-handoff choice instead of ending labor immediately',()=>{
  assert.match(currentWork,/DONE WORKING/);
  assert.match(page,/onDoneWorking=\{\(\)=>setHandoffOpen\(open=>!open\)\}/);
  assert.match(page,/Done working on this unit/);
  assert.match(page,/DONE FOR NOW — KEEP ASSIGNED TO ME/);
  assert.match(page,/OR HAND OFF/);
});

test('shift handoff requires a note and can target another active technician or next shift unassigned',()=>{
  assert.match(page,/HAND OFF TO NEXT SHIFT/);
  assert.match(page,/What is left to do\? \*/);
  assert.match(page,/Leave Unassigned — next shift can pick it up/);
  assert.match(route,/Enter what is left to do before handing this unit off/);
  assert.match(route,/SELECT id,name FROM technicians WHERE id=\? AND active=1/);
  assert.match(route,/Choose a different technician or leave the work unassigned/);
});

test('empty handoff note gives feedback instead of silently disabling the handoff button',()=>{
  assert.doesNotMatch(page,/disabled=\{busy\|\|!handoffNote\.trim\(\)\}/);
  assert.match(page,/Enter what is left to do for the next shift/);
  assert.match(page,/requestAnimationFrame[\s\S]*Shift handoff note/);
});

test('handoff saves labor then changes only ownership of unfinished repairs on that unit',()=>{
  assert.match(route,/stopLaborSession\(user,technician,Number\(timer\.repair_id\),true,`Shift handoff:/);
  assert.match(route,/WHERE equipment_id=\? AND technician_id=\?/);
  assert.match(route,/SET technician_id=\?, driver=\?, updated_at=CURRENT_TIMESTAMP/);
  assert.match(route,/action,detail\)[\s\S]*'shift_handoff'/);
  assert.doesNotMatch(route,/DELETE FROM repair_parts/);
  assert.doesNotMatch(route,/DELETE FROM repair_part_requests/);
});

test('next shift sees a pending handoff until labor starts on that repair',()=>{
  assert.match(route,/e\.action='shift_handoff'/);
  assert.match(route,/later\.action IN \('labor_started','completed'\)/);
  assert.match(route,/handoffNote: pending\?\.detail/);
  assert.match(ui,/SHIFT HANDOFF/);
  assert.match(currentWork,/repair\.handoffNote/);
});

test('handoff explicitly tells users that recorded work stays on the repair',()=>{
  assert.match(page,/all recorded work stayed with the repair/);
});
