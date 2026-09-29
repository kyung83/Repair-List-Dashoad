// Isolated tests: these do not connect to Geotab, Cloudflare, or the production database.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const routePath = path.join(root, 'app/api/geotab-devices/route.ts');
const componentPath = path.join(root, 'app/equipment/geotab-tracking-enhancer.tsx');

function compile(file) {
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, strict: true },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  return result.outputText;
}

function setup({ devices = [], assignments = [], connectionError, lookupError, assignmentError } = {}) {
  const calls = [];
  const logs = [];
  const env = { DB: { prepare(sql) {
    calls.push({ kind: 'sql', sql });
    return { async all() {
      if (assignmentError) throw assignmentError;
      return { results: assignments };
    }};
  }}};
  const sharedClient = {
    async createGeotabClient(receivedEnv) {
      assert.strictEqual(receivedEnv, env);
      calls.push({ kind: 'shared-client' });
      if (connectionError) throw connectionError;
      return { async call(method, params) {
        calls.push({ kind: 'api', method, params });
        if (lookupError) throw lookupError;
        return devices;
      }};
    },
    geotabGet(source, ...names) { for (const name of names) if (name in source) return source[name]; },
    geotabObjectId(value) { return String(value.id ?? value.Id ?? '').trim(); },
    geotabText(value) { return value == null ? '' : String(value); },
  };
  const context = {
    exports: {}, Response, Date, crypto: webcrypto,
    console: { error(line) { logs.push(JSON.parse(line)); } },
    require(name) {
      if (name === 'cloudflare:workers') return { env };
      if (name === '@/lib/geotab-client') return sharedClient;
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(compile(routePath), context, { filename: routePath });
  return { GET: context.exports.GET, calls, logs };
}

test('both replacement files transpile without TypeScript syntax diagnostics', () => {
  compile(routePath);
  compile(componentPath);
});

test('lookup uses the shared client without requiring legacy environment credentials', async () => {
  const { GET, calls } = setup({ devices: [{ id: 'new-device', name: '53381' }] });
  const response = await GET();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(payload.configured, true);
  assert.equal(payload.devices[0].name, '53381');
  assert.equal(payload.devices[0].assignedEquipmentId, null);
  assert.deepEqual(calls.map(c => c.kind), ['shared-client', 'api', 'sql']);
  assert.equal(calls[1].method, 'Get');
  assert.equal(calls[1].params.typeName, 'Device');
});

test('active-date and no-device filters match the existing lookup behavior', async () => {
  const { GET } = setup({ devices: [
    { id: 'current', name: 'current', activeFrom: '2020-01-01', activeTo: '2099-01-01' },
    { id: 'unbounded', name: 'unbounded' },
    { id: 'historic', name: 'historic', activeTo: '2001-01-01' },
    { id: 'future', name: 'future', activeFrom: '2099-01-01' },
    { id: 'NoDeviceId', name: 'placeholder' },
    { name: 'missing identifier' },
  ]});
  const payload = await (await GET()).json();
  assert.deepEqual(payload.devices.map(d => d.id), ['current', 'unbounded']);
});

test('assignments, VIN normalization, serial numbers and numeric sort are preserved', async () => {
  const { GET, calls } = setup({
    devices: [
      { Id: 'b', Name: '10', VehicleIdentificationNumber: ' vin-example ', SerialNumber: ' serial ' },
      { id: 'a', name: '2' },
    ],
    assignments: [{ geotab_device_id: 'b', equipment_id: 42, unit: '10' }],
  });
  const payload = await (await GET()).json();
  assert.deepEqual(payload.devices.map(d => d.name), ['2', '10']);
  assert.equal(payload.devices[1].vin, 'VIN-EXAMPLE');
  assert.equal(payload.devices[1].serialNumber, 'serial');
  assert.equal(payload.devices[1].assignedEquipmentId, 42);
  assert.equal(payload.devices[1].assignedUnit, '10');
  for (const call of calls.filter(c => c.kind === 'sql')) {
    assert.match(call.sql, /^\s*SELECT/i);
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  }
});

test('a genuinely empty Geotab result is distinct from a failed lookup', async () => {
  const response = await setup().GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: true, devices: [] });
});

