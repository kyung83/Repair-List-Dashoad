import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/shop/route-legacy.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/shop/page.tsx',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');

test('technician shift handoff uses the already-authorized doneUnit shop action',()=>{
  assert.match(worker,/['"]doneUnit['"]/);
  assert.match(page,/action:"doneUnit",handoff:true/);
  assert.match(route,/action === 'doneUnit' && body\.handoff === true/);
});

test('done working now opens the finish-or-handoff choice instead of ending labor immediately',()=>{
  assert.match(page,/DONE WORKING ON UNIT/);
  assert.match(page,/onClick=\{\(\)=>setHandoffOpen\(open=>!open\)\}/);
  assert.match(page,/Done for now or hand off to the next shift\?/);
  assert.match(page,/DONE FOR NOW — KEEP ASSIGNED TO ME/);
  assert.match(page,/OR HAND OFF TO NEXT SHIFT/);
});

test('shift handoff requires a note and can target another active technician or next shift unassigned',()=>{
  assert.match(page,/HAND OFF TO NEXT SHIFT/);
  assert.match(page,/What is left to do\? \*/);
  assert.match(page,/Leave Unassigned — next shift can pick it up/);
  assert.match(route,/Enter what is left to do before handing this unit off/);
  assert.match(route,/SELECT id,name FROM technicians WHERE id=\? AND active=1/);
  assert.match(route,/Choose a different technician or leave the work unassigned/);
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
  assert.match(page,/SHIFT HANDOFF/);
  assert.match(page,/selected\.handoffNote/);
});

test('handoff explicitly tells users that recorded work stays on the repair',()=>{
  assert.match(page,/Nothing already recorded on the repair is lost/);
  assert.match(page,/all parts\/work stayed with the repair/);
});
