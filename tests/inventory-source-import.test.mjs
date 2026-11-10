import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildInventoryImportSql, inventoryImportHash, planInventoryImport, verifyInventoryImportPlan, inventoryImportAuditVerificationSql, inventoryWarehouseZeroVerificationSql } from '../lib/inventory-import.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = { name: 'Synthetic inventory.xlsx', sha256: 'a'.repeat(64), asOf: '2026-11-10T06:48:00' };
const row = (values = {}) => ({ sourceRowId: 'XLS:2', partNumber: 'FILTER-1', description: 'Oil filter', warehouseCode: 'CLARE', quantity: 12, sourceActive: true, ...values });
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_users(id INTEGER PRIMARY KEY);
    CREATE TABLE repairs(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE equipment(id INTEGER PRIMARY KEY,out_of_service INTEGER);
    CREATE TABLE repair_parts(id INTEGER PRIMARY KEY,repair_id INTEGER,part_id INTEGER,quantity REAL);
    CREATE TABLE repair_part_requests(id INTEGER PRIMARY KEY,repair_id INTEGER,part_id INTEGER,warehouse_id INTEGER,requested_quantity REAL,used_quantity REAL,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE part_cross_references(id INTEGER PRIMARY KEY,part_id INTEGER,cross_part_number TEXT,normalized_cross_part_number TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE parts(id INTEGER PRIMARY KEY AUTOINCREMENT,part_number TEXT NOT NULL UNIQUE,description TEXT NOT NULL,quantity_on_hand REAL DEFAULT 0,reorder_level REAL DEFAULT 0,preferred_vendor_id INTEGER,unit_cost REAL,location TEXT,active INTEGER DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,source_active_flag TEXT,source_stock_flag TEXT,product_group TEXT,markup_group TEXT,charge_price REAL,source_updated_at TEXT,core_return_part_id INTEGER,core_return_quantity REAL DEFAULT 0,deleted_at TEXT,deleted_by_user_id INTEGER);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,code TEXT UNIQUE,name TEXT,active INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE part_warehouse_stock(id INTEGER PRIMARY KEY AUTOINCREMENT,part_id INTEGER NOT NULL REFERENCES parts(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),variant_key TEXT NOT NULL DEFAULT '',core_type TEXT,quantity_on_hand REAL DEFAULT 0,unit_of_measure TEXT,unit_cost REAL,charge_price REAL,on_order REAL DEFAULT 0,cm TEXT,inventory_line TEXT,last_purchase_received TEXT,last_issue TEXT,source_page INTEGER,source_updated_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(part_id,warehouse_id,variant_key));
    INSERT INTO warehouses(id,code,name,active) VALUES(1,'CLARE','Clare',1),(2,'CADILLAC','Cadillac',1),(3,'BOYNE','Boyne',0);
    INSERT INTO parts(id,part_number,description,quantity_on_hand,reorder_level,unit_cost,location,product_group,source_stock_flag,core_return_part_id,core_return_quantity) VALUES(1,'FILTER-1','Oil filter',5,3,9.5,'Legacy bin','Filters','S',2,1),(2,'CORE-2','Core part',3,0,25,'',NULL,NULL,NULL,0);
    INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order,source_page,inventory_line) VALUES(10,1,1,'',5,'EA',9.5,4,7,'old-source'),(20,2,1,'new',5,'EA',25,0,8,'old-A'),(21,2,1,'core',-2,'EA',3,0,8,'old-B');
    INSERT INTO repair_part_requests VALUES(1,1,1,1,2,0,'open','2026-11-01','2026-11-01');
  `);
  db.exec(read('migrations/0092_parts_inventory_v2_operations.sql'));
  db.exec(read('migrations/0155_part_warehouse_bin_locations.sql'));
  db.exec(read('migrations/0156_inventory_source_imports.sql'));
  db.exec("INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location) VALUES(1,1,'A1');");
  const snapshot = () => ({ schemaVersion: 1, complete: true, databaseName: 'norlow-repair-production', databaseId: '00000000-0000-0000-0000-000000000000', exportedAt: '2026-11-10T13:00:00Z', binsTablePresent: true,
    tables: Object.fromEntries(['parts','part_warehouse_stock','warehouses','part_warehouse_locations','part_cross_references'].map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY id`).all().map((item) => ({...item}))])),
    inventoryOperationTail: db.prepare("SELECT l.warehouse_stock_id,l.operation_id,l.id AS line_id FROM inventory_operation_lines l JOIN inventory_operations o ON o.id=l.operation_id WHERE o.status='applied' AND l.id=(SELECT MAX(l2.id) FROM inventory_operation_lines l2 JOIN inventory_operations o2 ON o2.id=l2.operation_id WHERE l2.warehouse_stock_id=l.warehouse_stock_id AND o2.status='applied') ORDER BY l.warehouse_stock_id").all().map((item) => ({...item})), openRequests: [],coreObligations: [] });
  const plan = (rows = [row()], backup = snapshot()) => planInventoryImport({source,rows},backup);
  const applySql = (sql) => { db.exec('BEGIN'); try { db.exec(sql); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const apply = (prepared) => applySql(buildInventoryImportSql(prepared));
  const table = (name) => db.prepare(`SELECT * FROM ${name}`).all().map((value) => ({...value}));
  return {db,snapshot,plan,apply,applySql,table};
}

test('source import updates physical stock and bin, preserving identities, costs, reservations, and source variants', () => {
  const f=fixture();
  try {
    const stockBefore=f.table('part_warehouse_stock')[0], partBefore=f.table('parts')[0], requests=JSON.stringify(f.table('repair_part_requests'));
    const plan=f.plan([row({binLocation:'Room A / Shelf 3 / Bin 7',unitCost:500})]);
    assert.equal(plan.canApply,true); f.apply(plan);
    const after=f.table('part_warehouse_stock')[0], part=f.table('parts')[0];
    assert.equal(after.id,stockBefore.id); assert.equal(after.quantity_on_hand,12); assert.equal(after.on_order,4); assert.equal(after.unit_cost,9.5);
    for(const field of ['variant_key','core_type','unit_of_measure','inventory_line','source_page','charge_price']) assert.equal(after[field],stockBefore[field]);
    for(const field of ['description','reorder_level','preferred_vendor_id','unit_cost','location','product_group','source_stock_flag','core_return_part_id','core_return_quantity']) assert.equal(part[field],partBefore[field]);
    assert.equal(part.quantity_on_hand,12); assert.equal(JSON.stringify(f.table('repair_part_requests')),requests);
    assert.equal(f.table('part_warehouse_locations')[0].bin_location,'Room A / Shelf 3 / Bin 7');
    assert.equal(f.table('inventory_operation_lines')[0].quantity_delta,7);
    assert.equal(f.table('inventory_operation_commits')[0].applied,1);
    const audit=f.table('inventory_source_import_rows')[0];
    assert.equal(JSON.parse(audit.before_json).stock.quantity_on_hand,5); assert.equal(JSON.parse(audit.after_json).stock.quantity_on_hand,12);
    assert.equal(JSON.parse(audit.after_json).part.quantity_on_hand,12); assert.equal(JSON.parse(audit.before_json).bin.bin_location,'A1');
    assert.equal(f.table('inventory_source_imports')[0].status,'applied');
  } finally {f.db.close();}
});

test('new parts and warehouse stocks are created once across multiple warehouse source rows', () => {
  const f=fixture();try {
    const plan=f.plan([row({sourceRowId:'XLS:8',partNumber:'NEW-8',description:'New component',quantity:3,binLocation:'C1',unitOfMeasure:'EA',unitCost:7}),row({sourceRowId:'XLS:9',partNumber:'NEW-8',description:'New component',warehouseCode:'CADILLAC',quantity:2,binLocation:'D4',unitOfMeasure:'EA',unitCost:8})]);
    assert.equal(plan.canApply,true); f.apply(plan);
    const part=f.table('parts').find((entry)=>entry.part_number==='NEW-8'); assert.equal(part.quantity_on_hand,5);
    const stocks=f.table('part_warehouse_stock').filter((entry)=>entry.part_id===part.id); assert.equal(stocks.length,2);assert.deepEqual(stocks.map((entry)=>entry.quantity_on_hand),[3,2]);
    assert.deepEqual(f.table('part_warehouse_locations').filter((entry)=>entry.part_id===part.id).map((entry)=>entry.bin_location),['C1','D4']);
  }finally{f.db.close();}
});

test('inactive, nonpositive, invalid, and inactive-warehouse source rows block the whole import', () => {
  const f=fixture();try {
    for(const value of [{sourceActive:false},{sourceActive:'Y'},{quantity:0},{quantity:-1},{quantity:NaN},{quantity:Infinity},{warehouseCode:'BOYNE'},{warehouseCode:'Unknown'},{partNumber:''}]) {
      const plan=f.plan([row(),row({sourceRowId:'XLS:99',...value})]); assert.equal(plan.canApply,false); assert.throws(()=>buildInventoryImportSql(plan),/Blocked|integrity/);
    }
    assert.equal(f.table('inventory_operations').length,0);assert.equal(f.table('part_warehouse_stock')[0].quantity_on_hand,5);
  }finally{f.db.close();}
});

test('archived, tombstoned, and ambiguous catalog identities never reactivate or silently merge',()=>{
  const f=fixture();try {
    f.db.exec('UPDATE parts SET active=0 WHERE id=1'); assert.equal(f.plan().canApply,false);
    f.db.exec("UPDATE parts SET active=1,deleted_at='2026-11-01' WHERE id=1"); assert.equal(f.plan().canApply,false);
    f.db.exec("UPDATE parts SET deleted_at=NULL WHERE id=1; INSERT INTO parts(part_number,description) VALUES('filter-1','Duplicate case');"); assert.equal(f.plan().canApply,false);
  }finally{f.db.close();}
});

test('duplicate sources and multiple core variants require exact, distinct stock mappings',()=>{
  const f=fixture();try {
    assert.equal(f.plan([row({partNumber:'CORE-2'})]).canApply,false);
    assert.equal(f.plan([row(),row({sourceRowId:'XLS:3'})]).canApply,false);
    assert.equal(f.plan([row({partNumber:'CORE-2',stockId:10})]).canApply,false);
    assert.equal(f.plan([row({partNumber:'CORE-2',variantKey:'unknown'})]).canApply,false);
    assert.equal(f.plan([row({sourceRowId:'XLS:2',partNumber:'CORE-2',stockId:20}),row({sourceRowId:'XLS:3',partNumber:'CORE-2',stockId:20})]).canApply,false);
    const mapped=f.plan([row({sourceRowId:'XLS:2',partNumber:'CORE-2',stockId:20,quantity:8}),row({sourceRowId:'XLS:3',partNumber:'CORE-2',variantKey:'core',quantity:1})]);
    assert.equal(mapped.canApply,true);f.apply(mapped);assert.deepEqual(f.table('part_warehouse_stock').filter((entry)=>entry.part_id===2).map((entry)=>[entry.id,entry.variant_key,entry.quantity_on_hand]),[[20,'new',8],[21,'core',1]]);
  }finally{f.db.close();}
});

test('explicit warehouse totals can set the primary to zero while preserving every sibling and auditing the total',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order) VALUES(11,1,1,'other',2,'EA',20,6),(12,1,2,'other-warehouse',7,'BOX',30,0); UPDATE parts SET quantity_on_hand=14 WHERE id=1;");
    const siblings=f.table('part_warehouse_stock').filter((entry)=>[11,12].includes(entry.id));
    const requests=f.table('repair_part_requests');
    const plan=f.plan([row({balanceScope:'warehouse_total',stockId:10,quantity:2,binLocation:'Counted bin'})]);
    assert.equal(plan.canApply,true);assert.equal(plan.groups[0].rows[0].expectedStockQuantity,0);
    assert.equal(plan.summary.quantityBefore,7);assert.equal(plan.summary.quantityAfter,2);
    f.apply(plan);
    assert.equal(f.table('part_warehouse_stock').find((entry)=>entry.id===10).quantity_on_hand,0);
    assert.deepEqual(f.table('part_warehouse_stock').filter((entry)=>[11,12].includes(entry.id)),siblings);
    assert.equal(f.table('parts')[0].quantity_on_hand,9);assert.deepEqual(f.table('repair_part_requests'),requests);
    assert.equal(f.table('inventory_operation_lines')[0].quantity_delta,-5);
    const audit=f.table('inventory_source_import_rows')[0],before=JSON.parse(audit.before_json),after=JSON.parse(audit.after_json),sourceRow=JSON.parse(audit.source_json);
    assert.equal(sourceRow.balanceScope,'warehouse_total');assert.equal(sourceRow.quantity,2);
    assert.equal(before.warehouseQuantity,7);assert.equal(before.warehouseStocks.length,2);assert.equal(after.stock.quantity_on_hand,0);assert.equal(after.warehouseQuantity,2);
    const verification=()=>({...f.db.prepare(inventoryImportAuditVerificationSql).get(plan.importKey)});
    assert.deepEqual(verification(),{audited_rows:1,audited_matching_balances:1,audited_matching_bins:1,current_matching_balances:1,current_matching_bins:1});
    f.db.exec('UPDATE part_warehouse_stock SET quantity_on_hand=1 WHERE id=11');
    assert.equal(verification().audited_matching_balances,1);assert.equal(verification().current_matching_balances,0);
  }finally{f.db.close();}
});

