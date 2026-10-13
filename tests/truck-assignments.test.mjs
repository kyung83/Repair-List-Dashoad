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
  assert.match(api,/must be marked Ready to Return, or have completed Repair Board work from this swap/);
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
  assert.match(page,/Service \/ Cleaning \/ OOS/);
  assert.match(page,/Ready to Return/);
  assert.match(page,/Mark \{s\.homeUnit\} Ready to Return/);
  assert.match(page,/Open Repair Board/);
});

test('dispatch can use operational scheduler actions but cannot update master',()=>{
  assert.match(nav,/Truck Assignments/);
  assert.match(worker,/'\/truck-assignments'/);
  assert.match(worker,/'\/api\/truck-assignments'/);
  const allow=worker.match(/new Set\(\['setPoolStatus','assignOpenTruck','moveTruck','startCoverageSwap','markCoverageReady','completeCoverageSwap','changeCurrentDriver','markTruckOpen'\]\)/);
  assert.ok(allow);
  assert.doesNotMatch(allow[0],/updateMaster/);
});


test('Manage opens driver editor and allows marking occupied trucks Open',()=>{
  assert.match(page,/onClick=\{e=>\{e.stopPropagation\(\);openManage\(row\);\}\}>Manage/);
  assert.match(page,/role="dialog" aria-modal="true"/);
  assert.match(page,/Change Current Driver/);
  assert.match(page,/Save Current Driver/);
  assert.match(page,/Edit Permanent Driver/);
  assert.match(page,/Release Current Driver Only/);
  assert.match(page,/Remove Driver Permanently & Mark Open/);
  assert.match(page,/if\(!selected\.currentDriver&&!selected\.homeDriver\)/);
  assert.match(page,/else openManage\(selected\)/);
  assert.match(page,/window\.confirm\(explanation\)/);
  assert.match(page,/if\(ok\)setManagedId\(null\)/);
});

test('quit driver can be removed permanently without leaving a stale current driver',()=>{
  const release=api.split("if(action==='markTruckOpen')")[1].split("if(action==='changeCurrentDriver')")[0];
  assert.ok(release);
  assert.match(release,/clearPermanent&&!canEditMaster\(user\)/);
  assert.match(release,/home_driver=CASE WHEN \?=1 THEN '' ELSE home_driver END/);
  assert.match(release,/current_driver='',pool_status='open'/);
  assert.match(release,/UPDATE equipment SET driver=NULL/);
  assert.match(release,/WHERE closed_at IS NULL AND \(home_equipment_id=\? OR coverage_equipment_id=\?\)/);
  assert.match(release,/permanent_driver_removed/);
  assert.match(release,/truck_marked_open/);
});

test('dispatch can change the current driver but not the permanent assignment',()=>{
  const driver=api.split("if(action==='changeCurrentDriver')")[1].split("if(action==='setPoolStatus')")[0];
  assert.ok(driver);
  assert.match(driver,/current_driver=\?,current_location=\?,pool_status='assigned'/);
  assert.doesNotMatch(driver,/SET home_driver=/);
  assert.doesNotMatch(driver,/UPDATE equipment SET driver=/);
  assert.match(driver,/still has open Repair Board work/);
  assert.match(driver,/out of service and cannot be assigned/);
  assert.match(driver,/active coverage swap/);
  assert.match(driver,/already listed on truck/);
  assert.match(driver,/current_driver_changed/);
  assert.match(worker,/changeCurrentDriver/);
  assert.match(worker,/markTruckOpen/);
});

