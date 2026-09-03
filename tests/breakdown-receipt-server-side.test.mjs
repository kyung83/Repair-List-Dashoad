import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('driver receipt control only uploads selected files and does no image processing',async()=>{
  const source=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(source,/type="file"/);
  assert.match(source,/accept="image\/\*"/);
  assert.match(source,/form\.append\('receipt',file,file\.name\)/);
  assert.doesNotMatch(source,/document\.createElement\('canvas'\)/);
  assert.doesNotMatch(source,/new Image\(\)/);
  assert.doesNotMatch(source,/prepareReceiptFile/);
  assert.doesNotMatch(source,/showPicker/);
  assert.doesNotMatch(source,/DataTransfer/);
});

test('receipt originals are stored before the server attempts OCR',async()=>{
  const source=await read('lib/breakdown-driver-receipt-server.ts');
  const saveIndex=source.indexOf('await replaceReceiptPages(receipt.id,breakdownId,files)');
  const readIndex=source.indexOf('readOutsideWorkInvoice(ai,env.DB,files)');
  assert.ok(saveIndex>=0,'receipt pages should be saved');
  assert.ok(readIndex>saveIndex,'AI reading must happen only after the originals are saved');
  assert.match(source,/ai_status='manual_review'/);
  assert.match(source,/image\/heic/);
  assert.match(source,/image\/heif/);
});

test('public driver receipt POST uses the server-side uploader',async()=>{
  const route=await read('app/api/breakdowns/driver/route.ts');
  assert.match(route,/uploadAndReadDriverBreakdownReceipt/);
  assert.doesNotMatch(route,/uploadDriverBreakdownReceipt\(/);
});

test('driver upload success requires an actual saved receipt page',async()=>{
  const route=await read('app/api/breakdowns/driver/route.ts');
  assert.match(route,/receipt_page_count/);
  assert.match(route,/roadside_breakdown_receipt_pages/);
  assert.match(route,/uploaded:Number\(dispatch\?\.receipt_page_count\|\|0\)>0/);
  assert.match(route,/if\(!breakdown\.receipt\.uploaded\)/);
  assert.match(route,/Receipt could not be verified after upload/);
});

test('office receipt view auto-syncs while waiting and stops at Rolling',async()=>{
  const page=await read('app/breakdowns/driver-receipt-review.tsx');
  assert.match(page,/window\.setInterval\(tick,10000\)/);
  assert.match(page,/document\.visibilityState==='visible'/);
  assert.match(page,/if\(rolling\)return;/);
  assert.match(page,/receiptRecord&&receiptRecord\.pages\.length>0/);
  assert.match(page,/no saved receipt image is attached to this breakdown/);
});