test('warehouse totals require an existing explicit primary, compatible units, one source row, and a nonnegative target',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure) VALUES(11,1,1,'other',2,'EA');");
    const total=(overrides={})=>row({balanceScope:'warehouse_total',stockId:10,quantity:8,...overrides});
    for(const invalid of [total({stockId:undefined}),total({stockId:99}),total({partNumber:'NEW',description:'New'}),total({quantity:1}),total({unitOfMeasure:'GAL'})]) {
      if(invalid.stockId===undefined) delete invalid.stockId;
      assert.equal(f.plan([invalid]).canApply,false);
    }
    assert.throws(()=>f.plan([row({balanceScope:'unknown'})]),/balance scope/);
    assert.equal(f.plan([total(),row({sourceRowId:'XLS:3',stockId:11,quantity:2})]).canApply,false);
    f.db.exec("UPDATE part_warehouse_stock SET unit_of_measure='GAL' WHERE id=11");
    assert.equal(f.plan([total()]).canApply,false);
    assert.equal(f.table('inventory_source_imports').length,0);
  }finally{f.db.close();}
});

test('warehouse totals preserve negative siblings and depend on each contributing prior stock operation',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO inventory_operations(id,operation_key,operation_type) VALUES(1,'prior-primary','physical_count_resolution'),(2,'prior-sibling','physical_count_resolution'); INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type) VALUES(1,2,20,1,0,'physical_count_resolution'),(2,2,21,1,0,'physical_count_resolution');");
    const sibling=f.table('part_warehouse_stock').find((entry)=>entry.id===21);
    const plan=f.plan([row({partNumber:'CORE-2',balanceScope:'warehouse_total',stockId:20,quantity:4})]);
    assert.equal(plan.canApply,true);assert.equal(plan.groups[0].rows[0].expectedStockQuantity,6);f.apply(plan);
    assert.equal(f.table('part_warehouse_stock').find((entry)=>entry.id===20).quantity_on_hand,6);
    assert.deepEqual(f.table('part_warehouse_stock').find((entry)=>entry.id===21),sibling);
    assert.equal(f.table('parts').find((entry)=>entry.id===2).quantity_on_hand,4);
    assert.deepEqual(f.table('inventory_operation_dependencies').map((entry)=>entry.depends_on_operation_id),[1,2]);
    assert.equal(f.table('inventory_operation_lines').at(-1).quantity_delta,1);
  }finally{f.db.close();}
});

