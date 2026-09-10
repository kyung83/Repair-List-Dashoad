import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const css = fs.readFileSync('app/repair-board/planning-center.module.css', 'utf8');

test('manager Planning Center hides the temporary attention filter strip in its own stylesheet', () => {
  assert.match(css, /\.yardBar\[aria-label=["']Planning attention["']\]\{display:none!important\}/);
});
