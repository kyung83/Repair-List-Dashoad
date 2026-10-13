import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration=read('migrations/0152_truck_sale_lifecycle.sql');
const assignmentMigration=read('migrations/0150_fleet_truck_assignments.sql');
const serviceSource=read('lib/truck-sale-lifecycle.ts');
const script=ts.transpileModule(serviceSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {changeTruckSale,assertTruckAvailableForDispatch,truckHeldOffRoad}=await import(
  'data:text/javascript;base64,'+Buffer.from(script).toString('base64')
);

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec("CREATE TABLE app_users(id INTEGER PRIMARY KEY);"+
    "INSERT INTO app_users(id) VALUES(1),(2);"+
    "CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,equipment_type TEXT,"+
    "merged_into_equipment_id INTEGER,archived_at TEXT,archive_reason TEXT,driver TEXT,location TEXT,"+
    "out_of_service INTEGER NOT NULL DEFAULT 0,updated_at TEXT);"+
    "INSERT INTO equipment(id,unit,active,equipment_type,driver,location) VALUES"+
    "(101,'571(DC)',1,'truck','Jane Driver','Clare'),(102,'575(SC)',1,'truck',NULL,'Clare');"+
    "CREATE TABLE equipment_geotab_devices(id INTEGER PRIMARY KEY,equipment_id INTEGER,current INTEGER,ended_at TEXT,last_seen_at TEXT);"+
    "INSERT INTO equipment_geotab_devices(id,equipment_id,current) VALUES(1,101,1),(2,102,1);"+
    "CREATE TABLE repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,status TEXT,source TEXT);"+
    "CREATE TABLE outside_repair_assignments(id INTEGER PRIMARY KEY,repair_id INTEGER,status TEXT);");
  sqlite.exec(assignmentMigration);
  sqlite.exec(migration);
  const db={
    prepare(sql){
      return{
        bind(...args){
          return{
            first:async()=>sqlite.prepare(sql).get(...args)??null,
            all:async()=>({results:sqlite.prepare(sql).all(...args)}),
            run:async()=>{const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};},
            runSync:()=>{const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}};},
          };
        },
      };
    },
    async batch(stmts){
      sqlite.exec('BEGIN');
      try{
        const results=stmts.map(p=>p.runSync());
        sqlite.exec('COMMIT');
        return results;
      }catch(e){sqlite.exec('ROLLBACK');throw e;}
    },
  };
  const user={id:1};
  async function act(action,opts={}){return changeTruckSale(db,user,{equipmentId:101,action,...opts});}
  return {sqlite,db,act,user};
}
const snapshot=db=>{
  const s=db.prepare("SELECT * FROM fleet_truck_sales WHERE equipment_id=101").get();
  const e=db.prepare("SELECT active,driver,archived_at FROM equipment WHERE id=101").get();
  const a=db.prepare("SELECT home_driver,current_driver,pool_status FROM fleet_truck_assignments WHERE equipment_id=101").get();
  const g=db.prepare("SELECT current,ended_at FROM equipment_geotab_devices WHERE equipment_id=101").get();
  return {sale:s?{...s}:null,equipment:{...e},assignment:{...a},tracking:{...g}};
};