test('stale warehouse-total siblings and their operation tails abort the complete import',()=>{
  for(const mutate of ["UPDATE part_warehouse_stock SET quantity_on_hand=3 WHERE id=11","DELETE FROM part_warehouse_stock WHERE id=11","INSERT INTO part_warehouse_stock(part_id,warehouse_id,variant_key,quantity_on_hand) VALUES(1,1,'concurrent',0)","INSERT INTO inventory_operations(id,operation_key,operation_type) VALUES(99,'concurrent','physical_count_resolution'); INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type) VALUES(99,1,11,1,0,'physical_count_resolution')"]) {
    const f=fixture();try {
      f.db.exec("INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure) VALUES(11,1,1,'other',2,'EA');");
      const plan=f.plan([row({balanceScope:'warehouse_total',stockId:10,quantity:8}),row({sourceRowId:'XLS:3',partNumber:'AAA-NEW',description:'New',quantity:3})]);
      assert.equal(plan.canApply,true);f.db.exec(mutate);const before=JSON.stringify(f.snapshot().tables);
      assert.throws(()=>f.apply(plan),/CHECK constraint/);assert.equal(JSON.stringify(f.snapshot().tables),before);
      assert.equal(f.table('inventory_source_imports').length,0);assert.equal(f.table('inventory_source_import_rows').length,0);
    }finally{f.db.close();}
  }
});