for (const scenario of [
  { name: 'connection failure', option: 'connectionError', code: 'GEOTAB_CONNECTION_FAILED', stage: 'connection' },
  { name: 'device API failure', option: 'lookupError', code: 'GEOTAB_DEVICE_LOOKUP_FAILED', stage: 'devices' },
  { name: 'assignment database failure', option: 'assignmentError', code: 'GEOTAB_ASSIGNMENTS_LOAD_FAILED', stage: 'assignments' },
]) {
  test(scenario.name + ' returns safe, distinct diagnostics', async () => {
    const secret = 'password=do-not-disclose sessionId=private user@example.invalid';
    const { GET, logs } = setup({ [scenario.option]: new Error(secret) });
    const response = await GET();
    const text = await response.text();
    const payload = JSON.parse(text);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(payload.code, scenario.code);
    assert.match(payload.requestId, /^[a-f0-9-]{36}$/i);
    assert.doesNotMatch(text + JSON.stringify(logs), /do-not-disclose|private|user@example/);
    assert.equal(logs[0].stage, scenario.stage);
    assert.equal(logs[0].requestId, payload.requestId);
  });
}

test('malformed API data does not become a silent empty list', async () => {
  for (const devices of [null, {}, [null], ['bad-row']]) {
    const response = await setup({ devices }).GET();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'GEOTAB_DEVICE_LOOKUP_FAILED');
  }
});

test('component retains error state across modal initialization and exposes retry', () => {
  const source = readFileSync(componentPath, 'utf8');
  const modalSection = source.slice(source.indexOf('function wireModal()'), source.indexOf('const nativeFetch'));
  assert.doesNotMatch(modalSection, /setLoadError|setEquipmentError/);
  assert.match(source, /Refresh Geotab devices/);
  assert.match(source, /No active Geotab device matches/);
  assert.match(source, /if \(!response\.ok \|\| payload\.error\)/);
  assert.match(source, /if \(tracking\.enabled && !tracking\.deviceId\)/);
  assert.match(source, /if \(!trackingRef\.current\.equipmentReady\)/);
});

function modalHarness({ unit = 'new-unit', equipment = [], ready = false } = {}) {
  const source = ts.createSourceFile(componentPath, readFileSync(componentPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'wireModal') declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, 'modal initializer must exist');
  const js = ts.transpileModule(declaration.getText(source) + '\nwireModal();', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const target = {};
  const input = { value: unit, disabled: false };
  const grid = { querySelector: () => target };
  const modal = { querySelector: () => grid };
  const context = {
    document: { querySelector: () => modal },
    findLabel: () => ({ querySelector: () => input }),
    equipment, equipmentReady: ready, mount: null, editingId: null,
    enabled: true, deviceId: 'previous-unit-device', filter: 'previous',
    initializedMountRef: { current: null },
    trackingRef: { current: { enabled: true, deviceId: 'previous-unit-device', equipmentReady: false } },
  };
  for (const key of ['Mount', 'EditingId', 'Enabled', 'DeviceId', 'Filter']) {
    const field = key[0].toLowerCase() + key.slice(1);
    context['set' + key] = value => { context[field] = value; };
  }
  return { context, run: () => vm.runInNewContext(js, context) };
}

test('a modal opened before equipment loads initializes safely after the response arrives', () => {
  const { context, run } = modalHarness();
  run();
  assert.equal(context.trackingRef.current.equipmentReady, false);
  assert.equal(context.initializedMountRef.current, null);
  context.equipmentReady = true;
  run();
  assert.equal(context.enabled, false);
  assert.equal(context.deviceId, '');
  assert.equal(context.trackingRef.current.equipmentReady, true);
  assert.equal(context.initializedMountRef.current, context.mount);
});

test('existing device links initialize and subsequent modal observations preserve user selections', () => {
  const { context, run } = modalHarness({
    unit: '53381', ready: true,
    equipment: [{ id: 42, unit: '53381', geotabDeviceId: 'existing-device' }],
  });
  run();
  assert.equal(context.enabled, true);
  assert.equal(context.deviceId, 'existing-device');
  assert.equal(context.editingId, 42);
  context.deviceId = 'user-selected-device';
  context.trackingRef.current.deviceId = 'user-selected-device';
  run();
  assert.equal(context.deviceId, 'user-selected-device');
  assert.equal(context.trackingRef.current.deviceId, 'user-selected-device');
});
