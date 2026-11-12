import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, modules = {}) {
  const result = ts.transpileModule(read(path), {
    fileName:path, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,crypto:globalThis.crypto,TextEncoder,Request,Response,URL,console,
    require(name) { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; },
  }, {filename:path});
  return exports;
}
const service = compile('lib/inventory-warehouse-settings.ts');
const stockSetup = compile('lib/inventory-part-management.ts');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE parts(id INTEGER PRIMARY KEY,part_number TEXT,description TEXT,reorder_level REAL,active INTEGER,deleted_at TEXT,quantity_on_hand REAL,unit_cost REAL,location TEXT,inventory_class TEXT DEFAULT 'stock');
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,code TEXT UNIQUE,name TEXT,active INTEGER);
    CREATE TABLE part_warehouse_stock(id INTEGER PRIMARY KEY,part_id INTEGER,warehouse_id INTEGER,variant_key TEXT,quantity_on_hand REAL,unit_cost REAL,on_order REAL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,unit_of_measure TEXT,UNIQUE(part_id,warehouse_id,variant_key));
    CREATE TABLE part_warehouse_catalog_status(part_id INTEGER,warehouse_id INTEGER,status TEXT,PRIMARY KEY(part_id,warehouse_id));
    CREATE TABLE equipment(id INTEGER PRIMARY KEY);
    CREATE TABLE repairs(id INTEGER PRIMARY KEY);
    CREATE TABLE repair_parts(id INTEGER PRIMARY KEY);
    CREATE TABLE app_users(id INTEGER PRIMARY KEY);
    INSERT INTO app_users VALUES(1),(2);
    INSERT INTO equipment VALUES(80),(81);
    INSERT INTO parts(id,part_number,description,reorder_level,active,deleted_at,quantity_on_hand,unit_cost,location) VALUES
      (1,'PART-1','Test part',4,1,NULL,12,10,'General fallback'),
      (2,'PART-2','Other part',2,1,NULL,8,20,'Other fallback'),
      (3,'ARCHIVED','Archived',1,0,NULL,3,30,''),
      (4,'DELETED','Deleted',1,1,'2026-11-01',2,40,''),
      (5,'UNSTOCKED','No warehouse stocks',1,1,NULL,0,50,''),
      (6,'INACTIVE-WAREHOUSE','Inactive warehouse only',1,1,NULL,0,60,'');
    INSERT INTO warehouses VALUES(1,'CLARE','Clare shop',1),(2,'CADILLAC','Cadillac shop',1),(3,'BOYNE','Boyne',0);
    INSERT INTO part_warehouse_stock(id,part_id,warehouse_id,variant_key,quantity_on_hand,unit_cost,on_order,updated_at) VALUES
      (10,1,1,'',3,10,2,'2026-11-10'),(11,1,1,'core',4,100,3,'2026-11-10'),
      (12,1,2,'',5,11,4,'2026-11-10'),(13,2,1,'',8,20,1,'2026-11-10'),
      (14,3,1,'',3,30,0,'2026-11-10'),(15,4,1,'',2,40,0,'2026-11-10'),(16,6,3,'',0,60,0,'2026-11-10');
  `);
  sqlite.exec(read('migrations/0021_part_minimums_equipment.sql'));
  sqlite.exec(read('migrations/0092_parts_inventory_v2_operations.sql'));
  sqlite.exec(read('migrations/0155_part_warehouse_bin_locations.sql'));
  sqlite.exec(`
    INSERT INTO part_equipment(part_id,equipment_id) VALUES(1,80),(1,81);
    INSERT INTO part_warehouse_minimums VALUES(1,1,2,'2026-11-09'),(1,2,9,'2026-11-08'),(2,1,3,'2026-11-08');
    INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location,source,source_updated_at,updated_at) VALUES
      (1,1,'Room 1 / Shelf A / Bin 03'||char(10)||'Room 1 / Shelf A / Bin 04','EMDECS','2026-11-10','2026-11-10'),
      (1,2,'Room 2 / Shelf B / Bin 07','EMDECS','2026-11-09','2026-11-09'),
      (2,1,'Room 1 / Shelf A / Bin 03'||char(10)||'Room 1 / Shelf C / Bin 09','EMDECS','2026-11-10','2026-11-10'),
      (3,1,'Archived-only bin','manual',NULL,'2026-11-01'),
      (4,1,'Deleted-only bin','manual',NULL,'2026-11-01');
  `);
  let beforeBatch;
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql); let args = [];
      return {
        bind(...values) { args=values; return this; },
        async all() { return {results:statement.all(...args)}; },
        async first() { return statement.get(...args) ?? null; },
        runSync() { const result=statement.run(...args); return {meta:{changes:result.changes,last_row_id:result.lastInsertRowid}}; },
        async run() { return this.runSync(); },
      };
    },
    async batch(statements) {
      if (beforeBatch) { const hook=beforeBatch;beforeBatch=undefined;hook(); }
      sqlite.exec('BEGIN');
      try { const results=statements.map((statement)=>statement.runSync());sqlite.exec('COMMIT');return results; }
      catch(error) { sqlite.exec('ROLLBACK');throw error; }
    },
  };
  const rows = (name) => sqlite.prepare(`SELECT * FROM ${name}`).all().map((row)=>({...row}));
  return {sqlite,db,rows,race(callback){beforeBatch=callback;},async settings(part=1,warehouse='CLARE'){return service.getWarehousePartSettings(db,part,warehouse);}};
}

function request(settings, overrides = {}) {
  return {
    partId:settings.partId,warehouseCode:settings.warehouseCode,
    binLocations:[...settings.binLocations],minimumQuantity:settings.minimumQuantity,
    settingsVersion:settings.settingsVersion,operationKey:`warehouse-settings:${crypto.randomUUID()}`,
    ...overrides,
  };
}
const json = (value) => JSON.parse(JSON.stringify(value));

test('settings read preserves multiple bins and suggests only active parts in the selected warehouse', async () => {
  const f=fixture();
  try {
    const data=await f.settings();
    assert.deepEqual(json(data.binLocations),['Room 1 / Shelf A / Bin 03','Room 1 / Shelf A / Bin 04']);
    assert.deepEqual(json(data.binOptions),['Room 1 / Shelf A / Bin 03','Room 1 / Shelf A / Bin 04','Room 1 / Shelf C / Bin 09']);
    assert.equal(data.minimumQuantity,2);assert.equal(data.defaultMinimum,4);
    assert.match(data.settingsVersion,/^settings:[a-f0-9]{64}$/);
    assert.equal((await f.settings()).settingsVersion,data.settingsVersion);
  } finally { f.sqlite.close(); }
});

test('narrow update audits the change and preserves all stock, catalog, equipment and other warehouse settings', async () => {
  const f=fixture();
  try {
    const protectedBefore=Object.fromEntries(['parts','part_warehouse_stock','part_equipment','warehouses'].map((table)=>[table,f.rows(table)]));
    const otherBins=f.rows('part_warehouse_locations').filter((row)=>row.part_id!==1||row.warehouse_id!==1);
    const otherMinimums=f.rows('part_warehouse_minimums').filter((row)=>row.part_id!==1||row.warehouse_id!==1);
    const before=await f.settings();
    const result=await service.saveWarehousePartSettings(f.db,request(before,{binLocations:[' New shelf A ','New shelf B','New shelf A'],minimumQuantity:'7.5'}),1);
    assert.equal(result.ok,true);assert.equal(result.idempotent,false);
    assert.deepEqual(json(result.settings.binLocations),['New shelf A','New shelf B']);
    assert.equal(result.settings.minimumQuantity,7.5);assert.notEqual(result.settings.settingsVersion,before.settingsVersion);
    for(const [table,rows] of Object.entries(protectedBefore)) assert.deepEqual(f.rows(table),rows,table);
    assert.deepEqual(f.rows('part_warehouse_locations').filter((row)=>row.part_id!==1||row.warehouse_id!==1),otherBins);
    assert.deepEqual(f.rows('part_warehouse_minimums').filter((row)=>row.part_id!==1||row.warehouse_id!==1),otherMinimums);
    const bin=f.rows('part_warehouse_locations').find((row)=>row.part_id===1&&row.warehouse_id===1);
    assert.equal(bin.source,'manual');assert.equal(bin.source_updated_at,null);
    const audit=f.rows('inventory_operation_lines');assert.equal(audit.length,1);assert.equal(audit[0].quantity_delta,0);assert.equal(audit[0].warehouse_stock_id,null);
    assert.equal(f.rows('inventory_operation_commits')[0].applied,1);
    assert.equal(JSON.parse(f.rows('inventory_operations')[0].note).before.minimumQuantity,2);
  } finally { f.sqlite.close(); }
});

test('clearing a warehouse minimum uses the part default and does not change imported bin provenance', async () => {
  const f=fixture();
  try {
    const bins=f.rows('part_warehouse_locations');
    const result=await service.saveWarehousePartSettings(f.db,request(await f.settings(),{minimumQuantity:''}),1);
    assert.equal(result.settings.minimumQuantity,null);assert.equal(result.settings.defaultMinimum,4);
    assert.deepEqual(f.rows('part_warehouse_locations'),bins);
    assert.equal(f.rows('part_warehouse_minimums').find((row)=>row.part_id===1&&row.warehouse_id===2).minimum_quantity,9);
    assert.equal(f.rows('part_equipment').length,2);
  } finally { f.sqlite.close(); }
});

test('clearing bins is explicit and preserves minimum and stock values', async () => {
  const f=fixture();
  try {
    const minima=f.rows('part_warehouse_minimums');const stock=f.rows('part_warehouse_stock');
    const result=await service.saveWarehousePartSettings(f.db,request(await f.settings(),{binLocations:[]}),1);
    assert.equal(result.settings.binLocation,'');assert.deepEqual(json(result.settings.binLocations),[]);
    assert.deepEqual(f.rows('part_warehouse_minimums'),minima);assert.deepEqual(f.rows('part_warehouse_stock'),stock);
  } finally { f.sqlite.close(); }
});

test('a retry with the same key is idempotent and a key cannot be reused for other values or users', async () => {
  const f=fixture();
  try {
    const input=request(await f.settings(),{minimumQuantity:6});
    const first=await service.saveWarehousePartSettings(f.db,input,1);
    const repeat=await service.saveWarehousePartSettings(f.db,input,1);
    assert.equal(repeat.idempotent,true);assert.equal(repeat.operationId,first.operationId);
    assert.equal(f.rows('inventory_operations').length,1);
    await assert.rejects(service.saveWarehousePartSettings(f.db,{...input,minimumQuantity:8},1),(error)=>error.status===409);
    await assert.rejects(service.saveWarehousePartSettings(f.db,input,2),(error)=>error.status===409);
  } finally { f.sqlite.close(); }
});

test('a stale editor cannot overwrite a newer warehouse setting', async () => {
  const f=fixture();
  try {
    const old=await f.settings();
    await service.saveWarehousePartSettings(f.db,request(old,{minimumQuantity:6}),1);
    await assert.rejects(service.saveWarehousePartSettings(f.db,request(old,{binLocations:['Stale bin']}),1),(error)=>error.status===409);
    assert.equal((await f.settings()).minimumQuantity,6);assert.equal(f.rows('inventory_operations').length,1);
  } finally { f.sqlite.close(); }
});

test('atomic guard rolls back both writes and the audit if another editor changes settings between read and batch', async () => {
  const f=fixture();
  try {
    const old=await f.settings();
    f.race(()=>f.sqlite.exec("UPDATE part_warehouse_minimums SET minimum_quantity=11 WHERE part_id=1 AND warehouse_id=1"));
    await assert.rejects(service.saveWarehousePartSettings(f.db,request(old,{binLocations:['Would overwrite'],minimumQuantity:7}),1),(error)=>error.status===409);
    const after=await f.settings();assert.deepEqual(json(after.binLocations),json(old.binLocations));assert.equal(after.minimumQuantity,11);
    assert.equal(f.rows('inventory_operations').length,0);assert.equal(f.rows('inventory_operation_lines').length,0);assert.equal(f.rows('inventory_operation_commits').length,0);
  } finally { f.sqlite.close(); }
});

test('atomic guard also rejects an archived part or newly created bin row after preflight', async () => {
  for(const mutation of [
    "UPDATE parts SET active=0 WHERE id=1",
    "UPDATE warehouses SET active=0 WHERE id=1",
    "INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location) VALUES(1,1,'Concurrent bin')",
  ]) {
    const f=fixture();
    try {
      if(mutation.startsWith('INSERT')) f.sqlite.exec('DELETE FROM part_warehouse_locations WHERE part_id=1 AND warehouse_id=1');
      const input=request(await f.settings(),{binLocations:['My bin'],minimumQuantity:7});
      f.race(()=>f.sqlite.exec(mutation));
      await assert.rejects(service.saveWarehousePartSettings(f.db,input,1),(error)=>error.status===409);
      assert.equal(f.rows('inventory_operations').length,0);
      assert.equal(f.rows('part_warehouse_minimums').find((row)=>row.part_id===1&&row.warehouse_id===1).minimum_quantity,2);
    } finally { f.sqlite.close(); }
  }
});

test('a simultaneous stock movement is preserved while unrelated warehouse settings are saved', async () => {
  const f=fixture();
  try {
    const input=request(await f.settings(),{minimumQuantity:6});
    f.race(()=>f.sqlite.exec('UPDATE part_warehouse_stock SET quantity_on_hand=2 WHERE id=10'));
    const result=await service.saveWarehousePartSettings(f.db,input,1);
    assert.equal(result.settings.minimumQuantity,6);assert.equal(f.rows('part_warehouse_stock').find((row)=>row.id===10).quantity_on_hand,2);
    assert.equal(f.rows('inventory_operation_lines')[0].quantity_delta,0);
  } finally { f.sqlite.close(); }
});

test('invalid values and inactive or deleted scopes cannot write settings', async () => {
  const f=fixture();
  try {
    for(const args of [[3,'CLARE'],[4,'CLARE'],[6,'BOYNE'],[1,'ALL'],[1,'MISSING']]) {
      await assert.rejects(f.settings(...args));
    }
    const valid=request(await f.settings());
    for(const patch of [
      {minimumQuantity:-1},{minimumQuantity:Infinity},{minimumQuantity:true},{minimumQuantity:[]},{minimumQuantity:undefined},
      {binLocations:'not-an-array'},{binLocations:['line1\nline2']},{binLocations:['x'.repeat(513)]},{binLocations:[0]},
      {binLocations:Array(65).fill('A')},{settingsVersion:''},{operationKey:'other:save'},{partId:1.5},
    ]) await assert.rejects(service.saveWarehousePartSettings(f.db,{...valid,...patch},1));
    assert.equal(f.rows('inventory_operations').length,0);
  } finally { f.sqlite.close(); }
});

test('stockless active parts can save bins without changing counts; zero-stock initialization is explicit and audited', async () => {
  const f=fixture();
  try {
    const before=f.rows('part_warehouse_stock');
    const initial=await f.settings(5,'CLARE');
    assert.deepEqual(json(initial.binLocations),[]);
    const saved=await service.saveWarehousePartSettings(f.db,request(initial,{binLocations:['Shelf D / Bin 4'],minimumQuantity:2}),1);
    assert.equal(saved.ok,true);
    assert.deepEqual(f.rows('part_warehouse_stock'),before,'bin editing must never create stock');
    const initialized=await stockSetup.initializePartWarehouseStock(f.db,{
      partId:5,warehouseCode:'CLARE',userId:1,operationKey:'warehouse-stock-init:fixture-part5',
    });
    assert.equal(initialized.created,true);
    const row=f.rows('part_warehouse_stock').find(entry=>entry.part_id===5&&entry.warehouse_id===1);
    assert.equal(row.quantity_on_hand,0);
    assert.equal(f.rows('parts').find(entry=>entry.id===5).quantity_on_hand,0);
    assert.equal(f.rows('part_warehouse_locations').find(entry=>entry.part_id===5).bin_location,'Shelf D / Bin 4');
    const audit=f.rows('inventory_operation_lines').filter(entry=>entry.line_type==='warehouse_stock_initialized');
    assert.equal(audit.length,1);assert.equal(audit[0].quantity_delta,0);
    const replay=await stockSetup.initializePartWarehouseStock(f.db,{
      partId:5,warehouseCode:'CLARE',userId:1,operationKey:'warehouse-stock-init:repeat',
    });
    assert.equal(replay.created,false);
    assert.equal(f.rows('part_warehouse_stock').filter(entry=>entry.part_id===5).length,1);
  } finally {f.sqlite.close();}
});

test('route requires manager/admin access for both reads and writes before invoking data functions', async () => {
  for(const role of [null,'viewer','mechanic','manager','admin']) {
    let reads=0;let writes=0;
    const route=compile('app/api/inventory/warehouse-settings/route.ts',{
      'cloudflare:workers':{env:{DB:{}}},
      '@/lib/auth':{getSessionUser:async()=>role?{id:1,role}:null},
      '@/lib/inventory-warehouse-settings':{...service,
        getWarehousePartSettings:async()=>{reads++;return {ok:true};},
        saveWarehousePartSettings:async()=>{writes++;return {ok:true};},
      },
    });
    const get=await route.GET(new Request('https://example.test/api/inventory/warehouse-settings?partId=1&warehouseCode=CLARE'));
    const post=await route.POST(new Request('https://example.test/api/inventory/warehouse-settings',{method:'POST',body:'{}'}));
    const allowed=role==='manager'||role==='admin';const status=allowed?200:role?403:401;
    assert.equal(get.status,status);assert.equal(post.status,status);assert.equal(reads,allowed?1:0);assert.equal(writes,allowed?1:0);
    assert.equal(get.headers.get('cache-control'),'no-store');
  }
});