test('alternate catalog spellings and cross-references cannot become duplicate new parts, including a concurrent alias',()=>{
  const f=fixture();try {
    assert.equal(f.plan([row({partNumber:'FILTER1'})]).canApply,false);
    f.db.exec("INSERT INTO part_cross_references VALUES(1,1,'ALT-1','ALT1',1)");
    assert.equal(f.plan([row({partNumber:'ALT-1'})]).canApply,false);
    const plan=f.plan([row({partNumber:'NEW-ALIAS',description:'New'})]);assert.equal(plan.canApply,true);
    f.db.exec("INSERT INTO part_cross_references VALUES(2,1,'NEW-ALIAS','NEWALIAS',1)");
    assert.throws(()=>f.apply(plan),/CHECK constraint/);assert.equal(f.table('parts').length,2);
  }finally{f.db.close();}
});

test('all punctuation normalization is checked before new parts are inserted, including same-source aliases',()=>{
  const f=fixture();try {
    const plan=f.plan([row({partNumber:'NEW#1',description:'New'})]);assert.equal(plan.canApply,true);
    f.db.exec("INSERT INTO parts(part_number,description) VALUES('NEW!1','Concurrent spelling')");
    assert.throws(()=>f.apply(plan),/CHECK constraint/);assert.equal(f.table('parts').length,3);
    for(const pair of [['ALT-2','ALT2'],['ALT#2','ALT!2']]) assert.equal(f.plan([row({partNumber:pair[0],description:'New'}),row({sourceRowId:'XLS:3',partNumber:pair[1],description:'New'})]).canApply,false);
  }finally{f.db.close();}
});

