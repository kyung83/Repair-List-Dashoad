import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const page=read('app/shop/page-v2.tsx'),current=read('app/shop/current-work-home.tsx'),pilot=read('app/shop/logan-pilot-add-repair.tsx');

test('shared My Work layout is enabled for all linked mechanic accounts, not office-only managers or viewers',()=>{
  assert.match(page,/const technicianWorkspace=Boolean\(data\?\.user\.technicianId\)&&\(data\.user\.role==="mechanic"\|\|data\.user\.role==="manager"\)/);
  assert.match(page,/pilot=\{technicianWorkspace\}/);
  assert.match(page,/technicianWorkspace&&<section/);
  assert.match(page,/if\(technicianWorkspace&&completedOpen\)/);
  assert.doesNotMatch(page,/user\.id===29|username==="loganr"|loganPilot/);
});
test('all technicians retain original workflows and the streamlined repair actions',()=>{
  for(const component of ['RepairTeamPanel','CurrentRepairTypeControl','FoundRepairControl','RepairPhotoControl','TechnicianRepairTools','MaintenanceChecklistPanel','MechanicUnitHistory'])assert.match(current,new RegExp(component));
  assert.match(current,/!pilot&&maintenanceBlock/);
  assert.match(current,/id="pilot-panel-checklist"/);
  assert.match(current,/maintenanceBlock\?\?/);
  assert.match(current,/role="tablist"/);
  assert.match(current,/setPilotTool\(tool\)/);
  assert.match(current,/hidden=\{pilotTool!=="checklist"\}/);
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
