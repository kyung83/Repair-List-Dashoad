import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, modules = {}) {
  const result = ts.transpileModule(read(path), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length || 0, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, Error, Date, JSON, URL, URLSearchParams, Request, Response,
    console: { error() {} },
    require(name) { assert.ok(name in modules, name); return modules[name]; },
  }, { filename: path });
  return exports;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE equipment(
      id INTEGER PRIMARY KEY,
      unit TEXT NOT NULL,
      equipment_type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT
    );
    CREATE TABLE repairs(
      id INTEGER PRIMARY KEY,
      equipment_id INTEGER NOT NULL,
      updated_at TEXT,
      source TEXT NOT NULL DEFAULT 'roadside-breakdown',
      outside_cost REAL DEFAULT 0
    );
    CREATE TABLE repair_job_events(id INTEGER PRIMARY KEY,repair_id INTEGER,user_id INTEGER,technician_id INTEGER,action TEXT,detail TEXT);
    CREATE TABLE roadside_breakdown_receipts(id INTEGER PRIMARY KEY,breakdown_id INTEGER,object_key TEXT);
    CREATE TABLE roadside_breakdown_tires(id INTEGER PRIMARY KEY,breakdown_id INTEGER,position_code TEXT,tire_size TEXT);
    CREATE TABLE roadside_breakdowns(
      id INTEGER PRIMARY KEY,
      repair_id INTEGER NOT NULL,
      equipment_id INTEGER NOT NULL,
      stage INTEGER NOT NULL,
      snapshot_source TEXT,
      geotab_driver_id TEXT,
      driver_observed_at TEXT,
      geotab_device_id TEXT,
      latitude REAL,
      longitude REAL,
      gps_observed_at TEXT,
      gps_source TEXT,
      snapshot_captured_at TEXT,
      updated_at TEXT
    );
    INSERT INTO equipment VALUES
      (1,'TRL 211','trailer',1,NULL),
      (2,'53027','trailer',1,NULL),
      (3,'TRL 53028','trailer',1,NULL),
      (4,'TRAILER 53028','trailer',1,NULL),
      (5,'211','truck',1,NULL),
      (6,'99999','trailer',0,NULL),
      (7,'227(DC)','truck',1,NULL),
      (8,'228(DC)','truck',1,NULL),
      (9,'229(DC)','truck',1,NULL),
      (10,'229(BT)','truck',1,NULL),
      (11,'999(DC)','truck',0,NULL);
    INSERT INTO repairs(id,equipment_id,updated_at,outside_cost) VALUES
      (101,1,'2026-10-08 08:00:00',476.52),
      (102,1,'2026-10-08 08:00:00',155.01),
      (103,7,'2026-10-08 08:00:00',300.05),
      (104,7,'2026-10-08 08:00:00',845.90);
    INSERT INTO roadside_breakdown_receipts VALUES(1,10,'receipts/10.pdf');
    INSERT INTO roadside_breakdown_tires VALUES(1,10,'A2LO','295/75R22.5');
    INSERT INTO roadside_breakdowns
      (id,repair_id,equipment_id,stage,snapshot_source,geotab_driver_id,driver_observed_at,geotab_device_id,latitude,longitude,gps_observed_at,gps_source,snapshot_captured_at,updated_at)
    VALUES
      (10,101,1,2,'geotab','driver1','2026-10-08','device1',44.0,-84.0,'2026-10-08','DeviceStatusInfo','2026-10-08','2026-10-08'),
      (11,102,1,5,'manual',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-08'),
      (12,103,7,2,'geotab','driver2','2026-10-08','device2',43.0,-85.0,'2026-10-08','DeviceStatusInfo','2026-10-08','2026-10-08'),
      (13,104,7,5,'manual',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-08');
  `);
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql); let binds = [];
      return {
        bind(...values) { binds = values; return this; },
        async first() { return stmt.get(...binds) || null; },
        async all() { return { results: stmt.all(...binds) }; },
        async run() { const result = stmt.run(...binds); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function request(id, body) {
  return new Request(`https://test.invalid/api/breakdowns/${id}/unit`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('dispatch can correct an active trailer and linked repair follows the corrected equipment', async () => {
  const f = fixture(); let user = { role: 'dispatch', id: 10 };
  try {
    const route = compile('app/api/breakdowns/[id]/unit/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } },
      '@/lib/auth': { getSessionUser: async () => user },
    });
    const response = await route.PATCH(request(10, { unitNumber: '53027' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.changed, true);
    assert.equal(payload.unitType, 'trailer');
    assert.equal(payload.previousUnitNumber, 'TRL 211');
    assert.equal(payload.unitNumber, '53027');

    const breakdown = f.sqlite.prepare('SELECT * FROM roadside_breakdowns WHERE id=10').get();
    const repair = f.sqlite.prepare('SELECT * FROM repairs WHERE id=101').get();
    assert.equal(breakdown.equipment_id, 2);
    assert.equal(repair.equipment_id, 2);
    assert.equal(repair.outside_cost, 476.52);
    const audit = f.sqlite.prepare("SELECT * FROM repair_job_events WHERE action='breakdown_equipment_corrected'").get();
    assert.equal(audit.user_id, 10);
    assert.match(audit.detail, /Trailer TRL 211 to Trailer 53027/);
    assert.equal(f.sqlite.prepare('SELECT object_key FROM roadside_breakdown_receipts WHERE breakdown_id=10').get().object_key, 'receipts/10.pdf');
    assert.equal(f.sqlite.prepare('SELECT position_code FROM roadside_breakdown_tires WHERE breakdown_id=10').get().position_code,'A2LO');
    assert.equal(breakdown.snapshot_source, 'unit-corrected');
    assert.equal(breakdown.geotab_driver_id, null);
    assert.equal(breakdown.geotab_device_id, null);

    user = { role: 'viewer', id: 10 };
    assert.equal((await route.PATCH(request(10, { unitNumber: 'TRL 211' }), { params: Promise.resolve({ id: '10' }) })).status, 400);
  } finally { f.sqlite.close(); }
});

test('dispatch can correct a truck by road number even when Master Equipment includes a suffix', async () => {
  const f = fixture();
  try {
    const route = compile('app/api/breakdowns/[id]/unit/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } },
      '@/lib/auth': { getSessionUser: async () => ({ role: 'dispatch', id: 10 }) },
    });
    const response = await route.PATCH(request(12, { unitNumber: '228' }), { params: Promise.resolve({ id: '12' }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.changed, true);
    assert.equal(payload.unitType, 'truck');
    assert.equal(payload.previousUnitNumber, '227(DC)');
    assert.equal(payload.unitNumber, '228(DC)');

    const breakdown = f.sqlite.prepare('SELECT * FROM roadside_breakdowns WHERE id=12').get();
    const repair = f.sqlite.prepare('SELECT * FROM repairs WHERE id=103').get();
    assert.equal(breakdown.equipment_id, 8);
    assert.equal(repair.equipment_id, 8);
    assert.equal(breakdown.snapshot_source, 'unit-corrected');
    assert.equal(breakdown.geotab_driver_id, null);
    assert.equal(breakdown.latitude, null);
    assert.equal(breakdown.longitude, null);
  } finally { f.sqlite.close(); }
});

test('unit correction refuses ambiguous, inactive, completed, and unsafe targets', async () => {
  const f = fixture();
  try {
    const route = compile('app/api/breakdowns/[id]/unit/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } },
      '@/lib/auth': { getSessionUser: async () => ({ role: 'manager', id: 11 }) },
    });

    const sameTrailer = await route.PATCH(request(10, { trailerNumber: '211' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(sameTrailer.status, 200);
    assert.equal((await sameTrailer.json()).changed, false);

    const sameTruck = await route.PATCH(request(12, { unitNumber: '227' }), { params: Promise.resolve({ id: '12' }) });
    assert.equal(sameTruck.status, 200);
    assert.equal((await sameTruck.json()).changed, false);

    const ambiguousTrailer = await route.PATCH(request(10, { unitNumber: '53028' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(ambiguousTrailer.status, 400);
    assert.match((await ambiguousTrailer.json()).error, /more than one active equipment record/i);

    const ambiguousTruck = await route.PATCH(request(12, { unitNumber: '229' }), { params: Promise.resolve({ id: '12' }) });
    assert.equal(ambiguousTruck.status, 400);
    assert.match((await ambiguousTruck.json()).error, /more than one active equipment record/i);

    const inactiveTrailer = await route.PATCH(request(10, { unitNumber: '99999' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(inactiveTrailer.status, 400);
    assert.match((await inactiveTrailer.json()).error, /not found in active equipment/i);

    const inactiveTruck = await route.PATCH(request(12, { unitNumber: '999' }), { params: Promise.resolve({ id: '12' }) });
    assert.equal(inactiveTruck.status, 400);
    assert.match((await inactiveTruck.json()).error, /not found in active equipment/i);

    const completedTrailer = await route.PATCH(request(11, { unitType:'truck',unitNumber: '228' }), { params: Promise.resolve({ id: '11' }) });
    assert.equal(completedTrailer.status, 200);
    assert.equal((await completedTrailer.json()).unitType,'truck');
    assert.equal(f.sqlite.prepare('SELECT equipment_id FROM repairs WHERE id=102').get().equipment_id,8);

    const completedTruck = await route.PATCH(request(13, { unitType:'trailer',unitNumber: '53027' }), { params: Promise.resolve({ id: '13' }) });
    assert.equal(completedTruck.status, 200);
    assert.equal((await completedTruck.json()).unitType,'trailer');
    assert.equal(f.sqlite.prepare('SELECT equipment_id FROM repairs WHERE id=104').get().equipment_id,2);
  } finally { f.sqlite.close(); }
});

test('office breakdowns and completed reports expose Truck/Trailer selection and preserve correction history',()=>{
  const page=read('app/breakdowns/page.tsx');
  const editor=read('app/reports/breakdowns/edit-breakdown-button.tsx');
  const completedRoute=read('app/api/reports/breakdowns/[id]/route.ts');
  assert.match(page,/Change Truck \/ Trailer/);
  assert.match(page,/Correct affected equipment type/);
  assert.match(page,/<option value="truck">Truck<\/option>/);
  assert.match(page,/<option value="trailer">Trailer<\/option>/);
  assert.match(page,/body:JSON.stringify\(\{unitType:newType,unitNumber:next\}\)/);
  assert.match(page,/Review the original reported tire positions/);
  assert.match(editor,/Correct Truck \/ Trailer/);
  assert.match(editor,/Save Correct Equipment/);
  assert.match(editor,/unitType:equipmentTypeDraft,unitNumber:next/);
  assert.match(completedRoute,/equipmentType: row.equipment_type/);
  assert.match(page,/Linked repair and costs moved with it/);
});
