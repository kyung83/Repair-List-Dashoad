import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('inventory cross references stay attached to one canonical stocked part',async()=>{
  const [migration,helper,inventory,derived,tech]=await Promise.all([
    read('migrations/0146_inventory_crossrefs_transfers_receiving.sql'),
    read('lib/part-cross-references.ts'),
    read('lib/inventory-db.ts'),
    read('lib/derived-reservations.ts'),
    read('app/shop/technician-repair-tools-v2.tsx'),
  ]);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS part_cross_references/);
  assert.match(migration,/normalized_cross_part_number TEXT NOT NULL UNIQUE/);
  assert.match(helper,/replacePartCrossReferences/);
  assert.match(helper,/already a cross-reference for/);
  assert.match(inventory,/crossReferences: crossReferencesByPart/);
  assert.match(derived,/crossReferences:crossReferences\.get/);
  assert.match(tech,/part\.crossReferences/);
  assert.match(tech,/Cross:/);
});

test('inventory transfers use one auditable operation and require notes',async()=>{
  const [migration,service,route,page]=await Promise.all([
    read('migrations/0146_inventory_crossrefs_transfers_receiving.sql'),
    read('lib/inventory-transfers.ts'),
    read('app/api/inventory/transfer/route.ts'),
    read('app/inventory-transfer/page.tsx'),
  ]);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS inventory_transfers/);
  assert.match(migration,/transfer_kind TEXT NOT NULL CHECK \(transfer_kind IN \('terminal','outside','remove'\)\)/);
  assert.match(migration,/notes TEXT NOT NULL CHECK/);
  assert.match(service,/operation_type,user_id,note/);
  assert.match(service,/inventory_transfer/);
  assert.match(service,/transfer_out/);
  assert.match(service,/transfer_in/);
  assert.match(service,/Transfer notes are required/);
  assert.match(service,/derived_repair_part_reservations/);
  assert.match(route,/Manager or administrator access is required/);
  assert.match(page,/Another terminal/);
  assert.match(page,/Outside \/ other location/);
  assert.match(page,/Remove from inventory/);
  assert.match(page,/TRANSFER NOTES — REQUIRED/);
});

test('parts receiving reads invoice lines, matches cross references, and posts inventory receipts',async()=>{
  const [migration,reader,route,service,page,nav]=await Promise.all([
    read('migrations/0146_inventory_crossrefs_transfers_receiving.sql'),
    read('lib/parts-receiving-ai.ts'),
    read('app/api/parts-receiving/route.ts'),
    read('lib/parts-receiving.ts'),
    read('app/parts-receiving/page.tsx'),
    read('app/navigation-config.ts'),
  ]);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS parts_receipts/);
  assert.match(reader,/openai\/gpt-5\.6-sol/);
  assert.match(reader,/lineItems/);
  assert.match(reader,/matchPartReference/);
  assert.match(route,/receiveInventoryPart/);
  assert.match(route,/rememberCrossReference/);
  assert.match(service,/operation_type,user_id,note/);
  assert.match(service,/parts_receipt/);
  assert.match(service,/line_type\)\s*SELECT[\s\S]*'receipt'/);
  assert.match(page,/TAKE PHOTO/);
  assert.match(page,/UPLOAD INVOICE/);
  assert.match(page,/Remember \{line\.partNumber\}/);
  assert.match(page,/RECEIVE \{lines\.filter/);
  assert.match(nav,/\/parts-receiving/);
  assert.match(nav,/\/inventory-controls/);
});