test('positive-only imports leave omitted negative and zero variants, other parts, and warehouses intact',()=>{
  const f=fixture();try {
    const original=f.table('part_warehouse_stock')[0];
    const mapped=f.plan([row({partNumber:'CORE-2',stockId:20,quantity:9})]);assert.equal(mapped.canApply,true);f.apply(mapped);
    assert.equal(f.table('part_warehouse_stock').find((entry)=>entry.id===21).quantity_on_hand,-2);
    assert.equal(f.table('parts').find((entry)=>entry.id===2).quantity_on_hand,7);
    assert.deepEqual(f.table('part_warehouse_stock')[0],original);
  }finally{f.db.close();}
});

const boyneZero = [{warehouseCode:'BOYNE',reason:'User requested Boyne inventory be set to zero before the EMDECS upload.'}];
test('explicit Boyne zero handles all balances and archived parts without changing metadata, other warehouses, or reservations',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO parts(id,part_number,description,quantity_on_hand,active,deleted_at) VALUES(3,'ARCHIVED','Archived part',6,0,NULL),(4,'DELETED','Deleted part',0,0,'2026-11-01'); INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order,source_updated_at,updated_at) VALUES(30,1,3,'old',4,'EA',22,3,'2026-08-06','2026-08-07'),(31,3,3,'negative',-3,'EA',33,2,'2026-08-06','2026-08-07'),(32,4,3,'zero',0,'EA',44,1,'2026-08-06','2026-08-07'),(33,1,2,'untargeted',6,'BOX',55,5,'2026-08-06','2026-08-07'),(34,3,2,'untargeted',9,'EA',66,4,'2026-08-06','2026-08-07'); UPDATE parts SET quantity_on_hand=15 WHERE id=1; INSERT INTO repair_part_requests VALUES(2,2,1,3,1,0,'open','2026-11-01','2026-11-01'); INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location,source) VALUES(1,3,'B old','manual');");
    const before=f.snapshot(),requests=f.table('repair_part_requests');
    const plan=planInventoryImport({source,rows:[row({binLocation:'C new'})],zeroWarehouses:boyneZero},before);
    assert.equal(plan.canApply,true);assert.equal(plan.summary.positiveSourceRows,1);assert.equal(plan.summary.warehouseZeroRows,3);assert.equal(plan.summary.warehouseZeroChangedRows,2);assert.equal(plan.summary.sourceRows,4);
    assert.equal(plan.normalized.rows.length,1);assert.deepEqual(plan.normalized.zeroWarehouses,boyneZero);
    f.apply(plan);
    const after=f.snapshot();
    for(const stock of before.tables.part_warehouse_stock.filter((entry)=>entry.warehouse_id===3)) {
      const changed=after.tables.part_warehouse_stock.find((entry)=>entry.id===stock.id);assert.equal(changed.quantity_on_hand,0);
      for(const key of Object.keys(stock).filter((key)=>!['quantity_on_hand','updated_at'].includes(key))) assert.equal(changed[key],stock[key]);
      const audit=f.table('inventory_source_import_rows').find((entry)=>entry.warehouse_stock_id===stock.id);
      assert.equal(JSON.parse(audit.source_json).action,'warehouse_zero');assert.equal(JSON.parse(audit.source_json).reason,boyneZero[0].reason);assert.equal(JSON.parse(audit.after_json).stock.quantity_on_hand,0);
    }
    assert.deepEqual(after.tables.part_warehouse_stock.filter((entry)=>[20,21,33,34].includes(entry.id)),before.tables.part_warehouse_stock.filter((entry)=>[20,21,33,34].includes(entry.id)));
    assert.deepEqual(after.tables.warehouses,before.tables.warehouses);assert.deepEqual(f.table('repair_part_requests'),requests);
    for(const id of [3,4]) for(const field of ['active','deleted_at','description']) assert.equal(after.tables.parts.find((entry)=>entry.id===id)[field],before.tables.parts.find((entry)=>entry.id===id)[field]);
    assert.equal(after.tables.parts.find((entry)=>entry.id===1).quantity_on_hand,18);assert.equal(after.tables.parts.find((entry)=>entry.id===3).quantity_on_hand,9);
    assert.equal(after.tables.part_warehouse_locations.find((entry)=>entry.warehouse_id===3).bin_location,'B old');
    assert.deepEqual({...f.db.prepare(inventoryWarehouseZeroVerificationSql).get(3)},{warehouse_active:0,stock_rows:3,zero_stock_rows:3,quantity_on_hand:0});
    const auditMatch={...f.db.prepare(inventoryImportAuditVerificationSql).get(plan.importKey)};
    assert.equal(auditMatch.audited_matching_balances,4);assert.equal(auditMatch.current_matching_balances,4);
    assert.equal(f.table('inventory_operations').filter((entry)=>entry.operation_type==='warehouse_inventory_zero').length,3);
    const applied=JSON.stringify([f.snapshot(),f.table('inventory_operations'),f.table('inventory_source_import_rows')]);f.apply(plan);
    assert.equal(JSON.stringify([f.snapshot(),f.table('inventory_operations'),f.table('inventory_source_import_rows')]),applied);
  }finally{f.db.close();}
});

