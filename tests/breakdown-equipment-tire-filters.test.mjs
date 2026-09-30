import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import * as helpers from '../lib/breakdown-report-filters.js';

function compile(path, modules, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, Date, JSON, RangeError, Error, URL, URLSearchParams, Request, Response, Blob,
    console: { error() {} },
    require(name) { if (!(name in modules)) throw new Error(`Unexpected import ${name}`); return modules[name]; },
    ...globals,
  }, { filename: path });
  return exports;
}

const service = compile('lib/breakdown-reports.ts', { './breakdown-report-filters.js': helpers });
const range = { startDate: '2026-09-01', endDate: '2026-09-30' };

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE equipment(id INTEGER PRIMARY KEY, unit TEXT, equipment_type TEXT);
    CREATE TABLE repairs(id INTEGER PRIMARY KEY, completed_at TEXT, labor_hours REAL, labor_rate REAL, outside_cost REAL);
    CREATE TABLE parts(id INTEGER PRIMARY KEY, unit_cost REAL);
    CREATE TABLE repair_parts(repair_id INTEGER, part_id INTEGER, quantity REAL, unit_cost REAL);
    CREATE TABLE breakdown_categories(name TEXT, active INTEGER, sort_order INTEGER);
    CREATE TABLE roadside_breakdowns(
      id INTEGER PRIMARY KEY, repair_id INTEGER, equipment_id INTEGER, associated_truck_equipment_id INTEGER,
      driver_name TEXT, repair_category TEXT, repair_needed TEXT, description TEXT, status TEXT, stage INTEGER,
      service_provider TEXT, city TEXT, state TEXT, created_at TEXT, claimed_at TEXT, tech_arrived_at TEXT,
      on_location_at TEXT, repair_finished_at TEXT, rolling_at TEXT
    );
    CREATE TABLE roadside_breakdown_tires(breakdown_id INTEGER, repair_id INTEGER, position_code TEXT, tire_size TEXT);
    CREATE INDEX tire_lookup ON roadside_breakdown_tires(breakdown_id,position_code);
    INSERT INTO equipment VALUES(1,'T-TEST1','truck'),(2,'TR-TEST2','trailer'),(3,'OTHER-TEST','other'),(4,'OLD-TEST',' Truck ');
    INSERT INTO breakdown_categories VALUES('Tires',1,1),('Brake Chambers',1,2);
    INSERT INTO repairs VALUES(101,'2026-09-01 10:00:00',1,50,100),(102,'2026-09-01 10:00:00',0,0,300),(103,'2026-09-01 10:00:00',0,0,25),(104,'2026-09-01 10:00:00',0,0,40),(105,'2026-09-01 10:00:00',0,0,80);
    INSERT INTO parts VALUES(1,25);
    INSERT INTO repair_parts VALUES(101,1,2,NULL);
    INSERT INTO roadside_breakdowns VALUES
      (1,101,1,NULL,'Test Driver','Tires','Tires','Two tires','completed',5,'Vendor A','Clare','MI','2026-09-01 08:00:00','2026-09-01 08:15:00','2026-09-01 09:00:00',NULL,'2026-09-01 10:00:00','2026-09-01 10:00:00'),
      (2,102,2,1,'Test Driver','Tires','Tires','Trailer tire','completed',5,'Vendor B','Clare','MI','2026-09-01 08:00:00','2026-09-01 08:15:00','2026-09-01 09:00:00',NULL,'2026-09-01 10:00:00','2026-09-01 10:00:00'),
      (3,103,3,NULL,'Test Driver','Other','Other','Other equipment','completed',5,'Vendor A','Clare','MI','2026-09-01 08:00:00','2026-09-01 08:15:00','2026-09-01 09:00:00',NULL,'2026-09-01 10:00:00','2026-09-01 10:00:00'),
      (4,104,1,NULL,'Test Driver','Tires','Brake Chambers','Office corrected category','completed',5,'Vendor A','Clare','MI','2026-09-01 08:00:00','2026-09-01 08:15:00','2026-09-01 09:00:00',NULL,'2026-09-01 10:00:00','2026-09-01 10:00:00'),
      (5,105,4,NULL,'Test Driver','Tires',NULL,'Legacy text says A2RO but no structured position','completed',5,'Vendor A','Clare','MI','2026-09-01 08:00:00','2026-09-01 08:15:00','2026-09-01 09:00:00',NULL,'2026-09-01 10:00:00','2026-09-01 10:00:00');
    INSERT INTO roadside_breakdown_tires VALUES(1,101,'A2RO','11R22.5'),(1,101,'A3LI','11R22.5'),(2,102,'A2RO','295/75R22.5');
  `);
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async all() { return { results: statement.all(...values) }; },
      async first() { return statement.get(...values) ?? null; },
    };
  } };
  return { sqlite, db, report: (input = {}) => service.getBreakdownReportData(db, { ...range, ...input }) };
}

function sum(rows, key) { return rows.reduce((total, row) => total + row[key], 0); }

test('all equipment retains trucks trailers other assets and older records without tire positions', async () => {
  const f = fixture();
  try {
    const result = await f.report();
    assert.equal(result.summary.breakdownCount, 5);
    assert.equal(result.summary.totalCost, 645);
    assert.equal(result.breakdowns.length, 5);
    const old = result.breakdowns.find((row) => row.id === 5);
    assert.equal(old.tirePositions, 'Not recorded');
    assert.equal(old.tireDetails.length, 0);
    assert.equal(helpers.breakdownTireDetailsText(helpers.parseBreakdownTireDetails('{bad', 'truck')), 'Not recorded');
  } finally { f.sqlite.close(); }
});

test('truck and trailer filters use the affected equipment not the associated tractor', async () => {
  const f = fixture();
  try {
    const trucks = await f.report({ equipmentType: 'TRUCK' });
    const trailers = await f.report({ equipmentType: 'trailer' });
    assert.equal(trucks.summary.breakdownCount, 3);
    assert.equal(trucks.summary.totalCost, 320);
    assert.equal(trailers.summary.breakdownCount, 1);
    assert.equal(trailers.breakdowns[0].equipmentId, 2);
    assert.equal(trailers.summary.totalCost, 300);
    assert.ok(!trucks.breakdowns.some((row) => row.id === 2));
  } finally { f.sqlite.close(); }
});

test('same tire code is kept separate for truck drive axle and trailer axle', async () => {
  const f = fixture();
  try {
    const truck = await f.report({ tirePosition: 'truck:A2RO' });
    const trailer = await f.report({ tirePosition: 'trailer:A2RO' });
    assert.equal(truck.summary.breakdownCount, 1);
    assert.equal(truck.summary.totalCost, 200);
    assert.equal(trailer.summary.breakdownCount, 1);
    assert.equal(trailer.summary.totalCost, 300);
    assert.match(truck.breakdowns[0].tirePositions, /Truck.*Drive.*Right Outer.*A2RO.*11R22.5/);
    assert.match(trailer.breakdowns[0].tirePositions, /Trailer.*A2RO.*295\/75R22.5/);
  } finally { f.sqlite.close(); }
});

test('multi-tire breakdown counts once and every analytical table uses the same filter', async () => {
  const f = fixture();
  try {
    const result = await f.report({ equipmentType: 'truck', tirePosition: 'truck:A2RO' });
    assert.equal(result.breakdowns[0].tireDetails.length, 2);
    assert.equal(result.summary.breakdownCount, 1);
    assert.equal(result.summary.totalCost, 200);
    assert.equal(result.summary.totalDowntimeHours, 2);
    for (const key of ['byUnit', 'byCategory', 'byProvider', 'byLocation', 'monthlyTrend']) {
      assert.equal(sum(result[key], 'breakdownCount'), 1, key);
      assert.equal(sum(result[key], 'totalCost'), 200, key);
    }
  } finally { f.sqlite.close(); }
});

test('equipment and tire filters combine with existing dates unit office category provider status location and search', async () => {
  const f = fixture();
  try {
    const result = await f.report({ equipmentType: 'truck', tirePosition: 'truck:A2RO', equipmentId: 1, category: 'Tires', provider: 'Vendor A', status: 'completed', location: 'Clare, MI', query: 'T-TEST1' });
    assert.equal(result.summary.breakdownCount, 1);
    assert.equal((await f.report({ equipmentType: 'truck', category: 'Brake Chambers' })).breakdowns[0].id, 4);
    assert.equal((await f.report({ equipmentType: 'truck', category: 'Tires' })).summary.breakdownCount, 2);
    assert.equal((await f.report({ tirePosition: 'truck:A2RO', startDate: '2026-10-01', endDate: '2026-10-31' })).summary.breakdownCount, 0);
  } finally { f.sqlite.close(); }
});

test('invalid or mismatched filters are rejected instead of silently expanding the report', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.report({ equipmentType: 'anything' }), /All equipment/);
    await assert.rejects(f.report({ equipmentType: 'truck', tirePosition: 'trailer:A2RO' }), /valid tire position/);
    await assert.rejects(f.report({ tirePosition: 'truck:A1LO' }), /valid tire position/);
    await assert.rejects(f.report({ tirePosition: "truck:A2RO' OR 1=1" }), /valid tire position/);
  } finally { f.sqlite.close(); }
});

test('changing equipment clears only incompatible unit and tire filters', () => {
  const filters = { equipmentType: 'truck', tirePosition: 'truck:A2RO', unit: '1', category: 'Tires', start: '2026-09-01' };
  const units = [{ id: 1, equipmentType: 'truck' }, { id: 2, equipmentType: 'trailer' }];
  const next = helpers.changeBreakdownEquipmentFilter(filters, 'trailer', units);
  assert.equal(next.unit, ''); assert.equal(next.tirePosition, ''); assert.equal(next.category, 'Tires');
  assert.equal(next.start, filters.start); assert.equal(filters.unit, '1');
  const all = helpers.changeBreakdownEquipmentFilter(filters, '', units);
  assert.equal(all.unit, '1'); assert.equal(all.tirePosition, 'truck:A2RO');
  assert.equal(helpers.breakdownTirePositionOptions('truck').length, 10);
  assert.equal(helpers.breakdownTirePositionOptions('trailer').length, 8);
  assert.equal(new Set(helpers.breakdownTirePositionOptions().map((item) => item.value)).size, 18);
});

test('summary filtering is applied before the 5000 detail-row cap', async () => {
  const f = fixture();
  try {
    f.sqlite.exec('BEGIN');
    const repair = f.sqlite.prepare('INSERT INTO repairs(id,outside_cost) VALUES(?,1)');
    const breakdown = f.sqlite.prepare("INSERT INTO roadside_breakdowns(id,repair_id,equipment_id,repair_category,status,stage,created_at) VALUES(?,?,1,'Tires','new',1,'2026-09-02 08:00:00')");
    const tire = f.sqlite.prepare("INSERT INTO roadside_breakdown_tires VALUES(?,?,'A2RO','11R22.5')");
    for (let i = 1000; i <= 6000; i++) { repair.run(i); breakdown.run(i, i); tire.run(i, i); }
    f.sqlite.exec('COMMIT');
    const result = await f.report({ tirePosition: 'truck:A2RO' });
    assert.equal(result.summary.breakdownCount, 5002);
    assert.equal(result.summary.totalCost, 5201);
    assert.equal(result.breakdowns.length, 5000);
    assert.equal(result.truncated, true);
    assert.equal(sum(result.monthlyTrend, 'totalCost'), 5201);
  } finally { f.sqlite.close(); }
});

test('report API forwards both optional filters and retains authentication and role checks', async () => {
  let user = { role: 'manager' }; let seen;
  const route = compile('app/api/reports/breakdowns/route.ts', {
    'cloudflare:workers': { env: { DB: {} } },
    '@/lib/auth': { getSessionUser: async () => user },
    '@/lib/breakdown-reports': { getBreakdownReportData: async (_db, input) => { seen = input; helpers.normalizeTirePositionFilter(input.tirePosition, input.equipmentType); return {}; } },
  });
  const request = new Request('https://test.invalid/api/reports/breakdowns?equipmentType=truck&tirePosition=truck%3AA2RO');
  assert.equal((await route.GET(request)).status, 200);
  assert.equal(seen.equipmentType, 'truck'); assert.equal(seen.tirePosition, 'truck:A2RO');
  assert.equal((await route.GET(new Request('https://test.invalid/api/reports/breakdowns?equipmentType=truck&tirePosition=trailer%3AA2RO'))).status, 400);
  user = null; assert.equal((await route.GET(request)).status, 401);
  user = { role: 'mechanic' }; assert.equal((await route.GET(request)).status, 403);
});

function viewHarness(data) {
  const states = [data, { start: '2026-09-01', end: '2026-09-30', unit: '', equipmentType: '', tirePosition: '', category: '', provider: '', status: '', location: '', q: '' }];
  let cursor = 0; let requestUrl = ''; let exported;
  const jsx = (type, props) => ({ type, props });
  const page = compile('app/reports/breakdowns/page.tsx', {
    react: { useEffect() {}, useMemo: (fn) => fn(), useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../module-tabs': { default: () => null },
    './edit-breakdown-button': { default: () => null },
    '@/lib/breakdown-report-filters.js': helpers,
  }, {
    fetch: async (url) => { requestUrl = String(url); return Response.json(data); },
    URL: { createObjectURL(blob) { exported = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
  });
  return { states, render() { cursor = 0; return page.default(); }, requestUrl: () => requestUrl, exportText: () => exported.text() };
}
function nodes(tree, predicate) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props), predicate);
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function nodeText(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(nodeText).join('');
  if (typeof tree === 'object') return nodeText(tree.props?.children);
  return String(tree);
}
function labelControl(tree, title, type) {
  const label = nodes(tree, (node) => node.type === 'label' && nodeText(node).startsWith(title))[0];
  return nodes(label, (node) => node.type === type)[0];
}

test('report UI keeps tire details optional and sends selected equipment and tire filters', async () => {
  const f = fixture();
  try {
    const data = { ...await f.report(), permissions: { canDeleteRecords: true } };
    const view = viewHarness(data);
    let tree = view.render();
    assert.equal(nodes(tree, (node) => node.type === 'th' && nodeText(node).includes('Tire positions')).length, 0);
    labelControl(tree, 'Equipment', 'select').props.onChange({ target: { value: 'trailer' } });
    tree = view.render();
    const tire = labelControl(tree, 'Tire position (optional)', 'select');
    assert.ok(nodes(tire, (node) => node.type === 'option' && node.props.value).every((node) => node.props.value.startsWith('trailer:')));
    tire.props.onChange({ target: { value: 'trailer:A2RO' } });
    tree = view.render();
    assert.equal(nodes(tree, (node) => node.type === 'th' && nodeText(node).includes('Tire positions')).length, 1);
    const run = nodes(tree, (node) => node.type === 'button' && /Run Breakdown Report|Running/.test(nodeText(node)))[0];
    run.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const params = new URL(view.requestUrl(), 'https://test.invalid').searchParams;
    assert.equal(params.get('equipmentType'), 'trailer');
    assert.equal(params.get('tirePosition'), 'trailer:A2RO');
  } finally { f.sqlite.close(); }
});

test('CSV exports the filtered records with equipment type and all recorded tire details', async () => {
  const f = fixture();
  try {
    const data = { ...await f.report({ tirePosition: 'trailer:A2RO' }), permissions: { canDeleteRecords: true } };
    const view = viewHarness(data);
    const tree = view.render();
    nodes(tree, (node) => node.type === 'button' && nodeText(node) === 'Export Breakdown CSV')[0].props.onClick();
    const csv = await view.exportText();
    assert.match(csv, /Equipment Type/); assert.match(csv, /Tire Positions \/ Sizes/);
    assert.match(csv, /TR-TEST2/); assert.match(csv, /Trailer/); assert.match(csv, /A2RO/); assert.match(csv, /295\/75R22.5/);
    assert.doesNotMatch(csv, /T-TEST1/);
    assert.equal(csv.split('\n').length, 2);
  } finally { f.sqlite.close(); }
});
