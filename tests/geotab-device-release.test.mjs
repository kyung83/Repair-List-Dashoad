import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { releaseGeotabDevice, searchGeotabReleaseLinks } from '../lib/geotab-device-release.js';

const admin = { id: 7, role: 'admin', dispatchAccess: false };
const migration = readFileSync(new URL('../migrations/0154_geotab_device_release_audit.sql', import.meta.url), 'utf8');

function fixture({ current = true, active = false, otherOwner = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT,vin TEXT,active INTEGER,
      archived_at TEXT,geotab_device_id TEXT,merged_into_equipment_id INTEGER,
      current_mileage INTEGER,service_date TEXT,notes TEXT,updated_at TEXT);
    CREATE TABLE equipment_geotab_devices(id INTEGER PRIMARY KEY,equipment_id INTEGER REFERENCES equipment(id),
      geotab_device_id TEXT,current INTEGER,assigned_at TEXT,ended_at TEXT,last_seen_at TEXT,
      serial_number TEXT,linked_by TEXT);
    CREATE UNIQUE INDEX current_device ON equipment_geotab_devices(geotab_device_id) WHERE current=1;
    CREATE UNIQUE INDEX current_equipment ON equipment_geotab_devices(equipment_id) WHERE current=1;
    CREATE TABLE repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,description TEXT);
    CREATE TABLE maintenance_events(id INTEGER PRIMARY KEY,equipment_id INTEGER,description TEXT);
    CREATE TABLE fleet_truck_sales(equipment_id INTEGER PRIMARY KEY,sale_status TEXT,sale_price REAL);
    INSERT INTO equipment VALUES(480,'480(SC)','OLD-VIN',0,'2026-10-20','bReused',NULL,712345,'2026-09-01','Keep original', 'before');
    INSERT INTO equipment VALUES(678,'678(SC)','NEW-VIN',1,NULL,NULL,NULL,1234,'2026-11-01','New truck','before');
    INSERT INTO repairs VALUES(1,480,'Old engine repair');
    INSERT INTO maintenance_events VALUES(1,480,'Old PM');
    INSERT INTO fleet_truck_sales VALUES(480,'sold',25000);
  `);
  sqlite.exec(migration);
  sqlite.prepare(`INSERT INTO equipment_geotab_devices VALUES(10,480,'bReused',?,'2026-01-01',?,'2026-10-20','SERIAL-480','original')`)
    .run(current ? 1 : 0, current ? null : '2026-10-20');
  if (active) sqlite.exec("UPDATE equipment SET active=1, archived_at=NULL WHERE id=480");
  if (otherOwner) sqlite.exec("INSERT INTO equipment_geotab_devices VALUES(11,678,'bReused',1,'2026-11-01',NULL,'2026-11-01','SERIAL-480','new'); UPDATE equipment SET geotab_device_id='bReused' WHERE id=678");
  const db = {
    beforeBatch: null, failAt: -1,
    prepare(sql) {
      return { sql, values: [], bind(...values) { return { ...this, values }; },
        async first() { return sqlite.prepare(this.sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; },
      };
    },
    async batch(statements) {
      if (db.beforeBatch) db.beforeBatch();
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement, i) => {
          if (i === db.failAt) throw new Error('forced database failure');
          return { results: sqlite.prepare(statement.sql).all(...statement.values) };
        });
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const get = (table, id = 480) => ({...sqlite.prepare(`SELECT * FROM ${table} WHERE ${table==='equipment'?'id':'equipment_id'}=?`).get(id)});
  const history = () => JSON.stringify(['repairs','maintenance_events','fleet_truck_sales'].map(table => sqlite.prepare(`SELECT * FROM ${table}`).all()));
  async function request() {
    const [row] = await searchGeotabReleaseLinks(db, admin, '480(SC)');
    return { equipmentId:480, geotabDeviceId:row.deviceId, expectedVersion:row.expectedVersion, confirmedRemoved:true };
  }
  return { sqlite,db,get,history,request };
}

test('release 480 current GPS, retain history/odometer/status, allow independent reuse on 678', async () => {
  const f=fixture(), before=f.get('equipment'), history=f.history();
  const result=await releaseGeotabDevice(f.db,admin,await f.request());
  assert.equal(result.ok,true);
  const after=f.get('equipment');
  assert.equal(after.geotab_device_id,null);
  for (const key of Object.keys(before).filter(k=>!['geotab_device_id','updated_at'].includes(k))) assert.equal(after[key],before[key],key);
  assert.equal(f.history(),history);
  const old=f.sqlite.prepare('SELECT * FROM equipment_geotab_devices WHERE id=10').get();
  assert.equal(old.current,0); assert.ok(old.ended_at); assert.equal(old.assigned_at,'2026-01-01');
  assert.equal(old.last_seen_at,'2026-10-20'); assert.equal(old.linked_by,'original');
  f.sqlite.exec("INSERT INTO equipment_geotab_devices VALUES(11,678,'bReused',1,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,'SERIAL-480','new')");
  assert.equal(f.get('equipment',678).current_mileage,1234);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM geotab_device_release_events').get().n,1);
});

test('sold unit with ended assignment and legacy-only link is searchable and releasable',async()=>{
  const f=fixture({current:false}); const before={...f.sqlite.prepare('SELECT * FROM equipment_geotab_devices WHERE id=10').get()};
  const rows=await searchGeotabReleaseLinks(f.db,admin,'480'); assert.equal(rows[0].legacyOnly,true);
  await releaseGeotabDevice(f.db,admin,await f.request());
  assert.equal(f.get('equipment').geotab_device_id,null);
  assert.deepEqual({...f.sqlite.prepare('SELECT * FROM equipment_geotab_devices WHERE id=10').get()},before);
  assert.equal((await searchGeotabReleaseLinks(f.db,admin,'480')).length,0);
});

test('cleaning sold 480 does not detach already-reused GPS from 678',async()=>{
  const f=fixture({current:false,otherOwner:true}), before=f.get('equipment',678);
  const result=await releaseGeotabDevice(f.db,admin,await f.request());
  assert.equal(result.alreadyAssignedTo,'678(SC)');
  assert.deepEqual(f.get('equipment',678),before);
  assert.equal(f.sqlite.prepare('SELECT current FROM equipment_geotab_devices WHERE id=11').get().current,1);
});

test('explicit release from active unit does not archive or alter the unit',async()=>{
  const f=fixture({active:true}); await releaseGeotabDevice(f.db,admin,await f.request());
  assert.equal(f.get('equipment').active,1); assert.equal(f.get('equipment').archived_at,null);
});

test('conflicting current and legacy pointers cannot release the wrong device',async()=>{
  const f=fixture(); f.sqlite.exec("UPDATE equipment SET geotab_device_id='bOther' WHERE id=480");
  await assert.rejects(releaseGeotabDevice(f.db,admin,await f.request()),/conflicting/);
  assert.equal(f.sqlite.prepare('SELECT current FROM equipment_geotab_devices WHERE id=10').get().current,1);
});

test('stale form rejected before changing any record',async()=>{
  const f=fixture(), body=await f.request(); f.sqlite.exec("UPDATE equipment SET unit='480 OLD' WHERE id=480");
  await assert.rejects(releaseGeotabDevice(f.db,admin,body),/assignment changed/);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM geotab_device_release_events').get().n,0);
});

test('concurrent reassignment after validation rolls back release audit and all writes',async()=>{
  const f=fixture(), body=await f.request();
  f.db.beforeBatch=()=>f.sqlite.exec("UPDATE equipment_geotab_devices SET current=0 WHERE id=10; INSERT INTO equipment_geotab_devices VALUES(12,480,'bNew',1,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,'OTHER','new'); UPDATE equipment SET geotab_device_id='bNew' WHERE id=480");
  await assert.rejects(releaseGeotabDevice(f.db,admin,body),/Nothing was changed/);
  assert.equal(f.get('equipment').geotab_device_id,'bNew');
  assert.equal(f.sqlite.prepare('SELECT current FROM equipment_geotab_devices WHERE id=12').get().current,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM geotab_device_release_events').get().n,0);
});

test('database failure does not leave partially released GPS',async()=>{
  const f=fixture(), body=await f.request(); f.db.failAt=2;
  await assert.rejects(releaseGeotabDevice(f.db,admin,body),/forced database failure/);
  assert.equal(f.get('equipment').geotab_device_id,'bReused');
  assert.equal(f.sqlite.prepare('SELECT current FROM equipment_geotab_devices WHERE id=10').get().current,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM geotab_device_release_events').get().n,0);
});

test('only non-dispatch admins can search or release GPS',async()=>{
  const f=fixture(), body=await f.request();
  for(const user of [null,{id:8,role:'manager'},{id:8,role:'mechanic'},{...admin,dispatchAccess:true}]){
    await assert.rejects(searchGeotabReleaseLinks(f.db,user,'480'),/required/);
    await assert.rejects(releaseGeotabDevice(f.db,user,body),/required/);
  }
});

test('confirmation and identifiers validated',async()=>{
  const f=fixture(), body=await f.request();
  for(const patch of [{confirmedRemoved:false},{equipmentId:0},{geotabDeviceId:'invalid device'},{expectedVersion:'stale'}]) {
    await assert.rejects(releaseGeotabDevice(f.db,admin,{...body,...patch}));
  }
  assert.equal(f.get('equipment').geotab_device_id,'bReused');
});

test('current assignment without legacy pointer is releasable',async()=>{
  const f=fixture(); f.sqlite.exec('UPDATE equipment SET geotab_device_id=NULL WHERE id=480');
  await releaseGeotabDevice(f.db,admin,await f.request());
  assert.equal(f.sqlite.prepare('SELECT current FROM equipment_geotab_devices WHERE id=10').get().current,0);
});

test('merged tombstones excluded and unknown or already released equipment rejected',async()=>{
  const f=fixture(), body=await f.request();
  f.sqlite.exec('UPDATE equipment SET merged_into_equipment_id=678 WHERE id=480');
  assert.equal((await searchGeotabReleaseLinks(f.db,admin,'480')).length,0);
  await assert.rejects(releaseGeotabDevice(f.db,admin,body),/not found or has been merged/);
  await assert.rejects(releaseGeotabDevice(f.db,admin,{...body,equipmentId:9999}),/not found/);
});

test('migration is repeatable and deployment never changes a truck',()=>{
  const f=fixture(), before=f.get('equipment'); f.sqlite.exec(migration);
  assert.deepEqual(f.get('equipment'),before);
});
