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
