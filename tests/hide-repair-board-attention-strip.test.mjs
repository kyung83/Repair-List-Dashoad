import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const board = fs.readFileSync('app/repair-board/planning-center.tsx', 'utf8');

test('manager Planning Center does not render the temporary attention filter strip', () => {
  assert.doesNotMatch(board, /aria-label=["']Planning attention["']/);
  assert.doesNotMatch(board, />SHOW<\/strong>/);
});
