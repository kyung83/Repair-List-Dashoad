import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function compile(path, modules = {}) {
  const result = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require(name) {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  }, { filename: path });
  return exports;
}

const crossReferences = compile('lib/part-cross-references.ts');
const inventory = compile('lib/inventory-db.ts', { './part-cross-references': crossReferences });
const derived = compile('lib/derived-reservations.ts', { './part-cross-references': crossReferences });
const AuditSheet = compile('app/inventory/inventory-audit-sheet.tsx', { 'react/jsx-runtime': jsxRuntime }).default;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parts(id INTEGER PRIMARY KEY, part_number TEXT, description TEXT, quantity_on_hand REAL,
      reorder_level REAL, unit_cost REAL, location TEXT, preferred_vendor_id INTEGER, active INTEGER, deleted_at TEXT, updated_at TEXT);
    CREATE TABLE vendors(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, notes TEXT, active INTEGER);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY, code TEXT, name TEXT, active INTEGER);
    CREATE TABLE part_warehouse_stock(id INTEGER PRIMARY KEY, part_id INTEGER, warehouse_id INTEGER, variant_key TEXT,
      quantity_on_hand REAL, unit_of_measure TEXT, unit_cost REAL, on_order REAL);
    CREATE TABLE part_warehouse_minimums(part_id INTEGER, warehouse_id INTEGER, minimum_quantity REAL);
    CREATE TABLE equipment(id INTEGER PRIMARY KEY, unit TEXT, category TEXT, equipment_type TEXT, active INTEGER);
    CREATE TABLE part_equipment(part_id INTEGER, equipment_id INTEGER);
    CREATE TABLE part_cross_references(part_id INTEGER, cross_part_number TEXT, active INTEGER);
    CREATE TABLE repair_part_requests(part_id INTEGER, warehouse_id INTEGER, status TEXT);
    CREATE TABLE derived_repair_part_reservations(part_id INTEGER, warehouse_id INTEGER, reserved_quantity REAL);
    INSERT INTO parts VALUES
      (1, 'PART-1', 'Test part', 12, 0, 10, 'General cabinet note', NULL, 1, NULL, NULL),
      (2, 'PART-2', 'Unassigned part', 3, 0, 4, 'Legacy shelf', NULL, 1, NULL, NULL),
      (3, 'PART-3', 'Part without a bin', 1, 0, 5, '', NULL, 1, NULL, NULL);
    INSERT INTO warehouses VALUES (1, 'CLARE', 'Clare', 1), (2, 'CADILLAC', 'Cadillac', 1);
    INSERT INTO part_warehouse_stock VALUES
      (1, 1, 1, '', 2, 'EA', 10, 0),
      (2, 1, 1, 'alternate', 3, 'EA', 10, 0),
      (3, 1, 2, '', 7, 'EA', 10, 0),
      (4, 3, 1, '', 1, 'EA', 5, 0);
    INSERT INTO derived_repair_part_reservations VALUES (1, 1, 1);
  `);
  sqlite.exec(read('migrations/0155_part_warehouse_bin_locations.sql'));
  sqlite.prepare(`INSERT INTO part_warehouse_locations(part_id, warehouse_id, bin_location, source)
    VALUES (?, ?, ?, 'EMDECS')`).run(1, 1, 'Room 1 / Shelf A / Bin 03\nRoom 1 / Shelf A / Bin 04');
  sqlite.prepare(`INSERT INTO part_warehouse_locations(part_id, warehouse_id, bin_location, source)
    VALUES (?, ?, ?, 'EMDECS')`).run(1, 2, 'Room 2 / Shelf B / Bin 07');
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { return { results: statement.all(...args) }; },
        async first() { return statement.get(...args) ?? null; },
        runSync() { const result = statement.run(...args); return { meta: { changes: result.changes, last_row_id: result.lastInsertRowid } }; },
        async run() { return this.runSync(); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map((statement) => statement.runSync()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db, async load() { return derived.decorateInventoryDataDerived(db, await inventory.getInventoryData(db)); } };
}

test('warehouse bins survive stock aggregation without duplicating quantities or losing missing-bin parts', async () => {
  const f = fixture();
  try {
    const data = await f.load();
    const part = data.parts.find((item) => item.id === 1);
    assert.equal(part.warehouseStocks.length, 2);
    assert.equal(part.physicalOnHand, 12);
    assert.equal(part.quantityOnHand, 11);
    const clare = part.warehouseStocks.find((stock) => stock.warehouseCode === 'CLARE');
    const cadillac = part.warehouseStocks.find((stock) => stock.warehouseCode === 'CADILLAC');
    assert.equal(clare.physicalOnHand, 5);
    assert.equal(clare.quantityOnHand, 4);
    assert.equal(clare.binLocation, 'Room 1 / Shelf A / Bin 03\nRoom 1 / Shelf A / Bin 04');
    assert.equal(cadillac.physicalOnHand, 7);
    assert.equal(cadillac.binLocation, 'Room 2 / Shelf B / Bin 07');
    assert.equal(data.parts.find((item) => item.id === 3).warehouseStocks[0].binLocation, '');
    assert.equal(data.parts.length, 3);
  } finally { f.sqlite.close(); }
});

test('editing loaded part details preserves the general location and warehouse bins', async () => {
  const f = fixture();
  try {
    const part = (await f.load()).parts.find((item) => item.id === 1);
    assert.equal(part.location, 'General cabinet note');
    assert.notEqual(part.warehouseSummary, part.location);
    await inventory.savePart(f.db, { ...part, description: 'Edited description' });
    assert.equal(f.sqlite.prepare('SELECT location FROM parts WHERE id = 1').get().location, 'General cabinet note');
    assert.equal(f.sqlite.prepare('SELECT quantity_on_hand FROM parts WHERE id = 1').get().quantity_on_hand, 12);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM part_warehouse_locations WHERE part_id = 1').get().count, 2);
  } finally { f.sqlite.close(); }
});

test('printed warehouse audit includes every bin once and uses physical stock including reserved units', async () => {
  const f = fixture();
  try {
    const data = await f.load();
    const html = renderToStaticMarkup(AuditSheet({ snapshot: {
      parts: data.parts, warehouseCode: 'CLARE', warehouseName: 'Clare', updatedAt: data.updatedAt,
      query: '', stockFilter: 'All parts', sort: 'Description A-Z',
    } }));
    assert.match(html, /Bin location/);
    assert.equal((html.match(/Bin 03/g) ?? []).length, 1);
    assert.equal((html.match(/Bin 04/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Bin 07/);
    assert.match(html, />5<\/td><td class="inventory-audit-bin">Room 1/);
    assert.match(html, /PART-3/);
    assert.match(html, /Count all listed bins for each part and enter one combined quantity/);
  } finally { f.sqlite.close(); }
});
