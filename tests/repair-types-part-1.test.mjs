import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

const categories=[
 'EMISSIONS-SCR-DPF-DEF',
 'AIR INTAKE-EXHAUST-EGR',
 'ENGINE',
 'COOLING SYSTEM',
 'AIR (BRAKE) SYSTEM-VALVES',
 'CHARGING-STARTING SYSTEMS',
 'TIRES-RIMS',
 'TRANSMISSION-CLUTCH',
 'BRAKES-ABS',
 'FUEL',
 'DRIVELINE-DIFFERENTIAL',
 'HVAC',
 'SUSPENSION-STEERING-ALIGNMENT',
 'GPS-CAMERA-ACCESSORY-SAFETY',
 '5TH WHEEL',
 'TRUCK AND TRAILER BODY',
 'WHEEL END',
 'LIGHTS & ELECTRICAL',
 'NEW EQUIPMENT CHECK',
 'LOOK OVER',
 'INDIRECT LABOR-OTHER',
];

test('Part 1 seeds the approved repair types in order',async()=>{
 const migration=await read('migrations/0144_repair_types_and_general_checklists.sql');
 let previous=-1;
 for(const name of categories){
  const index=migration.indexOf(`'${name}'`);
  assert.ok(index>previous,`${name} should be present in the requested order`);
  previous=index;
 }
 assert.match(migration,/NEW EQUIPMENT CHECK','required','required'/);
 assert.match(migration,/LOOK OVER','required','optional'/);
 assert.match(migration,/INDIRECT LABOR-OTHER','optional','none'/);
 assert.match(migration,/ALTER TABLE repairs ADD COLUMN repair_type_id/);
});

test('New Equipment Check and Look Over are separate editable categories',async()=>{
 const [api,page,nav]=await Promise.all([
  read('app/api/repair-types/route.ts'),
  read('app/repair-types/page.tsx'),
  read('app/navigation-config.ts'),
 ]);
 for(const action of ['create','update','publishChecklist'])assert.match(api,new RegExp(`action===['\"]${action}`));
 assert.match(page,/ADD REPAIR TYPE/);
 assert.match(page,/PUBLISH CHECKLIST VERSION/);
 assert.match(page,/Require photo/);
 assert.match(page,/Measurement/);
 assert.match(nav,/href: "\/repair-types", label: "Repair Types"/);
});

test('Repair Board Add Repair saves a repair type while Part 3 indirect labor remains isolated',async()=>{
 const [form,route]=await Promise.all([
  read('app/repair-board/add-repair-form.tsx'),
  read('app/api/repair-types/create-repair/route.ts'),
 ]);
 assert.match(form,/Repair Type/);
 assert.match(form,/Choose repair type/);
 assert.match(form,/\/api\/repair-types\/create-repair/);
 assert.match(form,/INDIRECT LABOR-OTHER/);
 assert.match(route,/requireRepairType/);
 assert.match(route,/repair_type_id/);
 assert.match(route,/being enabled in Part 3/);
 assert.doesNotMatch(form,/SHOP \/ NO UNIT/);
});
