import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workOrders=readFileSync(new URL('../lib/work-orders.ts',import.meta.url),'utf8');
const reviewPage=readFileSync(new URL('../app/work-orders/page.tsx',import.meta.url),'utf8');

test('work order data includes Current Work repair photos',()=>{
  assert.match(workOrders,/FROM repair_work_photos/);
  assert.match(workOrders,/const photosByRepair=new Map/);
  assert.match(workOrders,/url:repairPhotoUrl\(photo\.object_key\)/);
  assert.match(workOrders,/const repairPhotos=group\.flatMap/);
  assert.match(workOrders,/repairs:group,technicianNotes:notes,laborEntries,usedParts,repairPhotos/);
});

test('work order review shows a photo count and photo gallery before approval',()=>{
  assert.match(reviewPage,/>Photos<\/th>/);
  assert.match(reviewPage,/item\.repairPhotos\.length/);
  assert.match(reviewPage,/REPAIR PHOTOS/);
  assert.match(reviewPage,/href=\{photo\.url\}/);
  assert.match(reviewPage,/photo\.note\|\|"No photo note"/);
  assert.match(reviewPage,/photo\.repairIssue\|\|"Repair photo"/);
});

test('work order photo thumbnails open the stored full-size image',()=>{
  assert.match(reviewPage,/target="_blank" rel="noreferrer"/);
  assert.match(reviewPage,/img src=\{photo\.url\}/);
});
