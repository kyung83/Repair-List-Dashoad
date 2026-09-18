import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../',import.meta.url);
async function read(path){return readFile(new URL(path,root),'utf8')}

test('Inventory managers can archive and restore parts while delete stays admin-only',async()=>{
  const [route,page,service]=await Promise.all([
    read('app/api/inventory/route.ts'),
    read('app/inventory/page.tsx'),
    read('lib/inventory-part-management.ts'),
  ]);

  assert.match(route,/action === 'archivePart' \|\| action === 'restorePart'/);
  assert.match(route,/user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route,/action === 'deletePart'/);
  assert.match(route,/user\.role !== 'admin'/);

  assert.match(page,/Active Parts/);
  assert.match(page,/Archived Parts/);
  assert.match(page,/archivePart\(item\)/);
  assert.match(page,/restorePart\(item\)/);
  assert.match(page,/partStatus === "active"[\s\S]*data\?\.viewerRole === "admin"[\s\S]*deletePart\(item\)/);
  assert.match(page,/Delete Part/);
  assert.match(page,/Existing repair, receiving, transfer, count, and inventory history stays intact/);

  assert.match(service,/UPDATE parts SET active=\?,updated_at=CURRENT_TIMESTAMP/);
});

test('Admin delete removes a part operationally while preserving historical foreign keys',async()=>{
  const [service,migration]=await Promise.all([
    read('lib/inventory-part-management.ts'),
    read('migrations/0147_parts_soft_delete.sql'),
  ]);

  assert.match(migration,/ALTER TABLE parts ADD COLUMN deleted_at TEXT/);
  assert.match(migration,/deleted_by_user_id INTEGER REFERENCES app_users\(id\)/);
  assert.match(service,/deletePartPreservingHistory/);
  assert.match(service,/still has warehouse stock or on-order quantity/);
  assert.match(service,/repair_part_requests[\s\S]*status='open'/);
  assert.match(service,/repair_planned_parts[\s\S]*removed_at IS NULL/);
  assert.match(service,/SET active=0,deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=\?/);
  assert.match(service,/DELETE FROM pm_kit_parts WHERE part_id=\?/);
  assert.match(service,/UPDATE part_cross_references SET active=0/);
  assert.doesNotMatch(service,/DELETE FROM parts WHERE id=\?/);
  assert.doesNotMatch(service,/DELETE FROM repair_parts/);
  assert.doesNotMatch(service,/DELETE FROM parts_receipts/);
  assert.doesNotMatch(service,/DELETE FROM inventory_operation_lines/);
});

test('Inventory can explicitly load archived parts without changing active-only default',async()=>{
  const [db,route]=await Promise.all([
    read('lib/inventory-db.ts'),
    read('app/api/inventory/route.ts'),
  ]);

  assert.match(db,/status: 'active'\|'archived'\|'all' = 'active'/);
  assert.match(db,/p\.active = 0 AND p\.deleted_at IS NULL/);
  assert.match(db,/p\.active = 1 AND p\.deleted_at IS NULL/);
  assert.match(db,/active: Number\(row\.active\) === 1/);
  assert.match(route,/searchParams\.get\('status'\)/);
  assert.match(route,/viewerRole:user\.role/);
});
