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
  assert.match(page,/data\?\.viewerRole === "admin"[\s\S]*deletePart\(item\)/);

  assert.match(service,/UPDATE parts SET active=\?,updated_at=CURRENT_TIMESTAMP/);
});

test('Permanent part delete preserves inventory and repair history',async()=>{
  const service=await read('lib/inventory-part-management.ts');

  assert.match(service,/still has warehouse stock or on-order quantity/);
  assert.match(service,/repair_parts WHERE part_id=\?/);
  assert.match(service,/inventory_operation_lines WHERE part_id=\?/);
  assert.match(service,/parts_receipts WHERE part_id=\?/);
  assert.match(service,/inventory_transfers WHERE part_id=\?/);
  assert.match(service,/pm_kit_parts WHERE part_id=\?/);
  assert.match(service,/Archive it instead so history stays intact/);
  assert.match(service,/DELETE FROM part_cross_references WHERE part_id=\?/);
  assert.match(service,/DELETE FROM part_warehouse_stock WHERE part_id=\?/);
  assert.match(service,/DELETE FROM parts WHERE id=\?/);
});

test('Inventory can explicitly load archived parts without changing active-only default',async()=>{
  const [db,route]=await Promise.all([
    read('lib/inventory-db.ts'),
    read('app/api/inventory/route.ts'),
  ]);

  assert.match(db,/status: 'active'\|'archived'\|'all' = 'active'/);
  assert.match(db,/status === 'archived' \? 'WHERE p\.active = 0'/);
  assert.match(db,/active: Number\(row\.active\) === 1/);
  assert.match(route,/searchParams\.get\('status'\)/);
  assert.match(route,/viewerRole:user\.role/);
});
