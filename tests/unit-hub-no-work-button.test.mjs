import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const unit=readFileSync(new URL('../app/unit/page.tsx',import.meta.url),'utf8');

test('Unit Hub does not show a Work on this Unit shortcut after lookup',()=>{
  assert.doesNotMatch(unit,/Work on this Unit/);
  assert.doesNotMatch(unit,/const canWork=/);
});
