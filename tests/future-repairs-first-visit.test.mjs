import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const legacyPull=file('migrations/0049_pull_future_repairs_on_active_visit.sql');
const existingGuards=file('migrations/0044_pm_annual_action_repairs.sql');
const newMigration=file('migrations/0153_future_repairs_first_shop_visit.sql');
const board=file('app/repair-board/planning-center.tsx');
const boardApi=file('app/api/repair-board/route.ts');
const futureQuery=file('lib/repair-board-future-repairs-sql.js');

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON;"+
    "CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT);"+
    "CREATE TABLE technicians(id INTEGER PRIMARY KEY,name TEXT);"+
    "CREATE TABLE repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,title TEXT,status TEXT NOT NULL,source TEXT NOT NULL,"+
      "technician_id INTEGER,completed_at TEXT,updated_at TEXT,opened_at TEXT);"+
    "CREATE TABLE maintenance_checklist_runs(id INTEGER PRIMARY KEY,repair_id INTEGER,status TEXT);"+
    "CREATE TABLE repair_labor_timers(id INTEGER PRIMARY KEY,repair_id INTEGER,technician_id INTEGER);"+
    "CREATE TABLE pm_next_repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,repair_id INTEGER,description TEXT,status TEXT NOT NULL,"+
      "target_event_type TEXT NOT NULL DEFAULT 'pm',target_repair_id INTEGER,attached_at TEXT,updated_at TEXT,"+
      "queued_from_repair_id INTEGER,defer_count INTEGER NOT NULL DEFAULT 0,completed_at TEXT);"+
    "INSERT INTO equipment VALUES(516,'516(SC)'),(519,'519(SC)'),(575,'575(SC)');"+
    "INSERT INTO technicians VALUES(7,'Technician A'),(8,'Technician B');");
  // The last section of migration 0044 defines completion, re-defer and
  // PM/Annual closing guards. Test them unchanged, not with mocked behavior.
  db.exec(existingGuards.slice(existingGuards.indexOf('-- Completing the real repair completes')));
  // Legacy repair/PM/Annual first-visit triggers in production.
  db.exec(legacyPull);
  // New DVIR triggers and safety requeue behavior.
  db.exec(newMigration);
  const addRepair=db.prepare(
    "INSERT INTO repairs(id,equipment_id,title,status,source,technician_id,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)"
  );
  const addFuture=db.prepare(
    "INSERT INTO pm_next_repairs(id,equipment_id,repair_id,description,status,target_event_type,updated_at) "+
    "VALUES(?,?,?,?,'pending',?,CURRENT_TIMESTAMP)"
  );
  function queue(id,equipmentId,issue,kind='pm'){
    addRepair.run(1000+id,equipmentId,issue,kind==='annual'?'Deferred to Next Annual':'Deferred to Next PM','maintenance-action',null);
    addFuture.run(id,equipmentId,1000+id,issue,kind);
  }
  const row=(id)=>db.prepare('SELECT * FROM pm_next_repairs WHERE id=?').get(id);
  const child=(id)=>db.prepare('SELECT * FROM repairs WHERE id=?').get(1000+id);
  const open=(id,equipmentId,source,tech=null,status='New')=>addRepair.run(id,equipmentId,'Shop repair',status,source,tech);
  return {db,queue,row,child,open};
}

test('raw DVIR defect and PM/Annual due-only board entry keep work pending and visible; no premature activation',()=>{
  const {db,queue,row,child}=fixture();
  queue(1,516,'front cover leak');
  queue(2,516,'brakes at 30%');
  queue(3,516,'checking','annual');
  for(const id of [1,2,3]){
    assert.equal(row(id).status,'pending');
    assert.equal(row(id).target_repair_id,null);
    assert.match(child(id).status,/Deferred to Next/);
  }
  assert.match(board,/detailFuture=detail\?\.equipmentId/);
  assert.match(board,/NEXT SHOP VISIT/);
  assert.match(board,/Due-only PMs and Annuals do not activate repairs until the shop work order is opened/);
  assert.match(board,/futureCount>0&&<small/);
  assert.doesNotMatch(board,/maintenanceRow&&futureCount/);
  assert.match(boardApi,/payload\.futureRepairs = pendingFutureRepairs\.results\.map/);
  assert.match(futureQuery,/n.status='pending'/);
  db.close();
});

