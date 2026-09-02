import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('default breakdown setup separates Brake Chambers from Air Issues',async()=>{
  const migration=await read('migrations/0124_breakdown_category_setup.sql');
  assert.match(migration,/\('Brake Chambers',1,0,1,10\)/);
  assert.match(migration,/\('Air Issues',0,0,1,20\)/);
  assert.match(migration,/SELECT id,'Air Leak',1,10/);
  assert.match(migration,/SELECT id,'Gladhand \/ Air Line',1,20/);
  assert.match(migration,/\('AIR\/CHAMBERS\/GLADHANDS',0,0,0,999\)/);
  assert.match(migration,/repair_subcategory TEXT/);
  assert.match(migration,/position_codes TEXT/);
});

test('driver breakdown form loads configured categories and requires chamber position',async()=>{
  const page=await read('app/report-breakdown/page.tsx');
  assert.match(page,/fetch\('\/api\/breakdown-categories'/);
  assert.match(page,/name="repairSubcategory"/);
  assert.match(page,/name="positionCode"/);
  assert.match(page,/TRUCK_POSITION_AXLES/);
  assert.match(page,/TRAILER_POSITION_AXLES/);
  assert.match(page,/selectedCategory\?\.requiresPosition/);
  assert.match(page,/selectedCategory\.requiresTireSize/);
  assert.doesNotMatch(page,/const REPAIR_CATEGORIES/);
  assert.doesNotMatch(page,/'AIR\/CHAMBERS\/GLADHANDS'/);
});

test('public breakdown POST validates configured category, subcategory, and positions server side',async()=>{
  const route=await read('app/api/breakdowns/route.ts');
  assert.match(route,/validateBreakdownCategorySelection\(env\.DB, submittedCategory, submittedSubcategory\)/);
  assert.match(route,/normalizeBreakdownPositions/);
  assert.match(route,/form\.getAll\('positionCode'\)/);
  assert.match(route,/SET repair_subcategory=\?, position_codes=\?/);
  assert.match(route,/repairSubcategory/);
  assert.match(route,/positionCodes\.join/);
});

test('manager setup page can add, edit, order and deactivate categories and subcategories',async()=>{
  const [page,route]=await Promise.all([
    read('app/breakdowns/setup/page.tsx'),
    read('app/api/breakdown-categories/route.ts'),
  ]);
  assert.match(page,/Breakdown Setup/);
  assert.match(page,/\+ Add Category/);
  assert.match(page,/\+ Add Subcategory/);
  assert.match(page,/Require axle\/side position/);
  assert.match(page,/Active on driver screen/);
  assert.match(route,/action === 'add-category'/);
  assert.match(route,/action === 'add-subcategory'/);
  assert.match(route,/action === 'update-category'/);
  assert.match(route,/action === 'update-subcategory'/);
  assert.match(route,/requireManager/);
});

test('office breakdown dashboard preserves driver report and stores a separate office diagnosis',async()=>{
  const [page,repairTypeRoute]=await Promise.all([
    read('app/breakdowns/page.tsx'),
    read('app/api/breakdowns/[id]/repair-type/route.ts'),
  ]);
  assert.match(page,/Driver Report — Read Only/);
  assert.match(page,/Our Repair Category/);
  assert.match(page,/Our Notes/);
  assert.match(page,/Fuel Issue/);
  assert.match(page,/row\.repair_needed/);
  assert.match(page,/selected\.repair_category/);
  assert.match(page,/selected\.description/);
  assert.match(repairTypeRoute,/SELECT b\.repair_needed, r\.description AS diagnostic_notes/);
  assert.match(repairTypeRoute,/SET repair_needed = \?/);
  assert.match(repairTypeRoute,/UPDATE repairs[\s\S]*SET title = \?, description = \?/);
  assert.doesNotMatch(repairTypeRoute,/SET repair_category = \?/);
  assert.doesNotMatch(repairTypeRoute,/SET repair_category = \?, repair_subcategory/);
});