test('the warehouse-zero exception cannot be forged by source rows or extended beyond the inactive Boyne warehouse',()=>{
  const f=fixture();try {
    for(const zeroWarehouses of [[{warehouseCode:'CLARE',reason:'Not authorized'}],[{warehouseCode:'BOYNE',reason:''}],boyneZero.concat(boyneZero),'BOYNE']) assert.throws(()=>planInventoryImport({source,rows:[row()],zeroWarehouses},f.snapshot()),/Boyne|BOYNE|warehouse-zero/);
    assert.equal(planInventoryImport({source,rows:[row({quantity:0,warehouseCode:'BOYNE',action:'warehouse_zero',isWarehouseZero:true})],zeroWarehouses:boyneZero},f.snapshot()).canApply,false);
    assert.throws(()=>planInventoryImport({source,rows:[row({sourceRowId:'warehouse-zero:BOYNE:99'})],zeroWarehouses:boyneZero},f.snapshot()),/reserved/);
    f.db.exec('UPDATE parts SET active=0 WHERE id=1');assert.equal(planInventoryImport({source,rows:[row()],zeroWarehouses:boyneZero},f.snapshot()).canApply,false);
    f.db.exec('UPDATE warehouses SET active=1 WHERE id=3');assert.throws(()=>planInventoryImport({source,rows:[row()],zeroWarehouses:boyneZero},f.snapshot()),/inactive warehouse/);
    assert.equal(f.table('inventory_operations').length,0);
  }finally{f.db.close();}
});