test('converting 516 DVIR to an assigned shop work order pulls ALL three Future Repairs on first actual visit',()=>{
  const {db,queue,row,child,open}=fixture();
  queue(1,516,'front cover leak');
  queue(2,516,'brakes at 30%');
  queue(3,516,'checking','annual');
  open(50,516,'geotab-dvir',7,'Assigned');
  for(const id of [1,2,3]){
    assert.equal(row(id).status,'attached');
    assert.equal(row(id).target_repair_id,50);
    assert.equal(child(id).technician_id,7);
    assert.equal(child(id).status,'Assigned');
  }
  assert.equal(row(3).target_event_type,'annual','original target is preserved but Annual work moves with DVIR');
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM pm_next_repairs WHERE equipment_id=516").get().total,3);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM pm_next_repairs WHERE status='pending' AND equipment_id=516").get().total,0);
  db.close();
});

test('a legacy unassigned DVIR can claim queued work on first technician assignment, without arbitrary data-migration reparenting',()=>{
  const {db,queue,row,child,open}=fixture();
  open(50,516,'geotab-dvir');
  queue(1,516,'front cover leak');
  assert.equal(row(1).status,'pending');
  db.prepare("UPDATE repairs SET technician_id=7,status='Assigned' WHERE id=50").run();
  assert.equal(row(1).status,'attached');
  assert.equal(row(1).target_repair_id,50);
  assert.equal(child(1).status,'Assigned');
  assert.equal(child(1).technician_id,7);
  queue(2,516,'brakes at 30%');
  db.prepare("UPDATE repairs SET technician_id=8 WHERE id=50").run();
  assert.equal(row(2).status,'pending','reassigning the existing DVIR must not claim newly deferred work');
  db.close();
});

test('normal repair created before the next PM still pulls Future Repairs via the existing trigger',()=>{
  const {db,queue,row,child,open}=fixture();
  queue(1,516,'front cover leak','annual');
  open(51,516,'manual',null,'New');
  assert.equal(row(1).target_repair_id,51);
  assert.equal(row(1).status,'attached');
  assert.equal(child(1).status,'New');
  assert.equal(child(1).technician_id,null);
  db.close();
});

