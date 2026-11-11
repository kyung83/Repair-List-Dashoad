import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

test('one-time parts have a distinct lifecycle and preserve repair source',async()=>{
  const migration=await read('migrations/0161_one_time_parts.sql');
  assert.match(migration,/inventory_class TEXT NOT NULL DEFAULT 'stock'/);
  assert.match(migration,/inventory_class IN \('stock','one_time'\)/);
  assert.match(migration,/repair_parts ADD COLUMN source_type/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS one_time_part_receipts/);
});

test('Parts Desk creates and converts one-time parts and closes matched technician requests',async()=>{
  const [page,route,service]=await Promise.all([
    read('app/parts-desk/page.tsx'),
    read('app/api/parts-desk/route.ts'),
    read('lib/one-time-parts.ts'),
  ]);
  assert.match(page,/\+ One-Time Part/);
  assert.match(page,/\+ New Inventory Item/);
  assert.match(page,/Convert to Inventory/);
  assert.match(page,/sourceRequestId:item\.id/);
  assert.doesNotMatch(page,/setOneTime\(\{\.\.\.blankOneTime,warehouseCode:yard==='ALL'\?'':yard\}\)/);
  assert.match(route,/action === 'createOneTimePart'/);
  assert.match(route,/handleUnmatchedPartRequest\(env\.DB,sourceRequestId\)/);
  assert.match(route,/action === 'convertOneTimePart'/);
  assert.match(service,/inventory_class='one_time'/);
  assert.match(service,/UPDATE parts[\s\S]*inventory_class='stock'/);
});

test('normal inventory excludes one-time parts and new stocked parts are warehouse-scoped',async()=>{
  const [db,page]=await Promise.all([
    read('lib/inventory-db.ts'),
    read('app/inventory/page.tsx'),
  ]);
  assert.match(db,/COALESCE\(p\.inventory_class,'stock'\)='stock'/);
  assert.match(db,/initialWarehouseCode/);
  assert.match(db,/INSERT INTO part_warehouse_stock/);
  assert.match(page,/\+ New inventory item/);
  assert.match(page,/Initial warehouse/);
  assert.match(page,/new URLSearchParams\(window\.location\.search\)\.get\("new"\) === "1"/);
});

test('technician lookup exposes available one-time parts without sending them to reorder',async()=>{
  const [tool,shop,legacy,derived]=await Promise.all([
    read('app/shop/technician-repair-tools-v2.tsx'),
    read('app/api/shop/route.ts'),
    read('app/api/shop/route-legacy.ts'),
    read('lib/derived-reservations.ts'),
  ]);
  assert.match(tool,/inventoryClass\?:'stock'\|'one_time'/);
  assert.match(tool,/ONE-TIME/);
  assert.match(shop,/part\.inventoryClass === 'one_time'/);
  assert.match(shop,/Parts Desk must receive\/create another one-time purchase/);
  assert.match(legacy,/part\.inventoryClass!=='one_time'\|\|Number\(part\.available\)>0\.000001/);
  assert.match(derived,/row\.inventoryClass==='stock'&&row\.minimumQuantity>0/);
});

test('one-time usage keeps cost and source on work orders and printouts',async()=>{
  const [ops,workOrders,review,print]=await Promise.all([
    read('lib/part-stock-operations.ts'),
    read('lib/work-orders.ts'),
    read('app/work-orders/inline-review-editor.tsx'),
    read('app/work-orders/print/page.tsx'),
  ]);
  assert.match(ops,/source_type/);
  assert.match(ops,/part\.inventory_class==='one_time'\?'one_time':'stock'/);
  assert.match(workOrders,/COALESCE\(rp\.source_type,'stock'\) AS source_type/);
  assert.match(workOrders,/lineCost:quantity\*unitCost/);
  assert.match(review,/ONE-TIME \/ NON-STOCK/);
  assert.match(print,/ONE-TIME \/ NON-STOCK/);
});