test('Boyne membership and state changes invalidate the entire zero and positive import atomically',()=>{
  const changes=[
    "INSERT INTO parts(id,part_number,description) VALUES(99,'ZZ-NEW-BOYNE','Concurrent part'); INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand) VALUES(99,99,3,'new',7)",
    "DELETE FROM part_warehouse_stock WHERE id=30",
    "UPDATE part_warehouse_stock SET id=99 WHERE id=30",
    "UPDATE part_warehouse_stock SET quantity_on_hand=8 WHERE id=30",
    "UPDATE warehouses SET active=1 WHERE id=3",
    "UPDATE part_warehouse_stock SET quantity_on_hand=8 WHERE id=10",
    "INSERT INTO inventory_operations(id,operation_key,operation_type) VALUES(99,'later-boyne','physical_count_resolution'); INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type) VALUES(99,1,30,3,0,'physical_count_resolution')",
  ];
  for(const mutation of changes){const f=fixture();try {
    f.db.exec("INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand) VALUES(30,1,3,'old',4)");
    const plan=planInventoryImport({source,rows:[row()],zeroWarehouses:boyneZero},f.snapshot());assert.equal(plan.canApply,true);f.db.exec(mutation);
    const before=JSON.stringify([f.snapshot(),f.table('inventory_operations')]);assert.throws(()=>f.apply(plan),/CHECK constraint/);
    assert.equal(JSON.stringify([f.snapshot(),f.table('inventory_operations')]),before);assert.equal(f.table('inventory_source_import_rows').length,0);
  }finally{f.db.close();}}
});

test('an empty Boyne zero action still guards against a concurrently added warehouse stock',()=>{
  const f=fixture();try {
    const plan=planInventoryImport({source,rows:[row()],zeroWarehouses:boyneZero},f.snapshot());assert.equal(plan.summary.warehouseZeroRows,0);assert.equal(plan.canApply,true);
    f.db.exec("INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand) VALUES(30,1,3,'new',0)");
    assert.throws(()=>f.apply(plan),/CHECK constraint/);assert.equal(f.table('part_warehouse_stock').find((entry)=>entry.id===10).quantity_on_hand,5);
  }finally{f.db.close();}
});

test('each stale stock, warehouse, part, or bin condition aborts every mutation including audit rows',()=>{
  for(const mutate of ["UPDATE part_warehouse_stock SET quantity_on_hand=6 WHERE id=10","UPDATE warehouses SET active=0 WHERE id=1","UPDATE parts SET active=0 WHERE id=1","UPDATE part_warehouse_locations SET bin_location='Changed' WHERE part_id=1"]) {
    const f=fixture();try {
      const plan=f.plan([row({binLocation:'Imported'}),row({sourceRowId:'XLS:3',partNumber:'NEW',description:'New'})]);f.db.exec(mutate);
      const before=JSON.stringify(f.snapshot().tables);assert.throws(()=>f.apply(plan),/CHECK constraint/);
      assert.equal(JSON.stringify(f.snapshot().tables),before);assert.equal(f.table('inventory_source_imports').length,0);assert.equal(f.table('inventory_operations').length,0);
    }finally{f.db.close();}
  }
});

