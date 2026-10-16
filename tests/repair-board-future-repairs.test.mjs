import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { REPAIR_BOARD_FUTURE_REPAIRS_SQL } from '../lib/repair-board-future-repairs-sql.js';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('app/api/repair-board/route.ts');
const center=read('app/repair-board/planning-center.tsx');
const css=read('app/repair-board/planning-center.module.css');

function sample(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT);"+
   "CREATE TABLE repairs(id INTEGER PRIMARY KEY,status TEXT);"+
   "CREATE TABLE pm_next_repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,repair_id INTEGER,description TEXT,target_event_type TEXT,status TEXT,target_repair_id INTEGER,tagged_at TEXT);"+
   "CREATE TABLE repair_planned_parts(id INTEGER PRIMARY KEY,repair_id INTEGER,removed_at TEXT);"+
   "INSERT INTO equipment VALUES (516,'516(SC)'),(519,'519(SC)'),(520,'520(SC)');"+
   "INSERT INTO repairs VALUES (101,'Deferred to Next PM'),(102,'Deferred to Next PM'),(103,'Deferred to Next PM'),"+
   "(104,'In Progress'),(105,'Completed'),(106,'Deferred to Next PM'),(107,'Deferred to Next Annual'),"+
   "(108,'Deferred to Next PM');"+
   "INSERT INTO pm_next_repairs VALUES"+
   "(1,516,101,'front cover leak','pm','pending',NULL,'2026-10-10 12:00:00'),"+
   "(2,516,102,'brakes at 30%','pm','pending',NULL,'2026-10-11 12:00:00'),"+
   "(3,516,103,'checking','pm','pending',NULL,'2026-10-12 12:00:00'),"+
   "(4,516,104,'already attached to PM','pm','attached',902,'2026-10-07 12:00:00'),"+
   "(5,516,105,'completed repair','pm','completed',902,'2026-10-06 12:00:00'),"+
   "(6,516,106,'cancelled repair','pm','cancelled',NULL,'2026-10-05 12:00:00'),"+
   "(7,519,107,'waiting for annual','annual','pending',NULL,'2026-10-13 12:00:00'),"+
   "(8,516,108,'inconsistent attached target','pm','pending',902,'2026-10-09 12:00:00');"+
   "INSERT INTO repair_planned_parts VALUES(1,101,NULL),(2,101,NULL),(3,101,'2026-10-14 00:00:00');");
 return db;
}

test('Unit 516 shows exactly its three future repairs and existing planned part totals',()=>{
 const db=sample();
 const all=db.prepare(REPAIR_BOARD_FUTURE_REPAIRS_SQL).all();
 const pending516=all.filter(x=>x.equipment_id===516);
 assert.equal(pending516.length,3);
 assert.deepEqual(pending516.map(x=>x.description),['front cover leak','brakes at 30%','checking']);
 assert.deepEqual(pending516.map(x=>x.target_event_type),['pm','pm','pm']);
 assert.equal(pending516[0].planned_part_count,2);
 assert.equal(all.length,4);
 assert.equal(all.find(x=>x.equipment_id===519)?.target_event_type,'annual');
 db.close();
});

test('attached, cancelled, completed and already targeted work is never shown as queued again',()=>{
 const db=sample();
 const pending=db.prepare(REPAIR_BOARD_FUTURE_REPAIRS_SQL).all();
 for(const id of [4,5,6,8])assert.ok(!pending.some(x=>x.id===id),'action '+id+' must not be pending');
 assert.match(REPAIR_BOARD_FUTURE_REPAIRS_SQL,/n.status='pending'/);
 assert.match(REPAIR_BOARD_FUTURE_REPAIRS_SQL,/n.target_repair_id IS NULL/);
 assert.match(REPAIR_BOARD_FUTURE_REPAIRS_SQL,/rpp.removed_at IS NULL/);
 db.close();
});

test('the Repair Board API returns queued items separately from active jobs without inflating Repair Board counts',()=>{
 assert.match(api,/import \{ REPAIR_BOARD_FUTURE_REPAIRS_SQL \}/);
 assert.match(api,/const pendingFutureRepairs = await env.DB.prepare\(REPAIR_BOARD_FUTURE_REPAIRS_SQL\)/);
 assert.match(api,/payload.futureRepairs = pendingFutureRepairs.results.map/);
 assert.match(api,/equipmentId:row.equipment_id/);
 assert.match(api,/repairId:\`repair-\$\{row.repair_id\}\`/);
 assert.match(api,/\.filter\(\(repair\) => !deferred\(repair.status\) && !outsideRepair\(repair.status\)\)/);
 assert.match(api,/total: repairs.length/);
 assert.match(api,/maintenanceDue: repairs.filter/);
 const inserted=api.indexOf('payload.futureRepairs =');
 const summary=api.indexOf('payload.summary =');
 assert.ok(inserted>=0&&summary>inserted);
});

test('clicking a due PM displays its queued Future Repairs within the unit detail panel',()=>{
 assert.match(center,/type FutureRepair=/);
 assert.match(center,/futureByEquipment=useMemo/);
 assert.match(center,/byEquipment\.get\(item\.equipmentId\)/);
 assert.match(center,/const detailFuture=detail\?\.equipmentId\?futureByEquipment\.get\(detail.equipmentId\)/);
 assert.match(center,/Future Repairs <span/);
 assert.match(center,/detailFuture\.length/);
 assert.match(center,/item\.description/);
  assert.match(center,/NEXT SHOP VISIT/);
  assert.match(center,/Originally tagged Next/);
 assert.match(center,/plannedPartCount/);
 assert.match(center,/href="\/next-pm-repairs"/);
 assert.match(center,/No future repairs currently waiting for this unit/);
 assert.match(center,/futureCount>0/);
 assert.match(center,/FUTURE REPAIR/);
 assert.match(css,/\.futureSection/);
 assert.match(css,/\.futureCount/);
});

test('future repairs are searchable on Repair Board without becoming active assignment or bulk-action rows',()=>{
 assert.match(center,/const futureWords=queued\.map/);
 assert.match(center,/futureWords\]\.join\(' '\)/);
 assert.match(center,/const allRows=data\?\.repairs\|\|\[\]/);
 assert.match(center,/const selectedRows=useMemo\(\(\)=>allRows\.filter/);
 assert.doesNotMatch(center,/const allRows=\[\.\.\.\(data\?\.repairs/);
 assert.doesNotMatch(REPAIR_BOARD_FUTURE_REPAIRS_SQL,/UPDATE |DELETE FROM |INSERT INTO /i);
});
