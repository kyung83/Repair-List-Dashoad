import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const legacy=readFileSync(new URL('../app/api/shop/route-legacy.ts',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/shop/route.ts',import.meta.url),'utf8');
const unmatchedRoute=readFileSync(new URL('../app/api/shop/unmatched-part/route.ts',import.meta.url),'utf8');
const unmatchedLib=readFileSync(new URL('../lib/unmatched-parts.ts',import.meta.url),'utf8');
const tools=readFileSync(new URL('../app/shop/technician-repair-tools-v2.tsx',import.meta.url),'utf8');

test('mechanics and managers receive only their assigned warehouse stock in shop data',()=>{
  assert.match(legacy,/yardWarehouseCode/);
  assert.match(legacy,/scopePartsToWarehouse/);
  assert.match(legacy,/assignedWarehouseCode:shopWarehouse\.code/);
  assert.match(legacy,/warehouseStocks:\[warehouseStock\]/);
  assert.match(legacy,/partRequest\.warehouseCode === shopWarehouse\.code/);
});

test('mechanic and manager part use ignores browser warehouse choice and forces assigned warehouse',()=>{
  assert.match(route,/assignedPartWarehouse\(user\)/);
  assert.match(route,/const warehouseCode = assignedWarehouse\?\.code \?\? requestedWarehouseCode/);
  assert.match(route,/user\.role !== 'mechanic' && user\.role !== 'manager'/);
  assert.match(route,/needs an assigned yard\/parts warehouse/);
});

test('zero local stock can still create a request in the assigned warehouse',()=>{
  assert.match(route,/const stock = availability\.find/);
  assert.match(route,/const part = stock/);
  assert.match(route,/\(stock\?\.available \?\? 0\)/);
  assert.match(route,/requestPartDerived\(env\.DB/);
});

test('typed unmatched parts are pinned to the assigned warehouse',()=>{
  assert.match(unmatchedRoute,/lockedToAssignedWarehouse/);
  assert.match(unmatchedRoute,/yardWarehouseCode\(repair\.user_yard\)/);
  assert.match(unmatchedRoute,/warehouseCode:assignedWarehouseCode/);
  assert.match(unmatchedLib,/explicitWarehouseCode/);
  assert.match(unmatchedLib,/SELECT code FROM warehouses WHERE code=\? AND active=1/);
});

test('Current Work hides warehouse selection for managers and mechanics',()=>{
  assert.match(tools,/warehouseLocked=shopRole==="mechanic"\|\|shopRole==="manager"/);
  assert.match(tools,/YOUR PARTS WAREHOUSE/);
  assert.match(tools,/!warehouseLocked&&<label style=\{warehouseLabel\}>SUPPLY WAREHOUSE/);
  assert.match(tools,/effectiveWarehouseCode=warehouseLocked\?assignedWarehouseCode:warehouseCode/);
  assert.match(tools,/warehouseCode:effectiveWarehouseCode/);
});

test('reserved parts are also restricted to the assigned warehouse',()=>{
  assert.match(legacy,/This reserved part belongs to/);
  assert.match(legacy,/requestRow\.warehouse_code !== warehouse\.code/);
});
