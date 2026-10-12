import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const migration = source('migrations/0151_correct_historical_ro_costs_20261012.sql');

function originalTestDatabase(badTotal = false) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE equipment (id INTEGER PRIMARY KEY, unit TEXT NOT NULL);');
  db.exec('CREATE TABLE historical_repairs (id INTEGER PRIMARY KEY,import_key TEXT NOT NULL,ro_number TEXT NOT NULL,equipment_id INTEGER NOT NULL,ro_date TEXT NOT NULL,source_status TEXT NOT NULL,labor_hours REAL NOT NULL,labor_cost REAL NOT NULL,parts_cost REAL NOT NULL,sublet_cost REAL NOT NULL,total_cost REAL NOT NULL,line_count INTEGER NOT NULL);');
  db.exec('CREATE TABLE historical_repair_lines (id INTEGER PRIMARY KEY,historical_repair_id INTEGER NOT NULL,import_key TEXT NOT NULL,ro_number TEXT NOT NULL,system_code TEXT NOT NULL,assembly_code TEXT NOT NULL,labor_cost REAL NOT NULL,parts_cost REAL NOT NULL,sublet_cost REAL NOT NULL,total_cost REAL NOT NULL);');
  db.exec("INSERT INTO equipment (id,unit) VALUES (1,'324(DC)'),(2,'373(DC)');");
  const addHeader = db.prepare('INSERT INTO historical_repairs (id,import_key,ro_number,equipment_id,ro_date,source_status,labor_hours,labor_cost,parts_cost,sublet_cost,total_cost,line_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const addLine = db.prepare('INSERT INTO historical_repair_lines (id,historical_repair_id,import_key,ro_number,system_code,assembly_code,labor_cost,parts_cost,sublet_cost,total_cost) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const key = 'ro-history-9309499-v1';
  addHeader.run(101,key,'WO085385',1,'2026-01-12','CLOSED',1.5,60,63479.66,0,badTotal?63539.65:63539.66,1);
  addLine.run(201,101,key,'WO085385','043','007',60,63479.66,0,63539.66);
  addHeader.run(102,key,'WO086883',2,'2026-02-23','CLOSED',11.5,460,95989.46,0,96449.46,1);
  addLine.run(202,102,key,'WO086883','033','000',460,95989.46,0,96449.46);
  return db;
}

test('migration corrects exactly the two authorized total amounts and both detail lines', () => {
  const db = originalTestDatabase();
  db.exec(migration);
  const rows = db.prepare('SELECT ro_number,labor_cost,parts_cost,total_cost FROM historical_repairs ORDER BY ro_number').all();
  assert.deepEqual(rows.map((r) => [r.ro_number,r.parts_cost,r.labor_cost,r.total_cost]), [
    ['WO085385',573,60,633],
    ['WO086883',5544.53,460,6004.53],
  ]);
  const details = db.prepare('SELECT ro_number,labor_cost,parts_cost,total_cost FROM historical_repair_lines ORDER BY ro_number').all();
  assert.deepEqual(details.map((r) => [r.ro_number,r.parts_cost,r.labor_cost,r.total_cost]), [
    ['WO085385',573,60,633], ['WO086883',5544.53,460,6004.53],
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historical_ro_cost_corrections').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM historical_ro_cost_change_log').get().n,2);
  assert.equal(db.prepare("SELECT original_total_cost FROM historical_ro_cost_corrections WHERE ro_number='WO085385'").get().original_total_cost,63539.66);
  assert.equal(db.prepare("SELECT original_total_cost FROM historical_ro_cost_corrections WHERE ro_number='WO086883'").get().original_total_cost,96449.46);
  db.close();
});

test('migration rejects changed source charges before touching either parent RO', () => {
  const db = originalTestDatabase(true);
  assert.throws(() => db.exec(migration), /CHECK constraint failed/);
  const first = db.prepare("SELECT total_cost FROM historical_repairs WHERE ro_number='WO085385'").get();
  const second = db.prepare("SELECT total_cost FROM historical_repairs WHERE ro_number='WO086883'").get();
  assert.equal(first.total_cost,63539.65);
  assert.equal(second.total_cost,96449.46);
  db.close();
});


test('indexed migration can safely retry after a partial D1 application', () => {
  const db = originalTestDatabase();
  db.exec("UPDATE historical_repair_lines SET parts_cost=573,total_cost=633 WHERE ro_number='WO085385'");
  // Wrangler records successful migrations; recovery must handle a partial failed attempt.
  db.exec(migration);
  const heads = db.prepare('SELECT ro_number,total_cost FROM historical_repairs ORDER BY ro_number').all();
  const detail = db.prepare('SELECT ro_number,total_cost FROM historical_repair_lines ORDER BY ro_number').all();
  assert.deepEqual(heads.map((x) => x.total_cost), [633,6004.53]);
  assert.deepEqual(detail.map((x) => x.total_cost), [633,6004.53]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM historical_ro_cost_change_log").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM historical_ro_cost_corrections").get().n, 2);
  db.close();
});

test('migration updates existing ROs only using indexed, exact RO predicates', () => {
  assert.match(migration, /WHERE import_key='ro-history-9309499-v1' AND ro_number IN \('WO085385','WO086883'\)/);
  assert.doesNotMatch(migration, /UPDATE historical_repair_lines[\s\S]*WHERE EXISTS \(/);
});

test('editable historical cost API is manager-only, guarded and auditable', () => {
  const api = source('app/api/reports/history/cost-corrections/route.ts');
  const service = source('lib/historical-ro-cost-corrections.ts');
  const importer = source('lib/history-import.ts');
  const editor = source('app/reports/history/historical-ro-cost-editor.tsx');
  const page = source('app/reports/history/page.tsx');
  const main = source('app/reports/page.tsx');
  assert.match(api,/user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(api,/getSessionUser/);
  assert.match(api,/correctHistoricalRoTotal/);
  assert.match(service,/expectedTotalCost/);
  assert.match(service,/historical_ro_cost_change_log/);
  assert.match(service,/guard_verified/);
  assert.match(service,/await db\.batch\(statements\)/);
  assert.match(service,/allocateHistoricalParts/);
  assert.match(service,/Corrected total must cover|Corrected total must/);
  assert.match(editor,/Corrected TOTAL including labor/);
  assert.match(editor,/Reason for correction/);
  assert.match(editor,/Correction history/);
  assert.match(page,/HistoricalRoCostEditor/);
  assert.match(main,/Correct Historical RO Costs/);
  assert.match(importer,/corrected_parts_cost/);
  assert.match(importer,/allocateHistoricalParts/);
});
