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

test('receipt originals are stored and verified before the server attempts OCR',async()=>{
  const source=await read('lib/breakdown-driver-receipt-server.ts');
  const saveIndex=source.indexOf('await replaceReceiptPages(receipt.id,breakdownId,files)');
  const readIndex=source.indexOf('readOutsideWorkInvoice(ai,env.DB,files)');
  assert.ok(saveIndex>=0,'receipt pages should be saved');
  assert.ok(readIndex>saveIndex,'AI reading must happen only after the originals are saved');
  assert.match(source,/SELECT COUNT\(\*\) AS count FROM roadside_breakdown_receipt_pages/);
  assert.match(source,/Receipt image storage could not be verified/);
  assert.match(source,/ai_status='upload_failed'/);
  assert.match(source,/Please try the upload again before leaving this screen/);
  assert.match(source,/ai_status='manual_review'/);
  assert.match(source,/image\/heic/);
  assert.match(source,/image\/heif/);
});

test('failed replacement does not delete the previous receipt before the new one is committed',async()=>{
  const source=await read('lib/breakdown-driver-receipt-server.ts');
  const uploadIndex=source.indexOf('await env.FILES.put');
  const batchIndex=source.indexOf('await env.DB.batch(statements)');
  const oldDeleteIndex=source.indexOf('await env.FILES.delete(page.object_key)');
  assert.ok(uploadIndex>=0&&batchIndex>uploadIndex,'new receipt objects should upload before the D1 page swap');
  assert.ok(oldDeleteIndex>batchIndex,'old receipt objects should only be removed after the new page rows are committed');
});

test('driver screen never shows receipt uploaded for an upload failure state',async()=>{
  const source=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(source,/state\.receipt\.aiStatus!=='upload_failed'/);
  assert.match(source,/state\.receipt\.aiStatus!=='uploading'/);
  assert.match(source,/Receipt uploaded\. Northern will read and review it on our side\./);
});

test('office closeout auto-refreshes receipt status without overwriting typed values',async()=>{
  const source=await read('app/breakdowns/driver-receipt-review.tsx');
  assert.match(source,/setInterval\(\(\)=>void load\(true\),10000\)/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/current\.vendor\|\|receipt\?\.vendor/);
  assert.match(source,/receiptRecord&&receiptRecord\.pages\.length>0/);
  assert.match(source,/driver attempted a receipt upload, but no receipt image was saved/i);
});

test('public driver receipt POST uses the server-side uploader',async()=>{
  const route=await read('app/api/breakdowns/driver/route.ts');
  assert.match(route,/uploadAndReadDriverBreakdownReceipt/);
  assert.doesNotMatch(route,/uploadDriverBreakdownReceipt\(/);
});