test('For Sale is independent of dispatch, driver and live Geotab tracking',async()=>{
  const {sqlite,db,act}=fixture();
  assert.equal((await act('mark_for_sale',{askingPrice:'34000.00',notes:'Listed at auction',expectedVersion:0})).to,'for_sale');
  let s=snapshot(sqlite);
  assert.equal(s.sale.asking_price,34000);
  assert.equal(s.equipment.active,1);
  assert.equal(s.equipment.driver,'Jane Driver');
  assert.equal(s.assignment.home_driver,'Jane Driver');
  assert.equal(s.assignment.current_driver,'Jane Driver');
  assert.equal(s.assignment.pool_status,'assigned');
  assert.equal(s.tracking.current,1);
  await assertTruckAvailableForDispatch(db,101);
  assert.equal((await act('update_listing',{askingPrice:'32500.50',notes:'Price adjusted',expectedVersion:1})).to,'for_sale');
  s=snapshot(sqlite);
  assert.equal(s.sale.version,2);
  assert.equal(s.sale.asking_price,32500.50);
  await assert.rejects(act('update_listing',{askingPrice:'20000',expectedVersion:1}),/changed.*Refresh/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM fleet_truck_sale_events').get().n,2);
  sqlite.close();
});

test('Cancel Sale while still working preserves driver, work and tracking and permits relisting',async()=>{
  const {sqlite,db,act}=fixture();
  await act('mark_for_sale',{askingPrice:'20000'});
  await act('cancel_sale',{expectedVersion:1});
  let s=snapshot(sqlite);
  assert.equal(s.sale.sale_status,'cancelled');
  assert.equal(s.assignment.current_driver,'Jane Driver');
  assert.equal(s.equipment.active,1);
  assert.equal(s.tracking.current,1);
  assert.equal(truckHeldOffRoad(s.sale),false);
  await assertTruckAvailableForDispatch(db,101);
  await act('mark_for_sale',{askingPrice:'19000',expectedVersion:2});
  s=snapshot(sqlite);
  assert.equal(s.sale.sale_status,'for_sale');
  assert.equal(s.sale.asking_price,19000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM fleet_truck_sale_events WHERE action='cancel_sale'").get().n,1);
  sqlite.close();
});

test('Off Road releases both drivers but leaves equipment/Geotab active until Sold',async()=>{
  const {sqlite,db,act}=fixture();
  await act('mark_for_sale',{askingPrice:'21000'});
  await assert.rejects(act('remove_from_road'),/Confirm the truck is parked/);
  sqlite.exec("INSERT INTO fleet_coverage_swaps(driver,home_equipment_id,coverage_equipment_id) VALUES('Jane Driver',101,102)");
  await assert.rejects(act('remove_from_road',{confirmDriverRelease:true}),/active coverage swap/);
  sqlite.exec('DELETE FROM fleet_coverage_swaps');
  await act('remove_from_road',{confirmDriverRelease:true,expectedVersion:1});
  const s=snapshot(sqlite);
  assert.equal(s.sale.sale_status,'off_road');
  assert.ok(s.sale.off_road_at);
  assert.equal(s.assignment.current_driver,'');
  assert.equal(s.assignment.home_driver,'');
  assert.equal(s.assignment.pool_status,'open');
  assert.equal(s.equipment.driver,null);
  assert.equal(s.equipment.active,1);
  assert.equal(s.tracking.current,1);
  await assert.rejects(assertTruckAvailableForDispatch(db,101),/Off Road/);
  assert.throws(()=>sqlite.prepare("UPDATE fleet_truck_assignments SET pool_status='assigned' WHERE equipment_id=101").run(),/Off Road/);
  assert.throws(()=>sqlite.prepare("UPDATE equipment SET driver='Another Driver' WHERE id=101").run(),/Off Road/);
  sqlite.close();
});

test('Cancel Sale from Off Road keeps physical hold until separate safe Return to Road',async()=>{
  const {sqlite,db,act}=fixture();
  await act('mark_for_sale',{});
  await act('remove_from_road',{confirmDriverRelease:true});
  await act('cancel_sale',{expectedVersion:2});
  assert.equal(snapshot(sqlite).sale.sale_status,'cancelled');
  assert.equal(truckHeldOffRoad(snapshot(sqlite).sale),true);
  await assert.rejects(assertTruckAvailableForDispatch(db,101),/Sale was cancelled.*Off Road/);
  assert.throws(()=>sqlite.prepare("UPDATE fleet_truck_assignments SET pool_status='spare' WHERE equipment_id=101").run(),/Off Road/);
  await assert.rejects(act('return_to_road'),/Confirm the truck has been inspected/);
  sqlite.exec("UPDATE equipment SET out_of_service=1 WHERE id=101");
  await assert.rejects(act('return_to_road',{confirmRoadworthy:true}),/Out of Service/);
  sqlite.exec("UPDATE equipment SET out_of_service=0 WHERE id=101");
  sqlite.exec("INSERT INTO repairs(id,equipment_id,status,source) VALUES(1,101,'New','manual')");
  await assert.rejects(act('return_to_road',{confirmRoadworthy:true}),/Active Repairs/);
  sqlite.exec("UPDATE repairs SET status='Completed' WHERE id=1");
  await act('return_to_road',{confirmRoadworthy:true,expectedVersion:3});
  const s=snapshot(sqlite);
  assert.equal(s.sale.sale_status,'cancelled');
  assert.ok(s.sale.returned_to_road_at);
  assert.equal(s.assignment.pool_status,'open');
  assert.equal(s.assignment.current_driver,'');
  assert.equal(s.assignment.home_driver,'');
  assert.equal(s.equipment.active,1);
  assert.equal(s.tracking.current,1);
  await assertTruckAvailableForDispatch(db,101);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM fleet_truck_sale_events WHERE action='return_to_road'").get().n,1);
  sqlite.close();
});

test('Sold archives equipment and ends live tracking, retaining historic repairs, costs and audit',async()=>{
  const {sqlite,db,act}=fixture();
  sqlite.exec("INSERT INTO repairs(id,equipment_id,status,source) VALUES(9,101,'Completed','manual')");
  await act('mark_for_sale',{askingPrice:'16000'});
  await assert.rejects(act('mark_sold',{salePrice:'13000',saleDate:'2026-10-13',confirmSaleFinal:true}),/Remove the truck from the road/);
  await act('remove_from_road',{confirmDriverRelease:true});
  await assert.rejects(act('mark_sold',{salePrice:'-100',saleDate:'2026-10-13',confirmSaleFinal:true}),/Enter dollars|sale price/);
  await assert.rejects(act('mark_sold',{salePrice:'13000',saleDate:'2026-12-01',confirmSaleFinal:true}),/future/);
  await assert.rejects(act('mark_sold',{salePrice:'13000',saleDate:'2026-10-13'}),/Confirm the sale is final/);
  await act('mark_sold',{salePrice:'13000.50',saleDate:'2026-10-13',buyer:'Fleet Buyer',confirmSaleFinal:true,expectedVersion:2});
  const s=snapshot(sqlite);
  assert.equal(s.sale.sale_status,'sold');
  assert.equal(s.sale.sale_price,13000.50);
  assert.equal(s.sale.buyer,'Fleet Buyer');
  assert.equal(s.equipment.active,0);
  assert.ok(s.equipment.archived_at);
  assert.equal(s.tracking.current,0);
  assert.ok(s.tracking.ended_at);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM repairs WHERE equipment_id=101').get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM fleet_truck_sale_events WHERE action='mark_sold'").get().n,1);
  assert.throws(()=>sqlite.prepare("UPDATE equipment SET active=1,archived_at=NULL WHERE id=101").run(),/Sold trucks/);
  await assert.rejects(assertTruckAvailableForDispatch(db,101),/sold/);
  await assert.rejects(act('cancel_sale'),/inactive.*archived/);
  sqlite.close();
});

test('sale migration and app guard preserve permission boundaries and prevent archive bypass',()=>{
  const api=read('app/api/truck-assignments/route.ts');
  const page=read('app/truck-assignments/page.tsx');
  const worker=read('worker/index.ts');
  const equipment=read('lib/equipment-master.ts');
  const bulk=read('lib/equipment-bulk-archive.ts');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fleet_truck_sales/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fleet_truck_sale_events/);
  assert.match(migration,/trg_fleet_sale_block_held_assignment/);
  assert.match(migration,/trg_fleet_sale_block_held_driver/);
  assert.match(migration,/trg_fleet_sale_block_sold_restore/);
  assert.match(api,/if\(!canEditMaster\(user\)\)throw new Error\('Only managers and administrators may change sale status\.'/);
  assert.match(api,/const \[assignments,swaps,events,soldTrucks,saleEvents\]/);
  assert.match(api,/await assertTruckAvailableForDispatch\(env.DB,equipmentId\)/);
  assert.match(api,/equipmentForDispatch\(homeId\)/);
  assert.match(api,/equipmentForDispatch\(coverageId\)/);
  assert.match(page,/Manage Sale/);
  assert.match(page,/Cancel Sale — Keep Truck/);
  assert.match(page,/Cancel Sale — Keep Off Road/);
  assert.match(page,/Return to Road — Mark Open/);
  assert.match(page,/Mark Sold & Archive/);
  assert.match(page,/saleOffRoad/);
  assert.match(page,/!x.saleOffRoad/);
  assert.match(page,/Truck Sales & Retirement History/);
  assert.match(page,/Sale Change History/);
  assert.doesNotMatch(worker,/['"]mark_sold['"]/);
  assert.doesNotMatch(worker,/['"]remove_from_road['"]/);
  assert.match(equipment,/active sale or Off Road hold/);
  assert.match(bulk,/active sale or Off Road hold/);
});
