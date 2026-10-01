import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('../app/repair-board/planning-center.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/api/repair-board/original.ts', import.meta.url), 'utf8');

test('Planning Center groups duplicate equipment rows under one visible truck or trailer unit', () => {
  assert.match(board, /const normalizedBoardUnit=/);
  assert.match(board, /return unit\?\`u-\$\{kind\(row\.equipmentType\)\}-\$\{unit\}\`/);
  assert.doesNotMatch(board, /const rowKey=\(row:Row\)=>row\.equipmentId\?/);
});

test('raw DVIR query chooses one canonical non-merged equipment row instead of multiplying a defect', () => {
  assert.doesNotMatch(api, /LEFT JOIN equipment e ON lower\(trim\(e\.unit\)\) = lower\(trim\(d\.asset_unit\)\)/);
  assert.match(api, /LEFT JOIN equipment e ON e\.id = \([\s\S]*FROM equipment e2[\s\S]*merged_into_equipment_id IS NULL[\s\S]*LIMIT 1[\s\S]*\)/);
  assert.match(api, /equipment_geotab_devices assignment[\s\S]*assignment\.current = 1/);
});

test('repair creation does not reactivate a merged equipment tombstone', () => {
  const selector = api.match(/async function equipmentIdForUnit[\s\S]*?return created\.id;\n\}/)?.[0] ?? '';
  assert.match(selector, /merged_into_equipment_id IS NULL/);
  assert.match(selector, /equipment_geotab_devices assignment/);
});
