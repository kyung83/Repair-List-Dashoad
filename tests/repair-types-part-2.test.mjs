import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('Found Something Else stays fast and defers Repair Type until work begins',async()=>{
  const [ui,api]=await Promise.all([
    read('app/shop/found-repair-control.tsx'),
    read('app/api/shop/found-repair/route.ts'),
  ]);
  assert.doesNotMatch(ui,/Choose repair type/);
  assert.doesNotMatch(ui,/repairTypeId/);
  assert.match(ui,/TIRE POSITION REQUIRED/);
  assert.match(ui,/Repair Type will be selected when that repair is worked/);
  assert.doesNotMatch(api,/requireRepairType/);
  assert.match(api,/repair_type_id, updated_at/);
  assert.match(api,/NULL, CURRENT_TIMESTAMP/);
  assert.match(api,/Repair Type will be selected when the repair is worked/);
});

test('Current Work lets the assigned technician choose Repair Type while WORKING NOW',async()=>{
  const [home,control,api,helpers]=await Promise.all([
    read('app/shop/current-work-home.tsx'),
    read('app/shop/current-repair-type-control.tsx'),
    read('app/api/shop/repair-type/route.ts'),
    read('lib/repair-types.ts'),
  ]);
  assert.match(home,/CurrentRepairTypeControl/);
  assert.match(control,/Choose Repair Type/);
  assert.match(control,/\/api\/shop\/repair-type/);
  assert.match(control,/DONE WORKING/);
  assert.match(control,/repair-type-changed/);
  assert.match(api,/requireWorkingNow/);
  assert.match(api,/repair_type_selected/);
  assert.match(api,/This Repair Type cannot be changed after its checklist has been started/);
  assert.match(helpers,/Choose the Repair Type before leaving this work/);
  assert.match(helpers,/maintenanceWorkTypeForRepair/);
});

test('Current Work runs categorized check sheets and refreshes them after type selection',async()=>{
  const [panel,wrapper,api,shop,helpers]=await Promise.all([
    read('app/shop/repair-type-checklist-panel.tsx'),
    read('app/shop/maintenance-checklist-panel-v3.tsx'),
    read('app/api/repair-type-checklist/route.ts'),
    read('app/api/shop/route.ts'),
    read('lib/repair-types.ts'),
  ]);
  assert.match(wrapper,/RepairTypeChecklistPanel/);
  assert.match(panel,/repair-type-changed/);
  assert.match(panel,/START CHECKLIST/);
  assert.match(panel,/PASS/);
  assert.match(panel,/FAIL/);
  assert.match(panel,/N\/A/);
  assert.match(panel,/PHOTO/);
  assert.match(api,/created_from_repair_type_checklist/);
  assert.match(shop,/validateRepairTypeChecklistBeforeClose/);
  assert.match(shop,/completeRepairTypeChecklist/);
  assert.match(helpers,/Finish every .* checklist item/);
  assert.match(helpers,/Correct all failed/);
});

test('Failed checklist corrective work keeps the parent repair type',async()=>{
  const migration=await read('migrations/0145_repair_type_corrective_category.sql');
  assert.match(migration,/repair_type_checklist_corrective_category/);
  assert.match(migration,/NEW\.corrective_repair_id/);
  assert.match(migration,/run\.repair_type_id/);
  assert.match(migration,/UPDATE repairs/);
});

test('Completed Work Review shows repair types',async()=>{
  const [api,page]=await Promise.all([
    read('app/api/work-orders/route.ts'),
    read('app/work-orders/page.tsx'),
  ]);
  assert.match(api,/repairTypeMap/);
  assert.match(api,/const repairType=types\.get/);
  assert.match(api,/repairs:workOrder\.repairs\.map|repairs:mapped/);
  assert.match(page,/Repair Types/);
  assert.match(page,/repair\.repairType/);
  assert.match(page,/Uncategorized/);
});

test('Report Search filters current repairs and parts by Repair Type',async()=>{
  const [route,lib,page]=await Promise.all([
    read('app/api/reports/search/route.ts'),
    read('lib/report-search.ts'),
    read('app/reports/search/page.tsx'),
  ]);
  assert.match(route,/repairType: params\.get\('repairType'\)/);
  assert.match(lib,/repairType\?: unknown/);
  assert.match(lib,/LEFT JOIN repair_types rt ON rt\.id=r\.repair_type_id/);
  assert.match(lib,/input\.repairType/);
  assert.match(lib,/repairType: row\.repair_type/);
  assert.match(lib,/repairTypes,/);
  assert.match(page,/title="Repair type"/);
  assert.match(page,/Repair Type/);
  assert.match(page,/row\.repairType/);
});
