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
      updated_at TEXT
    );
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
    INSERT INTO repairs VALUES
      (101,1,'2026-10-08 08:00:00'),
      (102,1,'2026-10-08 08:00:00'),
      (103,7,'2026-10-08 08:00:00'),
      (104,7,'2026-10-08 08:00:00');
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
  const f = fixture(); let user = { role: 'dispatch' };
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
    assert.equal(breakdown.snapshot_source, 'unit-corrected');
    assert.equal(breakdown.geotab_driver_id, null);
    assert.equal(breakdown.geotab_device_id, null);

    user = { role: 'viewer' };
    assert.equal((await route.PATCH(request(10, { unitNumber: 'TRL 211' }), { params: Promise.resolve({ id: '10' }) })).status, 400);
  } finally { f.sqlite.close(); }
});

test('dispatch can correct a truck by road number even when Master Equipment includes a suffix', async () => {
  const f = fixture();
  try {
    const route = compile('app/api/breakdowns/[id]/unit/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } },
      '@/lib/auth': { getSessionUser: async () => ({ role: 'dispatch' }) },
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
      '@/lib/auth': { getSessionUser: async () => ({ role: 'manager' }) },
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

    const completedTrailer = await route.PATCH(request(11, { unitNumber: '53027' }), { params: Promise.resolve({ id: '11' }) });
    assert.equal(completedTrailer.status, 400);
    assert.match((await completedTrailer.json()).error, /Completed breakdowns cannot be moved/i);

    const completedTruck = await route.PATCH(request(13, { unitNumber: '228' }), { params: Promise.resolve({ id: '13' }) });
    assert.equal(completedTruck.status, 400);
    assert.match((await completedTruck.json()).error, /Completed breakdowns cannot be moved/i);
  } finally { f.sqlite.close(); }
});

test('dispatch breakdown detail exposes truck and trailer correction from the same control', () => {
  const page = read('app/breakdowns/page.tsx');
  assert.match(page, /const correctionName=correctionType==='trailer'\?'Trailer':'Truck'/);
  assert.match(page, /Change \{correctionName\} #/);
  assert.match(page, /Save Correct \$\{correctionName\}/);
  assert.match(page, /body:JSON\.stringify\(\{unitNumber:next\}\)/);
  assert.match(page, /Linked repair and costs moved with it/);
});