test('a scheduled PM or Annual first activates both Next PM and Next Annual without duplicate queue entries',()=>{
  for(const source of ['scheduled-pm','scheduled-annual']){
    const {db,queue,row,child,open}=fixture();
    queue(1,516,'front cover leak','pm');
    queue(2,516,'Annual checking','annual');
    open(52,516,source,8,'Assigned');
    for(const id of [1,2]){
      assert.equal(row(id).target_repair_id,52,source);
      assert.equal(row(id).status,'attached',source);
      assert.equal(child(id).status,'Assigned',source);
      assert.equal(child(id).technician_id,8,source);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pm_next_repairs').get().n,2);
    db.close();
  }
});

test('DVIR created while a scheduled PM or Annual work order is already active does not steal its future work',()=>{
  const {db,queue,row,open}=fixture();
  open(30,516,'scheduled-pm',8,'Assigned');
  queue(1,516,'intentionally deferred during this visit');
  open(32,516,'geotab-dvir',7,'Assigned');
  assert.equal(row(1).status,'pending');
  assert.equal(row(1).target_repair_id,null);
  db.close();
});

test('closing a normal repair without completing attached Future Repairs safely requeues for the NEXT visit',()=>{
  const {db,queue,row,child,open}=fixture();
  queue(1,516,'front cover leak','pm');
  queue(2,516,'checking','annual');
  open(70,516,'manual',7,'Assigned');
  assert.equal(row(1).status,'attached');
  db.prepare("UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP WHERE id=70").run();
  for(const id of [1,2]){
    assert.equal(row(id).status,'pending');
    assert.equal(row(id).target_repair_id,null);
    assert.equal(row(id).queued_from_repair_id,70);
    assert.equal(row(id).defer_count,1);
    assert.equal(child(id).status,id===2?'Deferred to Next Annual':'Deferred to Next PM');
    assert.equal(child(id).technician_id,null);
  }
  open(71,516,'scheduled-annual',8,'Assigned');
  for(const id of [1,2]){
    assert.equal(row(id).target_repair_id,71,'same saved queue item becomes active at the later visit');
    assert.equal(child(id).technician_id,8);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pm_next_repairs WHERE equipment_id=516").get().n,2);
  db.close();
});

test('when the DVIR visit closes, unfinished future work is requeued but completed future work stays completed',()=>{
  const {db,queue,row,child,open}=fixture();
  queue(1,516,'brakes at 30%','pm');
  queue(2,516,'checking','annual');
  open(80,516,'geotab-dvir',7,'Assigned');
  db.prepare("UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP WHERE id=1001").run();
  assert.equal(row(1).status,'completed','existing completion trigger should mark actual child complete');
  db.prepare("UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP WHERE id=80").run();
  assert.equal(row(1).status,'completed');
  assert.equal(row(2).status,'pending');
  assert.equal(child(2).status,'Deferred to Next Annual');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pm_next_repairs WHERE equipment_id=516").get().n,2);
  db.close();
});

test('open labor timer on an attached future repair blocks closing its parent visit without partial changes',()=>{
  const {db,queue,row,child,open}=fixture();
  queue(1,516,'front cover leak');
  open(80,516,'geotab-dvir',7,'Assigned');
  db.prepare('INSERT INTO repair_labor_timers(id,repair_id,technician_id) VALUES(1,1001,7)').run();
  assert.throws(()=>db.prepare("UPDATE repairs SET status='Completed' WHERE id=80").run(),/Stop labor on attached Future Repairs/);
  assert.equal(row(1).status,'attached');
  assert.equal(child(1).status,'Assigned');
  db.prepare('DELETE FROM repair_labor_timers WHERE id=1').run();
  db.prepare("UPDATE repairs SET status='Completed' WHERE id=80").run();
  assert.equal(row(1).status,'pending');
  db.close();
});

test('the PM and Annual work order completion guards are preserved, not replaced by normal repair requeueing',()=>{
  const {db,queue,row,open}=fixture();
  queue(1,516,'brakes at 30%');
  open(50,516,'scheduled-pm',7,'Assigned');
  assert.throws(()=>db.prepare("UPDATE repairs SET status='Completed' WHERE id=50").run(),/Complete all repairs attached/);
  assert.equal(row(1).status,'attached');
  db.close();
});

test('manual requeue of unfinished attached work is still prohibited; only completed normal visits release their future work',()=>{
  const {db,queue,row,open}=fixture();
  queue(1,516,'checking');
  open(60,516,'manual',7,'Assigned');
  assert.throws(()=>db.prepare("UPDATE pm_next_repairs SET status='pending',target_repair_id=NULL WHERE id=1").run(),/cannot be manually removed/);
  assert.equal(row(1).status,'attached');
  db.close();
});

test('roadside-only breakdown insert never promotes the queued future repairs',()=>{
  const {db,queue,row,open}=fixture();
  queue(1,516,'front cover leak');
  open(40,516,'roadside-breakdown',7,'Assigned');
  assert.equal(row(1).status,'pending');
  db.close();
});

test('repair-board keeps planned work visible for DVIR/repair/PM/Annual without counting it as active work',()=>{
  assert.match(board,/const futureByEquipment=useMemo/);
  assert.match(board,/const detailFuture=detail\?\.equipmentId/);
  assert.match(board,/futureCount>0&&<small className=\{s.futureCount\}/);
  assert.match(board,/Future Repairs <span/);
  assert.match(board,/item\.description/);
  assert.match(board,/NEXT SHOP VISIT/);
  assert.match(board,/item\.targetEventType==='annual'/);
  assert.match(boardApi,/\.filter\(\(repair\) => !deferred\(repair\.status\) && !outsideRepair\(repair\.status\)\)/);
  assert.match(boardApi,/total: repairs\.length/);
  assert.match(boardApi,/payload.futureRepairs =/);
  const sources=[
    file('app/api/repair-board/original.ts'),
    file('app/api/repair-board/self-assign.ts'),
    file('app/api/repair-board/bulk-assign/route.ts'),
  ].join('\n');
  assert.match(sources,/source\s*=\s*maintenance\.kind\s*===\s*'pm'\s*\?\s*'scheduled-pm'/);
  assert.match(sources,/geotab-dvir/);
  assert.match(newMigration,/NEW\.source IN \('geotab-dvir', 'dvir-repair'\)/);
  assert.doesNotMatch(newMigration,/AFTER INSERT ON dvir_defects/);
});