test('mark Open releases an assigned truck, protects permanent home unless requested and blocks swaps',()=>{
  const match=api.match(/const result=await env\.DB\.prepare\(\x60(UPDATE fleet_truck_assignments[\s\S]*?)\x60\)\s*\.bind\(clearPermanent\?1:0/);
  assert.ok(match,'release UPDATE must exist in API');
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE fleet_truck_assignments(equipment_id INTEGER PRIMARY KEY,home_driver TEXT NOT NULL,current_driver TEXT NOT NULL,current_location TEXT NOT NULL,pool_status TEXT NOT NULL,coverage_for_equipment_id INTEGER,coverage_for_driver TEXT,updated_by_user_id INTEGER,updated_at TEXT);"
    +"CREATE TABLE fleet_coverage_swaps(id INTEGER PRIMARY KEY,home_equipment_id INTEGER,coverage_equipment_id INTEGER,closed_at TEXT);"
    +"INSERT INTO fleet_truck_assignments VALUES (101,'Quit Driver','Quit Driver','Clare','assigned',NULL,'',NULL,NULL);"
    +"INSERT INTO fleet_truck_assignments VALUES (102,'Temp Driver','Temp Driver','Clare','assigned',NULL,'',NULL,NULL);"
    +"INSERT INTO fleet_truck_assignments VALUES (103,'Swap Driver','Swap Driver','Clare','coverage',NULL,'',NULL,NULL);"
    +"INSERT INTO fleet_coverage_swaps VALUES(7,103,999,NULL);");
  const stmt=db.prepare(match[1]);
  const permanent=stmt.run(1,7,101,'Quit Driver','Quit Driver',101,101);
  assert.equal(permanent.changes,1);
  assert.deepEqual({...db.prepare('SELECT home_driver,current_driver,pool_status FROM fleet_truck_assignments WHERE equipment_id=101').get()},
    {home_driver:'',current_driver:'',pool_status:'open'});
  const temporary=stmt.run(0,7,102,'Temp Driver','Temp Driver',102,102);
  assert.equal(temporary.changes,1);
  assert.deepEqual({...db.prepare('SELECT home_driver,current_driver,pool_status FROM fleet_truck_assignments WHERE equipment_id=102').get()},
    {home_driver:'Temp Driver',current_driver:'',pool_status:'open'});
  const blocked=stmt.run(1,7,103,'Swap Driver','Swap Driver',103,103);
  assert.equal(blocked.changes,0);
  db.close();
});


test('one open repair is not treated as physical in-shop status',()=>{
  const match=page.match(/function niceStatus\(row:Assignment\)\{([\s\S]*?)\n\}/);
  assert.ok(match,'truck status display helper must exist');
  const niceStatus=new Function('row',match[1]);
  const truck={
    homeDriver:'Jim Phillips',currentDriver:'Jim Phillips',status:'assigned',
    outOfService:false,openRepairCount:1,readyToReturn:false,
  };
  assert.equal(niceStatus(truck),'Assigned','571 with one open job is not necessarily in shop');
  assert.equal(niceStatus({...truck,homeDriver:'Rob Bates'}),'Swapped');
  assert.equal(niceStatus({...truck,openRepairCount:0,status:'service',readyToReturn:true}),'Ready to Return');
  assert.equal(niceStatus({...truck,status:'service'}),'At Service');
  assert.equal(niceStatus({...truck,outOfService:true}),'Out of Service');
  assert.equal(niceStatus({...truck,status:'coverage'}),'Coverage Swap');
  assert.match(page,/row\.openRepairCount>0\?<span title="Open repair work does not mean/);
  assert.match(page,/Service \/ Cleaning \/ OOS/);
  assert.doesNotMatch(page,/rows\.filter\(x=>x\.outOfService\|\|x\.openRepairCount>0\|\|x\.status==="service"/);
});

test('In Service counter and filter rely on actual service assignment state',()=>{
  assert.match(api,/service:rows\.filter\(x=>x\.status==='service'\)\.length/);
  assert.doesNotMatch(api,/service:rows\.filter\(x=>x\.status==='service'\|\|x\.repairState==='in_shop'\)/);
  assert.match(api,/repairState:row\.pool_status==='service'\?'in_service'/);
  assert.match(api,/Number\(row\.open_repairs\|\|0\)>0\?'open_repair'/);
  assert.match(page,/filter==="In Service"&&row\.status!=="service"/);
  assert.match(page,/filter==="Out of Service"&&!row\.outOfService/);
  assert.match(page,/selected\.outOfService\|\|selected\.openRepairCount>0/);
  assert.match(page,/x\.outOfService\|\|x\.status==="service"\|\|x\.status==="cleaning"/);
  assert.match(page,/x\.openRepairCount===0/);
});
