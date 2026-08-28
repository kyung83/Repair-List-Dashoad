import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('roadside photo picker keeps the native input and has an iPhone touch fallback',async()=>{
  const source=await readFile(new URL('../app/report-breakdown/photo-upload-guard.tsx',import.meta.url),'utf8');
  assert.match(source,/showPicker/);
  assert.match(source,/touchend/);
  assert.doesNotMatch(source,/new DataTransfer/);
  assert.doesNotMatch(source,/input\.files\s*=/);
});
