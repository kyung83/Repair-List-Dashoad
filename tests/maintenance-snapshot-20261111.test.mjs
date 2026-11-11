import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

test('Nov 11 maintenance snapshot updates trailer PM/annual and truck annual baselines safely',async()=>{
  const sql=await read('migrations/0166_update_maintenance_snapshot_20261111.sql');
  assert.match(sql,/maintenance-snapshot-2026-11-11/);
  assert.match(sql,/\(4,'208','2026-10-31','2026-10-31'/);
  assert.match(sql,/\(290,'685','2026-11-03'/);
  assert.match(sql,/\(77,'448',NULL,'4\/4\/27','future'\)/);
  assert.match(sql,/\(272,'667',NULL,'EADS','invalid'\)/);
  assert.match(sql,/Future annual date was not applied/);
  assert.match(sql,/Invalid annual date was not applied/);
  assert.match(sql,/COALESCE\(excluded\.service_date,pm_status\.service_date\)/);
  assert.match(sql,/COALESCE\(excluded\.annual_date,pm_status\.annual_date\)/);
  assert.match(sql,/lower\(COALESCE\(e\.equipment_type,''\)\)='trailer'/);
  assert.match(sql,/lower\(COALESCE\(e\.equipment_type,'truck'\)\)<>\'trailer\'/);
});

test('Nov 11 truck PM snapshot preserves history and rejects future/invalid mileage corruption',async()=>{
  const sql=await read('migrations/0167_update_truck_pm_snapshot_20261111.sql');
  assert.match(sql,/truck-pm-snapshot-2026-11-11/);
  assert.match(sql,/pm-sheet-2026-11-11/);
  assert.match(sql,/\(1,'226\(BT\)','40','2026-06-28',369097/);
  assert.match(sql,/\(137,'530\(DC\)','40',NULL,277910,'10\/26\/27'/);
  assert.match(sql,/\(302,'switcher1','40','2026-04-09',NULL/);
  assert.match(sql,/Future PM completion date was not applied/);
  assert.match(sql,/Mileage is not a valid odometer value/);
  assert.match(sql,/NOT EXISTS \([\s\S]*me\.equipment_id=r\.equipment_id[\s\S]*me\.pm_type=s\.pm_type[\s\S]*me\.event_date=s\.event_date/);
  assert.match(sql,/newer app-entered PM can never be rolled backward/);
  assert.match(sql,/COALESCE\(excluded\.last_mileage,pm_status\.last_mileage\)/);
  assert.match(sql,/WHERE 1=1\s*ON CONFLICT\(equipment_id\)/);
});

test('Nov 11 imports resolve only active unique equipment and never reactivate sold units',async()=>{
  const [dates,pm]=await Promise.all([
    read('migrations/0166_update_maintenance_snapshot_20261111.sql'),
    read('migrations/0167_update_truck_pm_snapshot_20261111.sql'),
  ]);
  for(const sql of [dates,pm]){
    assert.match(sql,/e\.active=1/);
    assert.match(sql,/e\.archived_at IS NULL/);
    assert.doesNotMatch(sql,/SET\s+active\s*=\s*1/i);
    assert.doesNotMatch(sql,/UPDATE\s+equipment[\s\S]*archived_at\s*=\s*NULL/i);
  }
});
