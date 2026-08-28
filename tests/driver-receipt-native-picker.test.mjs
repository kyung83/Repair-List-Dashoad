import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('driver receipt upload uses a native file input without programmatic picker clicks', async () => {
  const source = await read('app/report-breakdown/driver-followup.tsx');
  assert.match(source, /type="file"/);
  assert.match(source, /name="receiptPicker"/);
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /onChange=\{\(event\)=>void uploadReceipt/);
  assert.doesNotMatch(source, /receiptInputRef\.current\?\.click\(\)/);
  assert.doesNotMatch(source, /style=\{\{display:'none'\}\}/);
});

test('driver receipt still prepares and compresses the selected image after native selection', async () => {
  const source = await read('app/report-breakdown/driver-followup.tsx');
  assert.match(source, /prepareReceiptFiles\(files\)/);
  assert.match(source, /form\.append\('receipt',file,file\.name\)/);
  assert.match(source, /RECEIPT_TARGET_BYTES=700_000/);
});
