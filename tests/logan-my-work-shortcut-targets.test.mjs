import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const work=readFileSync(new URL('../app/shop/current-work-home.tsx',import.meta.url),'utf8');
const checklist=readFileSync(new URL('../app/shop/maintenance-checklist-panel-v3.tsx',import.meta.url),'utf8');

test('Logan pilot Notes and Parts shortcuts target actual sections',()=>{
  assert.match(work,/\["Notes","pilot-notes"\]/);
  assert.match(work,/\["Parts","pilot-parts-section"\]/);
  assert.match(work,/id=\{pilot\?"pilot-parts-section":undefined\}|id="pilot-parts-section"/);
  assert.match(checklist,/id="pilot-notes"/);
});
test('original non-pilot notes workflow stays available',()=>{
  assert.match(checklist,/props\.compact\?/);
  assert.match(checklist,/:<TechnicianRepairTools repairId=\{props\.repairId\} canWork=\{props\.canWork\} mode="notes"\/>/);
});
