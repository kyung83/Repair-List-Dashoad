import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration=readFileSync(new URL('../migrations/0150_fleet_truck_assignments.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/truck-assignments/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/truck-assignments/page.tsx',import.meta.url),'utf8');
const nav=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');

test('truck assignment schema separates permanent and current assignments',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fleet_truck_assignments/);
  assert.match(migration,/home_driver TEXT NOT NULL DEFAULT ''/);
  assert.match(migration,/current_driver TEXT NOT NULL DEFAULT ''/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fleet_coverage_swaps/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fleet_assignment_events/);
});

test('migration bootstraps assigned, open and floater trucks without storing fleet data in source',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE app_users(id INTEGER PRIMARY KEY);
    CREATE TABLE equipment(
      id INTEGER PRIMARY KEY,
      unit TEXT NOT NULL UNIQUE,
      equipment_type TEXT,
      active INTEGER DEFAULT 1,
      merged_into_equipment_id INTEGER,
      driver TEXT,
      location TEXT
    );
    INSERT INTO equipment(id,unit,equipment_type,driver,location) VALUES
      (1,'101','truck','Jane Driver','Taylor'),
      (2,'102','truck','OPEN','Clare'),
      (3,'103','truck','Clare Floater','Clare'),
      (4,'T-9','trailer','','Clare');
  `);
  db.exec(migration);
  const rows=db.prepare('SELECT equipment_id,home_driver,current_driver,pool_status FROM fleet_truck_assignments ORDER BY equipment_id').all().map(row=>({...row}));
  assert.deepEqual(rows,[
    {equipment_id:1,home_driver:'Jane Driver',current_driver:'Jane Driver',pool_status:'assigned'},
    {equipment_id:2,home_driver:'',current_driver:'',pool_status:'open'},
    {equipment_id:3,home_driver:'',current_driver:'',pool_status:'spare'},
  ]);
});

test('scheduler reads Repair Board state and blocks premature return',()=>{
  assert.match(api,/FROM repairs r WHERE r\.equipment_id=e\.id AND lower\(COALESCE\(r\.status,''\)\) NOT LIKE '%complete%'/);
  assert.match(api,/COALESCE\(e\.out_of_service,0\)/);
  assert.match(api,/if\(Boolean\(repair\?\.oos\)\|\|Number\(repair\?\.open_repairs\|\|0\)>0\)throw new Error/);
  assert.match(api,/still has open Repair Board work or is out of service/);
});

test('temporary coverage swap preserves permanent home assignment',()=>{
  assert.match(api,/action==='startCoverageSwap'/);
  assert.match(api,/pool_status='service'/);
  assert.match(api,/pool_status='coverage'/);
  assert.match(api,/action==='completeCoverageSwap'/);
  assert.match(api,/returned to \$\{swap\.driver\}/);
  const swapSection=api.split("if(action==='startCoverageSwap')")[1].split("if(action==='completeCoverageSwap')")[0];
  assert.doesNotMatch(swapSection,/home_driver\s*=/);
});

test('only managers and admins can edit permanent assignments',()=>{
  assert.match(api,/function canEditMaster\(user:AppUser\)\{return !user\.dispatchAccess&&\(user\.role==='manager'\|\|user\.role==='admin'\);\}/);
  assert.match(api,/if\(!canEditMaster\(user\)\)throw new Error\('Manager or administrator access is required to change permanent assignments\.'/);
  assert.match(page,/Temporary swaps never change this list/);
});

test('simplified UI keeps board, master and history views',()=>{
  assert.match(page,/Assignment Board/);
  assert.match(page,/Master Assignments/);
  assert.match(page,/Moves & History/);
  assert.match(page,/Start Coverage Swap/);
  assert.match(page,/Open \/ Spare Trucks/);
  assert.match(page,/In Shop \/ Cleaning/);
  assert.match(page,/Ready to Return/);
  assert.match(page,/Open Repair Board/);
});

test('dispatch can use operational scheduler actions but cannot update master',()=>{
  assert.match(nav,/Truck Assignments/);
  assert.match(worker,/'\/truck-assignments'/);
  assert.match(worker,/'\/api\/truck-assignments'/);
  const allow=worker.match(/new Set\(\['setPoolStatus','assignOpenTruck','moveTruck','startCoverageSwap','completeCoverageSwap'\]\)/);
  assert.ok(allow);
  assert.doesNotMatch(allow[0],/updateMaster/);
});
