import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('unfinished breakdown details survive a tablet browser reload', async () => {
  const source = await read('app/report-breakdown/page.tsx');
  assert.match(source, /BREAKDOWN_DRAFT_KEY/);
  assert.match(source, /readBreakdownDraft\(\)/);
  assert.match(source, /localStorage\.setItem\(BREAKDOWN_DRAFT_KEY/);
  assert.match(source, /photo\?\.addEventListener\('click',save\)/);
  assert.match(source, /defaultValue=\{recoveredDraft\?\.fields\?\.description/);
  assert.match(source, /unfinished breakdown details were recovered/);
  assert.match(source, /localStorage\.removeItem\(BREAKDOWN_DRAFT_KEY\)/);
});

test('driver photo preparation is sequential to reduce tablet memory pressure', async () => {
  const source = await read('public/breakdown-photo-prep.js');
  assert.match(source, /for \(var index = 0; index < additions\.length; index \+= 1\)/);
  assert.match(source, /var prepared = await preparePhoto\(item\.file\)/);
  assert.doesNotMatch(source, /Promise\.all\(additions\.map/);
  assert.match(source, /20 \* 1024 \* 1024/);
});
