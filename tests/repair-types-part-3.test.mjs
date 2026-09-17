import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('My Jobs can start no-unit indirect labor for a linked technician',async()=>{
  const [page,launcher,api]=await Promise.all([
    read('app/shop/page.tsx'),
    read('app/shop/indirect-labor-launcher.tsx'),
    read('app/api/shop/indirect-labor/route.ts'),
  ]);
  assert.match(page,/IndirectLaborLauncher/);
  assert.match(launcher,/START INDIRECT LABOR/);
  for(const preset of ['Shop cleanup','Parts run','Training','Inventory','Meeting','Other'])assert.match(launcher,new RegExp(preset));
  assert.match(launcher,/action:"startUnit"/);
  assert.match(api,/INDIRECT LABOR-OTHER/);
  assert.match(api,/VALUES\(NULL,/);
  assert.match(api,/source.*indirect-labor/s);
  assert.match(api,/repair_type_id/);
});

test('Current Work presents indirect labor as SHOP / NO UNIT without unit-only tools',async()=>{
  const ui=await read('app/shop/current-work-home.tsx');
  assert.match(ui,/SHOP \/ NO UNIT/);
  assert.match(ui,/SHOP LABOR/);
  assert.match(ui,/not to a fleet unit/);
  assert.match(ui,/noUnit\?"DONE":"REPAIRED"/);
  assert.match(ui,/repairMine&&!noUnit&&<TechnicianRepairTools/);
  assert.match(ui,/!noUnit&&<FoundRepairControl/);
  assert.match(ui,/!noUnit&&<nav/);
  assert.match(ui,/CurrentRepairTypeControl/);
});

test('Manager Add Repair keeps a dedicated SHOP / NO UNIT indirect-labor path',async()=>{
  const [form,route]=await Promise.all([
    read('app/repair-board/add-repair-form.tsx'),
    read('app/api/repair-types/create-repair/route.ts'),
  ]);
  assert.match(form,/INDIRECT LABOR/);
  assert.match(form,/SHOP \/ NO UNIT/);
  assert.match(form,/repairTypeId:noUnit\?indirectType\?\.id:null/);
  assert.match(form,/mode:noUnit\?"no-unit"/);
  assert.match(route,/mode==='no-unit'/);
  assert.match(route,/if\(!repairType\)throw new Error\('SHOP \/ NO UNIT requires an indirect-labor work type\.'/);
  assert.match(route,/repairType\.unitRule!=='optional'/);
  assert.match(route,/equipmentId:number\|null=null/);
  assert.match(route,/source=repairType\?\.name==='INDIRECT LABOR-OTHER'\?'indirect-labor':'manual'/);
});

test('Indirect labor uses the standard timer without requiring equipment',async()=>{
  const shop=await read('app/api/shop/route-legacy.ts');
  assert.match(shop,/if \(current\.equipment_id === null\) return null/);
  assert.match(shop,/INSERT INTO repair_labor_timers/);
  assert.match(shop,/INSERT INTO repair_labor_entries/);
  assert.match(shop,/loadRepairUnit/);
});

test('Completed Work and Report Search label indirect labor as SHOP / NO UNIT',async()=>{
  const [workOrders,reports]=await Promise.all([
    read('app/api/work-orders/route.ts'),
    read('app/api/reports/search/route.ts'),
  ]);
  assert.match(workOrders,/INDIRECT LABOR-OTHER/);
  assert.match(workOrders,/SHOP \/ NO UNIT/);
  assert.match(reports,/row\.repairType === 'INDIRECT LABOR-OTHER'/);
  assert.match(reports,/SHOP \/ NO UNIT/);
});
