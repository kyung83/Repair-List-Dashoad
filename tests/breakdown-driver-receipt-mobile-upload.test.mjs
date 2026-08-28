import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/report-breakdown/driver-followup.tsx', import.meta.url), 'utf8');

test('driver receipt keeps the existing picker behavior and does not rewrite input files', () => {
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /receiptInputRef\.current\?\.click\(\)/);
  assert.doesNotMatch(source, /new DataTransfer\(/);
  assert.doesNotMatch(source, /input\.files\s*=/);
  assert.doesNotMatch(source, /showPicker/);
  assert.doesNotMatch(source, /touchend/);
});

test('driver receipt photos are resized before the POST request', () => {
  assert.match(source, /RECEIPT_TARGET_BYTES=700_000/);
  assert.match(source, /RECEIPT_MAX_DIMENSION=1600/);
  assert.match(source, /prepareReceiptFiles\(files\)/);
  assert.match(source, /new File\(\[best\],`\$\{receiptBaseName\(file\)\}\.jpg`/);
  assert.match(source, /form\.append\('receipt',file,file\.name\)/);
  assert.match(source, /fetch\('\/api\/breakdowns\/driver',\{method:'POST',body:form\}\)/);
});

test('driver receipt upload handles non-json and iPhone pattern errors safely', () => {
  assert.match(source, /const responseText=await response\.text\(\)/);
  assert.match(source, /response\.status===413/);
  assert.match(source, /string did not match the expected pattern/i);
  assert.match(source, /Receipt uploaded and read/);
});
