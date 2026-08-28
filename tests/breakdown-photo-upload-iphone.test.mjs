import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('roadside photo compression does not rewrite the phone file input', async () => {
  const guard = await read('app/report-breakdown/photo-upload-guard.tsx');
  assert.doesNotMatch(guard, /new DataTransfer\(/);
  assert.doesNotMatch(guard, /input\.files\s*=/);
  assert.doesNotMatch(guard, /addEventListener\('change'/);
  assert.match(guard, /addEventListener\('formdata'/);
  assert.match(guard, /formEvent\.formData\.delete\('photos'\)/);
  assert.match(guard, /formEvent\.formData\.append\('photos'/);
});

test('roadside photos are compressed only when the form is submitted', async () => {
  const guard = await read('app/report-breakdown/photo-upload-guard.tsx');
  assert.match(guard, /const files = Array\.from\(input\?\.files \|\| \[\]\)\.slice\(0, 6\)/);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(guard, /prepareFiles\(files\)/);
  assert.match(guard, /form\.requestSubmit\(\)/);
  assert.match(guard, /TARGET_BYTES = 600_000/);
});
