import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const outsideRoute=await readFile(new URL('app/api/outside-work/route.ts',root),'utf8');
const vendorRoute=await readFile(new URL('app/api/outside-work/vendors/route.ts',root),'utf8');
const correctionRoute=await readFile(new URL('app/api/outside-work/corrections/route.ts',root),'utf8');
const inventoryDb=await readFile(new URL('lib/inventory-db.ts',root),'utf8');
const migration=await readFile(new URL('migrations/0090_separate_outside_work_vendors.sql',root),'utf8');

test('Outside Work reads and writes only its own vendor master',()=>{
  assert.match(outsideRoute,/FROM outside_work_vendors/);
  assert.match(outsideRoute,/INSERT INTO outside_work_vendors/);
  assert.match(outsideRoute,/outside_vendor_id/);
  assert.doesNotMatch(outsideRoute,/INSERT INTO vendors\s*\(/);
  assert.match(vendorRoute,/FROM outside_work_vendors/);
  assert.match(vendorRoute,/INSERT INTO outside_work_vendors/);
  assert.doesNotMatch(vendorRoute,/FROM vendors\b/);
  assert.doesNotMatch(vendorRoute,/INSERT INTO vendors\b/);
  assert.match(correctionRoute,/FROM outside_work_vendors/);
});

test('Inventory continues to use the inventory supplier master',()=>{
  assert.match(inventoryDb,/FROM vendors WHERE COALESCE\(active, 1\) = 1/);
  assert.match(inventoryDb,/INSERT INTO vendors \(name, phone, email, notes\)/);
  assert.doesNotMatch(inventoryDb,/outside_work_vendors/);
});

test('migration severs the old shared vendor relationship',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS outside_work_vendors/);
  assert.match(migration,/ADD COLUMN outside_vendor_id/);
  assert.match(migration,/SET vendor_id=NULL/);
  assert.match(migration,/REFERENCES outside_work_vendors\(id\)/);
});
