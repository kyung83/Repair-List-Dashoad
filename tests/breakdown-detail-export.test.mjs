import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as exports from '../lib/breakdown-detail-export.js';
import { buildReportXlsx, XLSX_MIME } from '../lib/report-xlsx.js';

const records = Array.from({ length: 29 }, (_, index) => ({
  id: index + 1, unit: `00${index + 1}`, equipmentType: 'trailer', createdAt: '2026-09-08 23:38:24',
  tirePositions: 'Trailer - Axle 1 - Right Inner (A1RI) - 295/75R22.5',
  driverName: 'Test Driver', category: 'TIRES', serviceProvider: 'Vendor & Service', location: 'Clare, MI', status: 'complete',
  partsCost: 0, laborCost: 0, outsideCost: 534.2 + index, totalCost: 534.2 + index,
  arrivalMinutes: null, downtimeMinutes: 846, repairNeeded: 'Tire failure', description: 'Driver note, with "quotes"\nand another line.',
}));
const options = { showTireDetails: true, range: { startDate: '2026-09-01', endDate: '2026-09-30' }, filters: { equipmentType: 'trailer', tirePosition: 'trailer:A1RI' }, sortKey: 'totalCost', sortDir: 'desc', totalCount: 29 };

function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), entries = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'stored ZIP entries');
    const length = view.getUint32(offset + 18, true), names = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + names + extra, data = bytes.subarray(start, start + length);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal((crc ^ 0xffffffff) >>> 0, view.getUint32(offset + 14, true), 'ZIP CRC matches payload');
    entries[new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + names))] = new TextDecoder().decode(data);
    offset = start + length;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), Object.keys(entries).length);
  return entries;
}

test('detail export includes every loaded row in current order, not the visible scroll area', () => {
  const ordered = [...records].reverse(), report = exports.buildBreakdownDetailExport(ordered, options);
  assert.deepEqual(report.items.map((row) => row.id), ordered.map((row) => row.id));
  assert.equal(report.rows.length, 29); assert.equal(report.partial, false);
  assert.equal(report.items[0].unit, '0029'); assert.equal(records[0].unit, '001');
  assert.equal(report.rows[0][report.columns.findIndex((col) => col.key === 'totalCost')], 562.2);
  assert.equal(new Map(report.metadata).get('Equipment'), 'Trailer');
  assert.ok(!report.columns.some((col) => /actions|delete|edit/i.test(col.header)));
});

test('Excel is a valid OOXML ZIP with numeric money, literal identifiers, freeze panes and filters', () => {
  const report = exports.buildBreakdownDetailExport(records, options), files = unpack(exports.breakdownDetailXlsx(report));
  assert.match(files['[Content_Types].xml'], /spreadsheetml.sheet.main\+xml/);
  assert.match(files['xl/workbook.xml'], /Breakdown Detail/); assert.match(files['xl/workbook.xml'], /Report Info/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.equal((sheet.match(/<row /g) || []).length, 30);
  assert.match(sheet, /<c r="C2" s="0" t="inlineStr"><is><t xml:space="preserve">001<\/t>/);
  assert.match(sheet, /<c r="P2" s="2" t="n"><v>534.2<\/v>/);
  assert.match(sheet, /A1RI/); assert.match(sheet, /topLeftCell="A2"/); assert.match(sheet, /autoFilter ref="A1:R30"/);
  assert.match(files['xl/styles.xml'], /numFmtId="164"/); assert.match(files['xl/worksheets/sheet2.xml'], /Matching rows/);
  assert.doesNotMatch(sheet, /<f[\s>]/);
});

test('optional tire column is consistent across detail print, CSV and Excel', () => {
  for (const shown of [false, true]) {
    const report = exports.buildBreakdownDetailExport(records, { ...options, showTireDetails: shown });
    assert.equal(report.columns.some((col) => col.key === 'tirePositions'), shown);
    assert.equal(exports.breakdownDetailCsv(report).includes('Tire Positions / Sizes'), shown);
    assert.equal(exports.breakdownDetailPrintHtml(report).includes('<strong>Tire positions / sizes:'), shown);
    assert.equal(unpack(exports.breakdownDetailXlsx(report))['xl/worksheets/sheet1.xml'].includes('Tire Positions / Sizes'), shown);
  }
});

test('CSV preserves Unicode, quoting and line breaks without allowing formula injection', () => {
  const report = exports.buildBreakdownDetailExport([{ ...records[0], driverName: '\u00c9mile', serviceProvider: '=HYPERLINK("https://bad.invalid")', totalCost: -50 }], { ...options, totalCount: 1 });
  const csv = exports.breakdownDetailCsv(report);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /\u00c9mile/); assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad.invalid""\)"/);
  assert.match(csv, /with ""quotes""\nand another line/); assert.match(csv, /"-50"/);
  const xml = unpack(exports.breakdownDetailXlsx(report))['xl/worksheets/sheet1.xml'];
  assert.match(xml, /t="inlineStr"/); assert.doesNotMatch(xml, /<f>/);
});

