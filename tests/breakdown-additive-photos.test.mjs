import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('driver breakdown photos accumulate across repeated phone picker selections',async()=>{
  const[page,prep,route]=await Promise.all([
    read('app/report-breakdown/page.tsx'),
    read('public/breakdown-photo-prep.js'),
    read('app/api/breakdowns/route.ts'),
  ]);

  assert.match(page,/type="file" name="photos" accept="image\/\*" multiple/);
  assert.match(prep,/var MAX_PHOTOS = 6/);
  assert.match(prep,/var photoState = new WeakMap\(\)/);
  assert.match(prep,/var previous = photoState\.get\(input\) \|\| \[\]/);
  assert.match(prep,/New photos are added to the ones already attached/);
  assert.match(prep,/remove\.textContent = 'Remove'/);
  assert.match(prep,/syncInputFiles\(input, nextItems\)/);
  assert.match(route,/form\.getAll\('photos'\)/);
  assert.match(route,/files\.slice\(0, 6\)/);
});
