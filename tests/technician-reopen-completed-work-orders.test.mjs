import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const route=read('app/api/shop/reopen-completed/route.ts');
const listing=read('app/api/shop/labor-review/route.ts');
const completed=read('app/shop/technician-completed-work.tsx');
const shop=read('app/shop/page-v2.tsx');
const worker=read('worker/index.ts');
const sourceClauses=route.match(/const eligibleRepair=\[([\s\S]*?)\]\.join\(' AND '\);/)?.[1];
assert.ok(sourceClauses,'Reopen route must declare a centralized eligibility predicate');
const eligibleRepair=runInNewContext('['+sourceClauses+']').join(' AND ');

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE repairs(id INTEGER PRIMARY KEY,status TEXT,source TEXT,technician_id INTEGER,completed_at TEXT,updated_at TEXT,reviewed_at TEXT,go_live_archived_at TEXT,maintenance_checklist_item_id INTEGER,maintenance_source_id TEXT);"+
    "CREATE TABLE repair_labor_timers(user_id INTEGER,repair_id INTEGER);"+
    "CREATE TABLE invoices(id INTEGER PRIMARY KEY,repair_id INTEGER);"+
    "CREATE TABLE invoice_repair_links(invoice_id INTEGER,repair_id INTEGER);"+
    "CREATE TABLE pm_next_repairs(id INTEGER PRIMARY KEY,repair_id INTEGER,target_repair_id INTEGER);"+
    "CREATE TABLE repair_job_events(id INTEGER PRIMARY KEY,repair_id INTEGER,user_id INTEGER,technician_id INTEGER,action TEXT,detail TEXT);"+
    "CREATE TABLE repair_labor_entries(id INTEGER PRIMARY KEY,repair_id INTEGER,hours REAL);"+
    "CREATE TABLE repair_parts(id INTEGER PRIMARY KEY,repair_id INTEGER,part_id INTEGER,quantity REAL);"+
    "INSERT INTO repairs(id,status,source,technician_id,completed_at) VALUES"+
    "(1,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(2,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(3,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(4,'Completed','geotab-dvir',1,datetime('now','-1 hour')),"+
    "(5,'Completed','manual',2,datetime('now','-1 hour')),"+
    "(6,'Completed','manual',2,datetime('now','-1 hour')),"+
    "(7,'Completed','manual',1,datetime('now','-100 days')),"+
    "(8,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(9,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(10,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(11,'Completed','manual',1,datetime('now','-1 hour')),"+
    "(12,'Completed','manual',1,datetime('now','-1 hour'));"+
    "UPDATE repairs SET reviewed_at=CURRENT_TIMESTAMP WHERE id=2;"+
    "UPDATE repairs SET go_live_archived_at=CURRENT_TIMESTAMP WHERE id=9;"+
    "UPDATE repairs SET maintenance_checklist_item_id=123 WHERE id=10;"+
    "INSERT INTO invoices(id,repair_id) VALUES(1,3);"+
    "INSERT INTO invoice_repair_links(invoice_id,repair_id) VALUES(2,8);"+
    "INSERT INTO repair_labor_timers(user_id,repair_id) VALUES(43,11);"+
    "INSERT INTO pm_next_repairs(id,repair_id,target_repair_id) VALUES(1,512,12);"+
    "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES"+
    "(1,29,1,'completed','Original completed'),(5,43,2,'completed','Completed by someone else'),(6,29,1,'completed','Completed as a helper');"+
    "INSERT INTO repair_labor_entries(repair_id,hours) VALUES(1,3.5);"+
    "INSERT INTO repair_parts(repair_id,part_id,quantity) VALUES(1,100,2);"
  );
  const insert=db.prepare(
    "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) "+
    "SELECT r.id,?,?,'reopened_for_correction',? FROM repairs r WHERE "+eligibleRepair
  );
  const update=db.prepare(
    "UPDATE repairs SET status='Open',completed_at=NULL,updated_at=CURRENT_TIMESTAMP "+
    "WHERE id IN (SELECT r.id FROM repairs r WHERE "+eligibleRepair+")"
  );
  function reopen(id,tech=1,user=29){
    db.exec('BEGIN');
    try{
      const logged=insert.run(user,tech,'Forgot to log parts',id,tech,user).changes;
      const reopened=update.run(id,tech,user).changes;
      db.exec('COMMIT');
      return {logged,reopened};
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  const row=id=>db.prepare('SELECT * FROM repairs WHERE id=?').get(id);
  return {db,reopen,row};
}

test('reopening own shop repair preserves original completion event, labor and parts',()=>{
  const {db,reopen,row}=fixture();
  assert.deepEqual(reopen(1),{logged:1,reopened:1});
  assert.equal(row(1).status,'Open');
  assert.equal(row(1).completed_at,null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM repair_job_events WHERE repair_id=1 AND action='completed'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM repair_job_events WHERE repair_id=1 AND action='reopened_for_correction'").get().n,1);
  assert.equal(db.prepare('SELECT hours FROM repair_labor_entries WHERE repair_id=1').get().hours,3.5);
  assert.equal(db.prepare('SELECT quantity FROM repair_parts WHERE repair_id=1').get().quantity,2);
  assert.deepEqual(reopen(1),{logged:0,reopened:0},'repeated reopen cannot add another audit event');
  db.close();
});

test('reopen refuses approved, invoiced, external, archived, older, checklist-linked and timer-active repairs',()=>{
  const {db,reopen,row}=fixture();
  for(const id of [2,3,4,7,8,9,10,11,12]){
    assert.deepEqual(reopen(id),{logged:0,reopened:0},'repair '+id+' should be protected');
    assert.equal(row(id).status,'Completed');
  }
  assert.deepEqual(reopen(5),{logged:0,reopened:0},'cannot reopen another technician’s repair');
  assert.deepEqual(reopen(6),{logged:1,reopened:1},'the last completing helper may reopen an eligible job');
  db.close();
});

test('reopen endpoint checks identity, reason, ownership, invoicing and audit before changing repair status',()=>{
  assert.match(route,/getSessionUser\(env\.DB,request\)/);
  assert.match(route,/user\.role==='mechanic'\|\|user\.role==='manager'/);
  assert.match(route,/reason\.length<8\|\|reason\.length>450/);
  assert.match(route,/lower\(trim\(COALESCE\(r\.source,''\)\)\)='manual'/);
  assert.match(route,/r\.reviewed_at IS NULL/);
  assert.match(route,/NOT EXISTS \(SELECT 1 FROM invoices/);
  assert.match(route,/NOT EXISTS \(SELECT 1 FROM invoice_repair_links/);
  assert.match(route,/r\.go_live_archived_at IS NULL/);
  assert.match(route,/r\.maintenance_checklist_item_id IS NULL/);
  assert.match(route,/r\.maintenance_source_id IS NULL/);
  assert.match(route,/NOT EXISTS \(SELECT 1 FROM pm_next_repairs/);
  assert.match(route,/r\.completed_at>=datetime\('now','-90 days'\)/);
  assert.match(route,/await env\.DB\.batch/);
  assert.match(route,/INSERT INTO repair_job_events/);
  assert.match(route,/status='Open',completed_at=NULL/);
  assert.doesNotMatch(route,/DELETE FROM repair_labor_entries|UPDATE repair_labor_entries|DELETE FROM repair_parts|UPDATE repair_parts|UPDATE inventory|markLinkedDvirRepaired/);
  assert.match(worker,/'\/api\/shop\/reopen-completed'/);
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS\.has\(pathname\)/);
});

test('Completed tab presents eligible own work orders with deliberate reason and confirmation',()=>{
  assert.match(listing,/AS canReopen/);
  assert.match(listing,/r\.reviewed_at IS NULL/);
  assert.match(listing,/NOT EXISTS\(SELECT 1 FROM invoice_repair_links/);
  assert.match(listing,/FROM repair_job_events ev WHERE ev\.repair_id=r\.id/);
  assert.match(listing,/\.bind\(techId,user\.id,techId,techId\)\.all\(\)/);
  assert.match(completed,/REOPEN WORK ORDER/);
  assert.match(completed,/Why are you reopening this work order/);
  assert.match(completed,/CONFIRM REOPEN/);
  assert.match(completed,/\/api\/shop\/reopen-completed/);
  assert.match(completed,/setReopenMessage/);
  assert.match(completed,/onGoToWorking/);
  assert.match(shop,/onReopened=\{load\} onGoToWorking=/);
});
