import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('repair type migration seeds the approved categories and no-unit indirect labor',async()=>{
 const migration=await read('migrations/0144_repair_types_and_general_checklists.sql');
 for(const name of ['EMISSIONS-SCR-DPF-DEF','AIR INTAKE-EXHAUST-EGR','NEW EQUIPMENT CHECK','LOOK OVER','INDIRECT LABOR-OTHER'])assert.match(migration,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(migration,/INDIRECT LABOR-OTHER','optional','none'/);
 assert.match(migration,/NEW EQUIPMENT CHECK','required','required'/);
 assert.match(migration,/LOOK OVER','required','optional'/);
 assert.match(migration,/ALTER TABLE repairs ADD COLUMN repair_type_id/);
});

test('repair type setup is editable and has versioned checklists',async()=>{
 const [api,page,nav]=await Promise.all([read('app/api/repair-types/route.ts'),read('app/repair-types/page.tsx'),read('app/navigation-config.ts')]);
 for(const action of ['create','update','publishChecklist'])assert.match(api,new RegExp(`action===['\"]${action}`));
 assert.match(page,/ADD REPAIR TYPE/);assert.match(page,/PUBLISH CHECKLIST VERSION/);assert.match(page,/Require photo/);assert.match(page,/Measurement/);
 assert.match(nav,/href: "\/repair-types", label: "Repair Types"/);
});

test('manager add repair requires category and supports shop no unit when allowed',async()=>{
 const [form,route]=await Promise.all([read('app/repair-board/add-repair-form.tsx'),read('app/api/repair-types/create-repair/route.ts')]);
 assert.match(form,/Repair Type/);assert.match(form,/SHOP \/ NO UNIT/);assert.match(form,/\/api\/repair-types\/create-repair/);
 assert.match(route,/requireRepairType/);assert.match(route,/mode==='no-unit'/);assert.match(route,/repairType\.unitRule!=='optional'/);assert.match(route,/repair_type_id/);
});

test('mechanics categorize found work and generic checklists block premature close',async()=>{
 const [found,foundApi,checklist,shopRoute]=await Promise.all([read('app/shop/found-repair-control.tsx'),read('app/api/shop/found-repair/route.ts'),read('app/api/repair-type-checklist/route.ts'),read('app/api/shop/route.ts')]);
 assert.match(found,/Choose repair type/);assert.match(foundApi,/requireRepairType/);assert.match(foundApi,/repair_type_id/);
 assert.match(checklist,/startChecklist/);assert.match(checklist,/result==='fail'/);assert.match(checklist,/repair-type-checklist/);assert.match(checklist,/uploadPhoto/);
 assert.match(shopRoute,/validateRepairTypeChecklistBeforeClose/);assert.match(shopRoute,/completeRepairTypeChecklist/);
});

test('new equipment and look over checklists appear in technician current work',async()=>{
 const panel=await read('app/shop/maintenance-checklist-panel-v3.tsx');
 const generic=await read('app/shop/repair-type-checklist-panel.tsx');
 assert.match(panel,/RepairTypeChecklistPanel/);assert.match(generic,/CHECKLIST/);assert.match(generic,/PASS/);assert.match(generic,/FAIL/);assert.match(generic,/N\/A/);
});

test('indirect labor is launched from My Jobs without a fleet unit',async()=>{
 const [page,launcher,route]=await Promise.all([read('app/shop/page.tsx'),read('app/shop/indirect-labor-launcher.tsx'),read('app/api/shop/indirect-labor/route.ts')]);
 assert.match(page,/IndirectLaborLauncher/);assert.match(launcher,/START INDIRECT LABOR/);assert.match(launcher,/Shop cleanup/);assert.match(launcher,/Parts run/);assert.match(launcher,/Training/);assert.match(launcher,/Inventory/);
 assert.match(route,/equipment_id,title/);assert.match(route,/VALUES\(NULL/);assert.match(route,/repair_type_id/);assert.match(route,/INDIRECT LABOR-OTHER/);
});
