import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const board=readFileSync(new URL('../app/repair-board/planning-center.tsx',import.meta.url),'utf8');
const form=readFileSync(new URL('../app/repair-board/add-repair-form.tsx',import.meta.url),'utf8');
const createRoute=readFileSync(new URL('../app/api/repair-types/create-repair/route.ts',import.meta.url),'utf8');
const indirectRoute=readFileSync(new URL('../app/api/shop/indirect-labor/route.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');

test('technicians see Add Repair in the same shared Repair Board view',()=>{
  assert.match(board,/const canCreateRepair=Boolean\(data&&\(data\.canManage\|\|\(data\.user\.role==='mechanic'&&data\.user\.technicianId\)\)\)/);
  assert.match(board,/canCreateRepair&&<button[^>]*>\{add\?'Close Add Repair':'\+ Add Repair'\}/);
  assert.match(board,/allowTechnicianAssignment=\{data\.canManage\}/);
  assert.match(board,/allowNewEquipment=\{data\.canManage\}/);
});

test('technician shared Add Repair uses existing units and cannot create equipment by typo',()=>{
  assert.match(form,/allowNewEquipment\?:boolean/);
  assert.match(form,/No matching active unit\. Ask a manager to add the equipment first/);
  assert.match(createRoute,/if\(mechanic\)throw new Error\('Technicians can add repairs only to an existing active unit\.'/);
});

test('technician Repair Board submissions are forced to their own linked technician record',()=>{
  assert.match(createRoute,/\['mechanic','manager','admin'\]\.includes\(user\.role\)/);
  assert.match(createRoute,/const mechanicTechnician=mechanic\?await linkedTechnician\(user\):null/);
  assert.match(createRoute,/let technician:Technician\|null=mechanicTechnician/);
  assert.match(createRoute,/enforceTechnicianUnitAccess\(user,mechanicTechnician\.id,equipment\)/);
});

test('indirect labor and shared Add Repair are allowed through the mechanic worker gate',()=>{
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS[\s\S]*'\/api\/shop\/indirect-labor'/);
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS[\s\S]*'\/api\/repair-types\/create-repair'/);
  assert.match(indirectRoute,/\['mechanic','manager','admin'\]\.includes\(user\.role\)/);
  assert.match(indirectRoute,/A linked technician account is required to start indirect labor/);
});

test('SHOP NO UNIT from shared Add Repair stays limited to indirect labor for mechanics',()=>{
  assert.match(createRoute,/Technicians can use SHOP \/ NO UNIT only for INDIRECT LABOR-OTHER/);
  assert.match(createRoute,/source=repairType\?\.name==='INDIRECT LABOR-OTHER'\?'indirect-labor':'manual'/);
});
