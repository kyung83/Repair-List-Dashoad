import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
const repairType=readFileSync(new URL('../app/api/shop/repair-type/route.ts',import.meta.url),'utf8');
const checklist=readFileSync(new URL('../app/api/repair-type-checklist/route.ts',import.meta.url),'utf8');

test('mechanic worker gate allows repair type selection and repair type checklist writes',()=>{
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS[\s\S]*'\/api\/shop\/repair-type'/);
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS[\s\S]*'\/api\/repair-type-checklist'/);
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS\.has\(pathname\)/);
});

test('repair type API still requires the repair to be assigned and WORKING NOW',()=>{
  assert.match(repairType,/Number\(repair\.technician_id \?\? 0\) !== Number\(user\.technicianId\)/);
  assert.match(repairType,/SELECT repair_id,technician_id FROM repair_labor_timers WHERE user_id=\?/);
  assert.match(repairType,/Choose the Repair Type while this repair is WORKING NOW/);
});

test('repair type checklist still limits mechanics to their assigned repair',()=>{
  assert.match(checklist,/user\.role!=='mechanic'/);
  assert.match(checklist,/Number\(repair\.technician_id\?\?0\)!==Number\(user\.technicianId\)/);
  assert.match(checklist,/This repair is not assigned to you/);
});