test('print includes all 29 records, long descriptions, tire details and costs without scroll clipping or executable data', () => {
  const report = exports.buildBreakdownDetailExport(records.map((row) => ({ ...row, description: '<img src=x onerror=alert(1)>\nEND OF NOTE' })), options);
  const html = exports.breakdownDetailPrintHtml(report);
  assert.equal((html.match(/<tbody class="record">/g) || []).length, 29);
  assert.match(html, /#29/); assert.match(html, /A1RI/); assert.match(html, /\$534.20/); assert.match(html, /END OF NOTE/);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script|max-height|overflow:\s*(auto|hidden)|min-width/i);
  assert.match(html, /table-header-group/); assert.match(html, /letter landscape/);
});

test('large-result truncation is explicit and missing numbers stay distinct from zero', () => {
  const report = exports.buildBreakdownDetailExport(records, { ...options, totalCount: 5001, truncated: true });
  assert.equal(report.partial, true); assert.match(report.note, /PARTIAL REPORT: 29 of 5001/);
  assert.match(exports.breakdownDetailPrintHtml(report), /PARTIAL REPORT/);
  const arrival = report.columns.findIndex((col) => col.key === 'arrivalMinutes'), parts = report.columns.findIndex((col) => col.key === 'partsCost');
  assert.equal(report.rows[0][arrival], ''); assert.equal(report.rows[0][parts], 0);
  assert.throws(() => buildReportXlsx([{ header: 'x' }], [['a', 'b']]), /columns/);
  assert.throws(() => buildReportXlsx([{ header: 'x' }], [['a'.repeat(32768)]]), /text limit/);
});

function browser() {
  const events = [], files = [];
  const popup = { document: { body: {}, open() {}, write(html) { events.push(['html', html]); }, close() {}, getElementById: () => ({ addEventListener() {} }) }, focus() {}, print() { events.push(['print']); }, close() { events.push(['close']); } };
  const win = { location: { origin: 'https://test.invalid', pathname: '/reports/breakdowns' },
    open() { events.push(['open']); return popup; }, confirm: () => true,
    setTimeout(fn, delay) { events.push(['timer', delay]); if (delay === 250) fn(); },
    URL: { createObjectURL(blob) { files.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement() { return { style: {}, click() { events.push(['download', this.download]); }, remove() { events.push(['removed']); } }; } },
  };
  return { win, events, files, popup };
}

test('download uses XLSX MIME and extension and keeps the URL alive long enough for browser download', () => {
  const b = browser(); exports.saveBreakdownDetail(exports.buildBreakdownDetailExport(records, options), 'xlsx', b.win);
  assert.equal(b.files[0].type, XLSX_MIME);
  assert.ok(b.events.some(([event, value]) => event === 'download' && value.endsWith('.xlsx')));
  assert.ok(b.events.some(([event, delay]) => event === 'timer' && delay === 60000));
});

test('print reuses the click-opened window and blocked popups give an actionable message', () => {
  const report = exports.buildBreakdownDetailExport(records, options), b = browser();
  exports.printBreakdownDetail(report, b.win, b.popup);
  assert.equal(b.events.filter(([event]) => event === 'open').length, 0);
  assert.ok(b.events.some(([event]) => event === 'print'));
  assert.throws(() => exports.printBreakdownDetail(report, { ...b.win, open: () => null }), /Allow pop-ups/);
});

function walk(tree, predicate) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => walk(child, predicate));
  if (typeof tree.type === 'function') return walk(tree.type(tree.props), predicate);
  return [...(predicate(tree) ? [tree] : []), ...walk(tree.props?.children, predicate)];
}
function nodeText(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(nodeText).join('');
  return typeof tree === 'object' ? nodeText(tree.props?.children) : String(tree);
}
function viewHarness(overrides = {}) {
  const data = { range: options.range, filters: options.filters, breakdowns: records, summary: { breakdownCount: 29 },
    filterOptions: { equipment: [], categories: [], statuses: [], providers: [], locations: [] }, byUnit: [], byCategory: [], byProvider: [], byLocation: [], monthlyTrend: [], permissions: { canDeleteRecords: false }, ...overrides };
  const state = [data, { start: '2000-01-01', end: '2000-12-31', equipmentType: 'truck' }, 'ytd', false, '', 'totalCost', 'desc', null, true, '', ''];
  const b = browser(), calls = []; let cursor = 0;
  const source = readFileSync(new URL('../app/reports/breakdowns/page.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: 'page.tsx', reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const jsx = (type, props) => ({ type, props }), modules = {
    react: { useEffect() {}, useMemo: (fn) => fn(), useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '../../module-tabs': { default: () => null }, './edit-breakdown-button': { default: () => null },
    '@/lib/breakdown-report-filters.js': { breakdownEquipmentLabel: (type) => type, breakdownTirePositionOptions: () => [], changeBreakdownEquipmentFilter() {} },
    '@/lib/breakdown-detail-export.js': { ...exports,
      buildBreakdownDetailExport(rows, settings) { calls.push(['build', rows, settings]); return exports.buildBreakdownDetailExport(rows, settings); },
      saveBreakdownDetail(report, format) { calls.push(['save', report, format]); exports.saveBreakdownDetail(report, format, b.win); },
    },
  };
  const output = {};
  vm.runInNewContext(compiled.outputText, { exports: output, window: b.win, console, URL, URLSearchParams, Blob, Date, Error, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return { ...b, calls, state, render() { cursor = 0; return output.default(); }, async click(name) {
    const tree = this.render(), group = walk(tree, (node) => node.props?.['aria-label'] === 'Breakdown Detail exports')[0];
    assert.ok(group, 'native export controls live directly in the detail section');
    const button = walk(group, (node) => node.type === 'button' && nodeText(node) === name)[0];
    assert.ok(button); button.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); return button;
  } };
}

test('native detail controls export applied filters and sorted rows even when draft filters differ', async () => {
  const view = viewHarness(); await view.click('Download Excel');
  const [, rows, settings] = view.calls.find(([kind]) => kind === 'build');
  assert.equal(rows[0].id, 29); assert.equal(rows.length, 29); assert.equal(settings.range.startDate, '2026-09-01');
  assert.equal(settings.filters.equipmentType, 'trailer'); assert.equal(settings.showTireDetails, true);
  assert.equal(view.calls.find(([kind]) => kind === 'save')[2], 'xlsx');
  assert.ok(view.files.length === 1); assert.match(view.state[10], /Excel download started/);
});

test('native detail print opens synchronously and CSV has its own section action', async () => {
  const print = viewHarness(); await print.click('Print / Save PDF');
  assert.equal(print.events.filter(([kind]) => kind === 'open').length, 1);
  assert.equal(print.events[0][0], 'open'); assert.ok(print.events.some(([kind]) => kind === 'print'));
  const csv = viewHarness(); await csv.click('Export CSV'); assert.equal(csv.calls.find(([kind]) => kind === 'save')[2], 'csv');
});

test('empty or loading detail cannot export and partial export requires confirmation', async () => {
  const empty = viewHarness({ breakdowns: [], summary: { breakdownCount: 0 } });
  assert.equal((await empty.click('Download Excel')).props.disabled, true); assert.equal(empty.calls.length, 0);
  const loading = viewHarness(); loading.state[3] = true;
  assert.equal((await loading.click('Download Excel')).props.disabled, true); assert.equal(loading.calls.length, 0);
  const partial = viewHarness({ truncated: true, summary: { breakdownCount: 5001 } }); partial.win.confirm = () => false;
  await partial.click('Download Excel'); assert.equal(partial.calls.length, 0);
});
