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
      (6,'99999','trailer',0,NULL);
    INSERT INTO repairs VALUES(101,1,'2026-10-08 08:00:00'),(102,1,'2026-10-08 08:00:00');
    INSERT INTO roadside_breakdowns VALUES
      (10,101,1,2,'geotab','driver1','2026-10-08','device1',44.0,-84.0,'2026-10-08','DeviceStatusInfo','2026-10-08','2026-10-08'),
      (11,102,1,5,'manual',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-08');
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

function request(body) {
  return new Request('https://test.invalid/api/breakdowns/10/unit', {
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
    const response = await route.PATCH(request({ trailerNumber: '53027' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.changed, true);
    assert.equal(payload.previousTrailerNumber, 'TRL 211');
    assert.equal(payload.trailerNumber, '53027');

    const breakdown = f.sqlite.prepare('SELECT * FROM roadside_breakdowns WHERE id=10').get();
    const repair = f.sqlite.prepare('SELECT * FROM repairs WHERE id=101').get();
    assert.equal(breakdown.equipment_id, 2);
    assert.equal(repair.equipment_id, 2);
    assert.equal(breakdown.snapshot_source, 'unit-corrected');
    assert.equal(breakdown.geotab_driver_id, null);
    assert.equal(breakdown.geotab_device_id, null);
    assert.equal(breakdown.latitude, null);
    assert.equal(breakdown.longitude, null);

    user = { role: 'viewer' };
    assert.equal((await route.PATCH(request({ trailerNumber: 'TRL 211' }), { params: Promise.resolve({ id: '10' }) })).status, 400);
  } finally { f.sqlite.close(); }
});

test('trailer correction accepts numeric or TRL forms but refuses ambiguous, inactive, completed, and truck targets', async () => {
  const f = fixture();
  try {
    const route = compile('app/api/breakdowns/[id]/unit/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } },
      '@/lib/auth': { getSessionUser: async () => ({ role: 'manager' }) },
    });

    const same = await route.PATCH(request({ trailerNumber: '211' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(same.status, 200);
    assert.equal((await same.json()).changed, false);

    const ambiguous = await route.PATCH(request({ trailerNumber: '53028' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(ambiguous.status, 400);
    assert.match((await ambiguous.json()).error, /more than one active equipment record/i);

    const inactive = await route.PATCH(request({ trailerNumber: '99999' }), { params: Promise.resolve({ id: '10' }) });
    assert.equal(inactive.status, 400);
    assert.match((await inactive.json()).error, /not found in active equipment/i);

    const completed = await route.PATCH(request({ trailerNumber: '53027' }), { params: Promise.resolve({ id: '11' }) });
    assert.equal(completed.status, 400);
    assert.match((await completed.json()).error, /Completed breakdowns cannot be moved/i);
  } finally { f.sqlite.close(); }
});

test('dispatch breakdown detail exposes an explicit trailer correction control', () => {
  const page = read('app/breakdowns/page.tsx');
  assert.match(page, /Change Trailer #/);
  assert.match(page, /Save Correct Trailer/);
  assert.match(page, /\/api\/breakdowns\/\$\{row\.id\}\/unit/);
  assert.match(page, /Linked repair and costs moved with it/);
});
