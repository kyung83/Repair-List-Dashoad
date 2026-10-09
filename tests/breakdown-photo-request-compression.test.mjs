import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('roadside photo picker remains native and untouched', async () => {
  const source = await read('app/report-breakdown/breakdown-photo-request-compressor.tsx');
  assert.doesNotMatch(source, /addEventListener\(/);
  assert.doesNotMatch(source, /showPicker/);
  assert.doesNotMatch(source, /touchend/);
  assert.doesNotMatch(source, /new DataTransfer/);
  assert.doesNotMatch(source, /input\.files\s*=/);
});

test('large roadside photos are compressed only in the outgoing breakdown request', async () => {
  const source = await read('app/report-breakdown/breakdown-photo-request-compressor.tsx');
  const layout = await read('app/report-breakdown/layout.tsx');
  assert.match(layout, /BreakdownPhotoRequestCompressor/);
  assert.match(source, /window\.fetch = compressedFetch/);
  assert.match(source, /requestPath\(input\) !== '\/api\/breakdowns'/);
  assert.match(source, /init\?\.body instanceof FormData/);
  assert.match(source, /getAll\('photos'\)/);
  assert.match(source, /prepareBreakdownForm/);
  assert.match(source, /MAX_PER_PHOTO_BYTES = 700_000/);
  assert.match(source, /MAX_DIMENSION = 1600/);
  assert.match(source, /new File\(\[best\]/);
  assert.match(source, /type: 'image\/jpeg'/);
});

test('driver breakdowns show the original clear red warning for any photo-size 413 response', async () => {
  const page = await read('app/report-breakdown/page.tsx');
  const compressor = await read('app/report-breakdown/breakdown-photo-request-compressor.tsx');
  assert.match(page, /if \(response\.status===413\) throw new Error\('That photo is too large to upload\. Choose a smaller photo and try again\.'\)/);
  assert.match(page, /setResult\(\{ error:/);
  assert.match(compressor, /status: 413/);
});
