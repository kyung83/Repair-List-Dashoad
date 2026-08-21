import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TRUCK_TIRE_AXLES,
  TRAILER_TIRE_AXLES,
  allowedTirePositionCodes,
  normalizeTirePositions,
  tireRepairRequired,
} from '../lib/tire-position-rules.js';

test('truck tire layout has steer singles and dual positions on axles 2 and 3', () => {
  assert.deepEqual(TRUCK_TIRE_AXLES.map((axle) => axle.positions.map((position) => position.code)), [
    ['A1L', 'A1R'],
    ['A2LO', 'A2LI', 'A2RI', 'A2RO'],
    ['A3LO', 'A3LI', 'A3RI', 'A3RO'],
  ]);
});

test('trailer tire layout has dual positions on both axles', () => {
  assert.deepEqual(TRAILER_TIRE_AXLES.map((axle) => axle.positions.map((position) => position.code)), [
    ['A1LO', 'A1LI', 'A1RI', 'A1RO'],
    ['A2LO', 'A2LI', 'A2RI', 'A2RO'],
  ]);
});

test('tire repair requirement is limited to tire work on trucks and trailers', () => {
  assert.equal(tireRepairRequired({ title: 'Flat tire', equipmentType: 'truck' }), true);
  assert.equal(tireRepairRequired({ title: 'Replace right tire', equipmentType: 'trailer' }), true);
  assert.equal(tireRepairRequired({ title: 'Wheel bearing', equipmentType: 'truck' }), false);
  assert.equal(tireRepairRequired({ title: 'Brake chamber', equipmentType: 'trailer' }), false);
  assert.equal(tireRepairRequired({ title: 'Flat tire', equipmentType: 'vehicle' }), false);
});

test('position validation rejects positions that do not exist on that equipment layout', () => {
  assert.deepEqual(allowedTirePositionCodes('truck'), [
    'A1L', 'A1R', 'A2LO', 'A2LI', 'A2RI', 'A2RO', 'A3LO', 'A3LI', 'A3RI', 'A3RO',
  ]);
  const truck = normalizeTirePositions(['a2ro', 'A2RO', 'A1LO'], 'truck');
  assert.deepEqual(truck.positions, ['A2RO', 'A1LO']);
  assert.deepEqual(truck.invalid, ['A1LO']);
  const trailer = normalizeTirePositions(['A1LI', 'A3RO'], 'trailer');
  assert.deepEqual(trailer.invalid, ['A3RO']);
});

test('technician workflow saves tire positions and blocks REPAIRED until saved', async () => {
  const [control, route, migration] = await Promise.all([
    readFile(new URL('../app/shop/found-repair-control.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/shop/found-repair/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0091_repair_tire_positions.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(control, /TIRE POSITION REQUIRED/);
  assert.match(control, /saveTirePositions/);
  assert.match(control, /startsWith\("REPAIRED"\)/);
  assert.match(route, /replaceTirePositions/);
  assert.match(route, /tire_positions_selected/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS repair_tire_positions/);
  assert.match(migration, /UNIQUE \(repair_id, position_code\)/);
});