test('late database failure rolls back stock, bins, newly created parts, and all operation/source audits',()=>{
  const f=fixture();try {
    const before=JSON.stringify(f.snapshot().tables);const plan=f.plan([row({binLocation:'B2'}),row({sourceRowId:'XLS:3',partNumber:'NEW',description:'New'})]);
    assert.throws(()=>f.applySql(`${buildInventoryImportSql(plan)}\nUPDATE inventory_source_imports SET guard=0;`),/CHECK constraint/);
    assert.equal(JSON.stringify(f.snapshot().tables),before);assert.equal(f.table('inventory_operations').length,0);assert.equal(f.table('inventory_source_import_rows').length,0);
  }finally{f.db.close();}
});

test('replaying an applied SQL import is idempotent and cannot duplicate quantities or ledger entries',()=>{
  const f=fixture();try {
    const plan=f.plan([row({binLocation:'B2'}),row({sourceRowId:'XLS:3',partNumber:'NEW',description:'New',quantity:7})]);f.apply(plan);
    const before=JSON.stringify([f.snapshot().tables,f.table('inventory_operations'),f.table('inventory_source_import_rows')]);f.apply(plan);
    assert.equal(JSON.stringify([f.snapshot().tables,f.table('inventory_operations'),f.table('inventory_source_import_rows')]),before);
  }finally{f.db.close();}
});

test('the source import follows prior inventory operations and detects newer zero-delta operations',()=>{
  const f=fixture();try {
    f.db.exec("INSERT INTO inventory_operations(id,operation_key,operation_type) VALUES(1,'old','physical_count_resolution'); INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type) VALUES(1,1,10,1,0,'physical_count_resolution');");
    const plan=f.plan();f.apply(plan);assert.equal(f.table('inventory_operation_dependencies')[0].depends_on_operation_id,1);
    const next=f.plan([row({quantity:13})]);
    f.db.exec("INSERT INTO inventory_operations(id,operation_key,operation_type) VALUES(99,'later','physical_count_resolution'); INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type) VALUES(99,1,10,1,0,'physical_count_resolution');");
    assert.throws(()=>f.apply(next),/CHECK constraint/);assert.equal(f.table('part_warehouse_stock')[0].quantity_on_hand,12);
  }finally{f.db.close();}
});

test('approved plan hashes ignore unrelated export changes but bind source and affected record state',()=>{
  const f=fixture();try {
    const snapshot=f.snapshot(), original=f.plan([row()],snapshot);
    const refreshed=structuredClone(snapshot);refreshed.exportedAt='2026-11-10T15:00:00Z';refreshed.tables.parts.push({id:77,part_number:'UNRELATED',active:1});
    const fresh=f.plan([row()],refreshed);assert.equal(fresh.planHash,original.planHash);assert.notEqual(fresh.snapshotSha256,original.snapshotSha256);
    refreshed.tables.part_warehouse_stock[0].quantity_on_hand=8;assert.notEqual(f.plan([row()],refreshed).planHash,original.planHash);
    const tampered=structuredClone(original);tampered.groups[0].rows[0].source.quantity=99;assert.throws(()=>verifyInventoryImportPlan(tampered),/integrity/);
    assert.equal(inventoryImportHash(snapshot),original.snapshotSha256);
  }finally{f.db.close();}
});

test('bin conflicts and mismatched UOM/core mappings are blocked, omitted bins are preserved, and quoted source text stays data',()=>{
  const f=fixture();try {
    assert.equal(f.plan([row({unitOfMeasure:'GAL'})]).canApply,false);
    assert.equal(f.plan([row({coreType:'RETURN'})]).canApply,false);
    const bad=f.plan([row({partNumber:'CORE-2',stockId:20,binLocation:'A'}),row({sourceRowId:'XLS:3',partNumber:'CORE-2',stockId:21,binLocation:'B'})]);assert.equal(bad.canApply,false);
    f.apply(f.plan());assert.equal(f.table('part_warehouse_locations')[0].bin_location,'A1');
    const location="Shelf 'C'; DROP TABLE parts; --";
    f.apply(f.plan([row({quantity:13,binLocation:location})]));assert.equal(f.table('part_warehouse_locations')[0].bin_location,location);assert.equal(f.table('parts').length,2);
  }finally{f.db.close();}
});
