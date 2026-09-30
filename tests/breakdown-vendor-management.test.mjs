import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, modules = {}, globals = {}) {
  const result = ts.transpileModule(read(path), { fileName: path, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length || 0, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, Error, RangeError, Date, JSON, URL, URLSearchParams, Request, Response, TextEncoder, crypto: globalThis.crypto,
    console: { error() {} }, require(name) { assert.ok(name in modules, name); return modules[name]; }, ...globals });
  return exports;
}
const service = compile('lib/breakdown-vendors.ts');
const draft = { name: 'Test Roadside', phone: '(231) 555-0123', city: 'Clare', state: 'mi', zip: '48617' };
const params = (values = {}) => new URLSearchParams(values);
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_users(id INTEGER PRIMARY KEY); INSERT INTO app_users VALUES(1);
    CREATE TABLE roadside_breakdowns(id INTEGER PRIMARY KEY,service_provider TEXT,service_provider_phone TEXT,total_cost REAL);
  `);
  sqlite.exec(read('migrations/0104_roadside_service_provider_schema.sql'));
  sqlite.exec(read('migrations/0149_breakdown_vendor_management.sql'));
  let beforeBatch = null, failBatch = false;
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql); let binds = [];
      return { bind(...values) { binds = values; return this; },
        async first() { return stmt.get(...binds) || null; },
        async all() { return { results: stmt.all(...binds) }; },
        async run() { const result = stmt.run(...binds); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      };
    },
    async batch(statements) {
      beforeBatch?.(); beforeBatch = null;
      sqlite.exec('BEGIN');
      try { const result = []; for (const stmt of statements) { result.push(await stmt.run()); if (failBatch) throw new Error('Injected database failure'); }
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const list = (values = {}) => service.listBreakdownVendors(db, params(values));
  const add = (values = {}) => service.addBreakdownVendor(db, { ...draft, ...values });
  const current = async (id) => (await list()).vendors.find((row) => row.id === id);
  const change = (row, action, values = {}) => service.changeBreakdownVendor(db, 1, { ...row, expectedVersion: row.version, action, ...values });
  const remove = (row, confirmed = true) => service.changeBreakdownVendor(db, 1, { id: row.id, expectedVersion: row.version, confirmDelete: confirmed }, true);
  return { sqlite, db, list, add, current, change, remove, beforeBatch(fn) { beforeBatch = fn; }, failBatch() { failBatch = true; } };
}

test('vendor directory lists every state and supports paginated records beyond the old picker cap', async () => {
  const f = fixture();
  try {
    const insert = f.sqlite.prepare("INSERT INTO roadside_service_providers(name,phone,city,state,active) VALUES(?,'','Test City',?,?)");
    for (let i = 0; i < 265; i++) insert.run(`Provider ${String(i).padStart(3,'0')}`, i % 2 ? 'MI' : 'ON', i % 3 ? 1 : 0);
    const ids = new Set();
    for (const page of [1,2,3]) {
      const result = await f.list({ page: String(page) });
      assert.equal(result.total, 265); assert.equal(result.pages, 3);
      result.vendors.forEach((row) => ids.add(row.id));
    }
    assert.equal(ids.size, 265);
    assert.ok((await f.list({ status: 'active', state: 'MI' })).vendors.every((row) => row.active && row.state === 'MI'));
    assert.ok((await f.list({ status: 'archived' })).vendors.every((row) => !row.active));
    assert.equal((await f.list({ page: '999' })).page, 3);
  } finally { f.sqlite.close(); }
});

test('add vendor uses the same active roadside picker table and validates all fields', async () => {
  const f = fixture();
  try {
    const row = await f.add({ name: '  Test Roadside  ', zip: '00123' });
    assert.equal(row.name, 'Test Roadside'); assert.equal(row.state, 'MI'); assert.equal(row.zip, '00123'); assert.equal(row.active, true);
    const picker = f.sqlite.prepare("SELECT * FROM roadside_service_providers WHERE active=1 AND state='MI'").get();
    assert.equal(picker.id, row.id); assert.equal(picker.phone_digits, '2315550123');
    for (const invalid of [{ name: '' }, { city: '' }, { state: 'Michigan' }, { phone: '123' }, { zip: 48617 }, { name: 'Bad\nName' }]) {
      await assert.rejects(f.add(invalid), (error) => error.status === 400);
    }
    assert.equal((await f.list()).total, 1);
  } finally { f.sqlite.close(); }
});

test('normalized duplicates cannot silently create or restore a directory entry', async () => {
  const f = fixture();
  try {
    const row = await f.add();
    await assert.rejects(f.add({ name: 'TEST ROADSIDE', phone: '1-231-555-0123', city: 'clare' }), /already exists/);
    await f.change(row, 'archive');
    await assert.rejects(f.add(), /Restore/);
    assert.equal((await f.current(row.id)).active, false);
    await f.add({ city: 'Cadillac', zip: '49601' });
    assert.equal((await f.list()).total, 2);
  } finally { f.sqlite.close(); }
});

test('search treats wildcard characters literally and phone search tolerates formatting', async () => {
  const f = fixture();
  try {
    await f.add(); await f.add({ name: '100% Test', phone: '', city: 'Other' });
    assert.equal((await f.list({ q: '%' })).total, 1);
    assert.equal((await f.list({ q: '231-555' })).total, 1);
    assert.equal((await f.list({ q: "' OR 1=1 --" })).total, 0);
    await assert.rejects(f.list({ status: 'deleted' }), /Choose/);
  } finally { f.sqlite.close(); }
});

test('edits preserve vendor id and historical breakdown snapshots and audit prior identity', async () => {
  const f = fixture();
  try {
    const row = await f.add();
    f.sqlite.prepare('INSERT INTO roadside_breakdowns VALUES(1,?,?,575.25)').run(row.name, row.phone);
    const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM roadside_breakdowns').all());
    const result = await f.change(row, 'edit', { name: 'Renamed Vendor', phone: '989-555-9911' });
    assert.equal(result.vendor.id, row.id); assert.equal(result.vendor.name, 'Renamed Vendor');
    assert.equal(result.vendor.hasHistory, true);
    assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM roadside_breakdowns').all()), before);
    const audit = f.sqlite.prepare('SELECT * FROM roadside_vendor_change_log').get();
    assert.equal(audit.name, row.name); assert.equal(audit.action, 'edit'); assert.equal(audit.actor_user_id, 1);
    assert.equal(f.sqlite.prepare('SELECT phone_digits FROM roadside_service_providers').get().phone_digits, '9895559911');
    await assert.rejects(f.change(row, 'edit', { city: 'Wrong stale change' }), /another session/);
    const archived = await f.change(result.vendor, 'archive');
    await assert.rejects(f.remove(archived.vendor), /history/);
  } finally { f.sqlite.close(); }
});

test('shared phone history protects vendors even when recorded company names differ', async () => {
  const f = fixture();
  try {
    const row = await f.add();
    f.sqlite.exec("INSERT INTO roadside_breakdowns VALUES(1,'Different spelling','+1 (231) 555-0123',10)");
    const current = await f.current(row.id); assert.equal(current.hasHistory, true);
    const archived = await f.change(current, 'archive'); assert.equal(archived.vendor.canDelete, false);
    await assert.rejects(f.remove(archived.vendor), /history/);
  } finally { f.sqlite.close(); }
});

test('archive and restore change future picker eligibility without erasing breakdown history', async () => {
  const f = fixture();
  try {
    const row = await f.add();
    const archived = await f.change(row, 'archive');
    assert.equal((await f.list({ status: 'active' })).total, 0);
    assert.equal((await f.list({ status: 'archived' })).total, 1);
    const edited = await f.change(archived.vendor, 'edit', { ...draft, city: 'New City' });
    assert.equal(edited.vendor.active, false);
    const restored = await f.change(edited.vendor, 'restore'); assert.equal(restored.vendor.active, true);
  } finally { f.sqlite.close(); }
});

test('permanent delete requires confirmation, archive, and no history and leaves an audit', async () => {
  const f = fixture();
  try {
    const row = await f.add();
    await assert.rejects(f.remove(row, false), /Confirm/);
    await assert.rejects(f.remove(row), /archived/);
    const archived = await f.change(row, 'archive'); assert.equal(archived.vendor.canDelete, true);
    const deleted = await f.remove(archived.vendor); assert.equal(deleted.deleted, true);
    assert.equal((await f.list()).total, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM roadside_vendor_change_log WHERE action='delete'").get().n, 1);
  } finally { f.sqlite.close(); }
});

test('duplicate edit and concurrent edits do not leave incorrect audit entries', async () => {
  const f = fixture();
  try {
    const first = await f.add(); const second = await f.add({ name: 'Second Vendor' });
    await assert.rejects(f.change(second, 'edit', { ...draft }), /already exists/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM roadside_vendor_change_log').get().n, 0);
    f.beforeBatch(() => f.sqlite.prepare("UPDATE roadside_service_providers SET city='Concurrent' WHERE id=?").run(first.id));
    await assert.rejects(f.change(first, 'archive'), /changed/);
    assert.equal((await f.current(first.id)).active, true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM roadside_vendor_change_log').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('history is rechecked inside delete and audit rolls back with a failed mutation', async () => {
  const f = fixture();
  try {
    const row = await f.add(); const { vendor } = await f.change(row, 'archive');
    f.beforeBatch(() => f.sqlite.prepare('INSERT INTO roadside_breakdowns VALUES(1,?,?,50)').run(row.name, row.phone));
    await assert.rejects(f.remove(vendor), /history/);
    assert.equal((await f.list()).total, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM roadside_vendor_change_log WHERE action='delete'").get().n, 0);
    f.failBatch();
    await assert.rejects(f.change(await f.current(row.id), 'restore'), /Injected/);
    assert.equal((await f.current(row.id)).active, false);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM roadside_vendor_change_log WHERE action='restore'").get().n, 0);
  } finally { f.sqlite.close(); }
});

test('vendor API is manager/admin protected, same-origin guarded and rejects malformed input', async () => {
  const f = fixture(); let user = { id: 1, role: 'manager' };
  try {
    const route = compile('app/api/breakdown-vendors/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } }, '@/lib/auth': { getSessionUser: async () => user }, '@/lib/breakdown-vendors': service,
    });
    const req = (method = 'GET', body, headers = {}) => new Request('https://test.invalid/api/breakdown-vendors', { method, headers: { 'content-type': 'application/json', ...headers }, ...(method !== 'GET' ? { body: typeof body === 'string' ? body : JSON.stringify(body || {}) } : {}) });
    assert.equal((await route.POST(req('POST', draft))).status, 201);
    assert.equal((await route.POST(req('POST', draft, { origin: 'https://evil.invalid' }))).status, 403);
    assert.equal((await route.POST(req('POST', draft, { 'sec-fetch-site': 'cross-site' }))).status, 403);
    assert.equal((await route.POST(req('POST', '{bad'))).status, 400);
    assert.equal((await route.POST(req('POST', '[]'))).status, 400);
    assert.equal((await route.POST(req('POST', draft, { 'content-length': '20000' }))).status, 413);
    assert.equal((await route.POST(req('POST', draft, { 'content-type': 'text/plain' }))).status, 415);
    for (const blocked of [null, { id: 1, role: 'mechanic' }, { id: 1, role: 'viewer' }, { id: 1, role: 'dispatch' }, { id: 1, role: 'manager', dispatchAccess: true }]) {
      user = blocked;
      for (const method of ['GET','POST','PATCH','DELETE']) assert.equal((await route[method](req(method, draft))).status, user ? 403 : 401);
    }
    user = { id: 1, role: 'admin' };
    const response = await route.GET(req()); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { f.sqlite.close(); }
});

function viewHarness(directory) {
  const states = [directory, { q: '', state: '', status: 'all' }, { q: '', state: '', status: 'all' }, null, false, '', '', ''];
  let cursor = 0, refCursor = 0; const refs = []; const requests = [];
  const jsx = (type, props) => ({ type, props });
  const page = compile('app/breakdown-vendors/page.tsx', {
    react: { useEffect() {}, useCallback: (fn) => fn, useRef(value) { const index = refCursor++; return refs[index] ||= { current: value }; },
      useState(value) { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  }, { window: { confirm: () => true }, fetch: async (url, init) => {
    requests.push({ url, init });
    if (init?.method === 'POST') return Response.json({ vendor: { id: 9, ...JSON.parse(init.body), active: true } }, { status: 201 });
    return Response.json(directory);
  } });
  return { states, requests, render() { cursor = 0; refCursor = 0; return page.default(); } };
}
function nodes(tree, predicate) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
test('native Add Breakdown Vendor button opens a form and saves to the shared directory', async () => {
  const f = fixture();
  try {
    const view = viewHarness(await f.list());
    let tree = view.render();
    nodes(tree, (node) => node.type === 'button' && text(node) === '+ Add Breakdown Vendor')[0].props.onClick();
    tree = view.render(); assert.ok(text(tree).includes('Add Breakdown Vendor'));
    for (const [label, value] of [['Company name *', 'New Roadside'], ['City *', 'Clare'], ['State / province *', 'MI'], ['Phone', '231-555-1111']]) {
      const control = nodes(tree, (node) => node.type === 'label' && text(node) === label)[0];
      nodes(control, (node) => node.type === 'input')[0].props.onChange({ target: { value } }); tree = view.render();
    }
    const form = nodes(tree, (node) => node.type === 'form' && text(node).includes('Add Vendor'))[0];
    form.props.onSubmit({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const post = view.requests.find((request) => request.init?.method === 'POST');
    assert.equal(post.url, '/api/breakdown-vendors'); assert.equal(JSON.parse(post.init.body).name, 'New Roadside');
    assert.equal(view.states[3], null); assert.match(view.states[7], /Added New Roadside/);
  } finally { f.sqlite.close(); }
});

test('unauthorized or initial directory view exposes no management controls', () => {
  const view = viewHarness(null); view.states[6] = 'Manager or administrator access is required.';
  const tree = view.render();
  assert.equal(nodes(tree, (node) => node.type === 'button' && text(node) === '+ Add Breakdown Vendor').length, 0);
  assert.equal(nodes(tree, (node) => node.type === 'form').length, 0);
});

test('Setup Home places vendor management under Breakdown and Operations without another visible sidebar link', () => {
  const jsx = (type, props) => ({ type, props });
  for (const role of ['manager','admin']) {
    let cursor = 0;
    const page = compile('app/setup-center/page.tsx', {
      react: { useEffect() {}, useMemo: (fn) => fn(), useState: () => [cursor++ === 0 ? { role, displayName: 'Test' } : '', () => {}] },
      'react/jsx-runtime': { jsx, jsxs: jsx },
    });
    const tree = page.default();
    const card = nodes(tree, (node) => node.type === 'article' && nodes(node, (n) => n.type === 'h2' && text(n) === 'Breakdown & Operations').length)[0];
    assert.equal(nodes(card, (node) => node.type === 'a' && node.props.href === '/breakdown-vendors').length, 1);
    const nav = compile('app/navigation-config.ts');
    const groups = nav.sidebarGroupsForRole(role);
    const link = groups.find((group) => group.key === 'settings').links.find((item) => item.href === '/breakdown-vendors');
    assert.equal(link.showInSidebar, false);
    assert.ok(!groups.find((group) => group.key === 'breakdowns').links.some((item) => item.href === '/breakdown-vendors'));
  }
});

test('existing breakdown provider lookup immediately reads added edited archived and restored directory entries', async () => {
  const f = fixture();
  try {
    const route = compile('app/api/breakdown-service-providers/route.ts', {
      'cloudflare:workers': { env: { DB: f.db } }, '@/lib/auth': { getSessionUser: async () => ({ id: 1, role: 'manager' }) },
    });
    const list = async () => (await (await route.GET(new Request('https://test.invalid/api/breakdown-service-providers?state=MI'))).json()).providers;
    const row = await f.add(); assert.equal((await list())[0].id, row.id);
    const edited = await f.change(row, 'edit', { name: 'Corrected Roadside', phone: '989-555-0199' });
    assert.equal((await list())[0].phone, '989-555-0199');
    const archived = await f.change(edited.vendor, 'archive'); assert.equal((await list()).length, 0);
    await f.change(archived.vendor, 'restore'); assert.equal((await list()).length, 1);
    assert.equal((await route.GET(new Request('https://test.invalid/api/breakdown-service-providers'))).status, 400);
  } finally { f.sqlite.close(); }
});
