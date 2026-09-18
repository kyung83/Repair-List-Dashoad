import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../migrations/0148_manage_parts_warehouses.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/admin/warehouses/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/admin/warehouses/page.tsx',import.meta.url),'utf8');
const userApi=readFileSync(new URL('../app/api/admin/user-yards/route.ts',import.meta.url),'utf8');
const userAssignments=readFileSync(new URL('../app/admin/users/yard-assignments.tsx',import.meta.url),'utf8');
const nav=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const maintenance=readFileSync(new URL('../app/api/maintenance-subrepairs/route.ts',import.meta.url),'utf8');

test('warehouse migration adds explicit user assignment and leaves only Clare and Cadillac active initially',()=>{
  assert.match(migration,/ALTER TABLE app_users ADD COLUMN parts_warehouse_id INTEGER/);
  assert.match(migration,/code IN \('CLARE','CADILLAC'\)/);
  assert.match(migration,/WHEN 'clare' THEN 'CLARE'/);
  assert.match(migration,/WHEN 'cadillac' THEN 'CADILLAC'/);
});

test('admin can create archive restore and safely delete parts warehouses',()=>{
  assert.match(api,/action==='create'/);
  assert.match(api,/action==='archive'/);
  assert.match(api,/action==='restore'/);
  assert.match(api,/action==='delete'/);
  assert.match(api,/canArchive/);
  assert.match(api,/canDelete/);
  assert.match(api,/permanently deleted|cannot be permanently deleted/i);
  assert.match(api,/unmatched_part_requests/);
});

test('warehouse admin screen exposes add active archived and safe delete controls',()=>{
  assert.match(page,/Parts Warehouses/);
  assert.match(page,/\+ Add Warehouse/);
  assert.match(page,/Active warehouses/);
  assert.match(page,/Archived warehouses/);
  assert.match(page,/Archive/);
  assert.match(page,/Delete/);
  assert.match(page,/Restore/);
});

test('user setup assigns yard and parts warehouse independently from active database warehouses',()=>{
  assert.match(userApi,/parts_warehouse_id/);
  assert.match(userApi,/SELECT id,code,name FROM warehouses WHERE active=1/);
  assert.match(userAssignments,/Yard & parts warehouse assignments/);
  assert.match(userAssignments,/Parts Warehouse/);
  assert.match(userAssignments,/partsWarehouseId/);
});

test('Parts Warehouses is linked from Setup',()=>{
  assert.match(nav,/href: "\/admin\/warehouses", label: "Parts Warehouses"/);
});

test('PM and Annual subrepair parts use the explicit active warehouse assignment',()=>{
  assert.match(maintenance,/JOIN warehouses w ON w\.id=u\.parts_warehouse_id AND w\.active=1/);
  assert.match(maintenance,/warehouseCode: await assignedWarehouseCode\(user\.id\)/);
  assert.doesNotMatch(maintenance,/fallbackYard: await assignedYard/);
});
