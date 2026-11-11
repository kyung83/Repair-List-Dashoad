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
  assert.match(page,/newInventoryHref\(item\)/);
  assert.match(page,/Convert to Inventory/);
  assert.match(page,/sourceRequestId:item\.id/);
  assert.doesNotMatch(page,/href="\/inventory\?new=1"/);
  assert.doesNotMatch(page,/setOneTime\(\{\.\.\.blankOneTime,warehouseCode:yard==='ALL'\?'':yard\}\)/);
  assert.match(route,/action === 'createOneTimePart'/);
  assert.match(route,/handleUnmatchedPartRequest\(env\.DB,sourceRequestId\)/);
  assert.match(route,/action === 'convertOneTimePart'/);
  assert.match(route,/action === 'receiveExistingOneTimePart'/);
  assert.match(route,/action === 'matchUnmatchedToCatalog'/);
  assert.match(page,/PREVIOUS ONE-TIME PARTS/);
  assert.match(page,/Buy Again as One-Time/);
  assert.match(page,/Convert to Inventory/);
  assert.match(page,/historySearch/);
  assert.match(service,/listOneTimePartHistory/);
  assert.match(service,/purchase_count/);
  assert.match(service,/repair_count/);
  assert.match(service,/receiveExistingOneTimePart/);
  assert.match(service,/quantity_on_hand=quantity_on_hand\+\?/);
  assert.match(service,/inventory_class='one_time'/);
  assert.match(service,/UPDATE parts[\s\S]*inventory_class='stock'/);
});

test('stocked item creation from a technician request carries request context into inventory',async()=>{
  const [inventoryPage,unmatched]=await Promise.all([
    read('app/inventory/page.tsx'),
    read('lib/unmatched-parts.ts'),
  ]);
  assert.match(inventoryPage,/requestId/);
  assert.match(inventoryPage,/requestedQuantity/);
  assert.match(inventoryPage,/matchUnmatchedToCatalog/);
  assert.match(inventoryPage,/Initial quantity means physical stock actually on hand, not the quantity requested/);
  assert.match(unmatched,/matchUnmatchedPartRequestToCatalog/);
  assert.match(unmatched,/INSERT INTO repair_part_requests/);
  assert.match(unmatched,/requested_quantity=MAX\(repair_part_requests\.requested_quantity,excluded\.requested_quantity\)/);
  assert.match(unmatched,/SET status='handled'/);
});

test('normal inventory excludes one-time parts and new stocked parts are warehouse-scoped',async()=>{
  const [db,page]=await Promise.all([
    read('lib/inventory-db.ts'),
    read('app/inventory/page.tsx'),
  ]);
  assert.match(db,/COALESCE\(p\.inventory_class,'stock'\)='stock'/);
  assert.match(db,/initialWarehouseCode/);
  assert.match(db,/INSERT INTO part_warehouse_stock/);
  assert.match(db,/already exists as a one-time part/);
  assert.match(db,/Previous One-Time Parts/);
  assert.match(page,/\+ New inventory item/);
  assert.match(page,/Initial warehouse/);
  assert.match(page,/const params = new URLSearchParams\(window\.location\.search\)/);
  assert.match(page,/params\.get\("new"\) !== "1"/);
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


test('previous one-time parts keep one permanent part identity through repeat buys and conversion',async()=>{
  const [service,route,page,inventoryDb]=await Promise.all([
    read('lib/one-time-parts.ts'),
    read('app/api/parts-desk/route.ts'),
    read('app/parts-desk/page.tsx'),
    read('lib/inventory-db.ts'),
  ]);
  assert.match(service,/WHERE p\.active=1 AND p\.deleted_at IS NULL AND p\.inventory_class='one_time'/);
  assert.match(service,/COUNT\(DISTINCT rp\.repair_id\)/);
  assert.match(service,/INSERT OR IGNORE INTO part_warehouse_stock/);
  assert.match(service,/INSERT INTO one_time_part_receipts/);
  assert.match(service,/preferred_vendor_id=COALESCE/);
  assert.match(service,/converted_to_stock_at=CURRENT_TIMESTAMP/);
  assert.match(service,/location=CASE WHEN location LIKE 'ONE-TIME%'/);
  assert.match(route,/oneTimeHistory/);
  assert.match(route,/receiveExistingOneTimePart/);
  assert.match(page,/existingPartId/);
  assert.match(page,/Same part number and repair history retained/);
  assert.match(inventoryDb,/Search Previous One-Time Parts on Parts Desk and use Convert to Inventory/);
});
