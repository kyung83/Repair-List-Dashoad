import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('app/shop/page-v2.tsx'),current=read('app/shop/current-work-home.tsx'),pilot=read('app/shop/logan-pilot-add-repair.tsx');

test('pilot is restricted to Logan Rodriguez account and not mechanic role or Clare yard',()=>{
  assert.match(page,/data\?\.user\.id===29&&data\.user\.username==="loganr"&&data\.user\.role==="mechanic"/);
  assert.match(page,/pilot=\{loganPilot\}/);
  assert.match(page,/loganPilot&&<section/);
  assert.doesNotMatch(page,/data\?\.user\.role==="mechanic"&&<LoganPilotAddRepair/);
});
test('Logan keeps each existing workflow while changing only one-screen placement',()=>{
  for(const component of ['RepairTeamPanel','CurrentRepairTypeControl','FoundRepairControl','RepairPhotoControl','TechnicianRepairTools','MaintenanceChecklistPanel','MechanicUnitHistory'])assert.match(current,new RegExp(component));
  assert.match(current,/!pilot&&maintenanceBlock/);
  assert.match(current,/pilot&&maintenanceBlock/);
  assert.match(current,/pilot&&<nav aria-label="Jump to work tools"/);
  assert.match(current,/onRepaired/);
  assert.match(current,/onDoneWorking/);
  assert.match(current,/pilot-add-repair/);
});
test('different-unit add repair uses the existing API/form, allows self-assignment, cannot create units',()=>{
 assert.match(pilot,/RepairBoardAddRepair/);
 assert.match(pilot,/fetch\("\/api\/repair-board"/);
 assert.match(pilot,/allowSelfAssignment allowNewEquipment=\{false\}/);
 assert.match(pilot,/initialEquipmentId=\{null\}/);
 assert.match(pilot,/onSaved=\{onSaved\}/);
 assert.match(read('app/repair-board/add-repair-form.tsx'),/fetch\("\/api\/repair-types\/create-repair"/);
});
