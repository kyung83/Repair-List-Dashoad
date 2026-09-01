import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/repair-board/dashboard-v2.tsx', import.meta.url), 'utf8');

test('Repair Board opens only active repairs on first paint', () => {
  assert.match(page, /new Set\(\["active"\]\)/);
  assert.doesNotMatch(page, /new Set\(\["active","annuals"\]\)/);
});

test('Repair Board paints core board data before ETA yard and order extras finish', () => {
  const setDataIndex = page.indexOf('setData(B)');
  const extrasAwaitIndex = page.indexOf('const[e,y,o]=await extras');
  assert.ok(setDataIndex >= 0, 'core board response must set data');
  assert.ok(extrasAwaitIndex >= 0, 'ancillary requests must be awaited separately');
  assert.ok(setDataIndex < extrasAwaitIndex, 'board data should render before ancillary requests finish');
});
