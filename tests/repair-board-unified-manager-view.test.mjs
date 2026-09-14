import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const roleAware=await readFile(new URL('../app/repair-board/role-aware-content.tsx',import.meta.url),'utf8');
const mergedCss=await readFile(new URL('../app/repair-board/manager-board-merge.module.css',import.meta.url),'utf8');

test('manager and admin use only the new Repair Board workflow',()=>{
  assert.match(roleAware,/role==='manager'\|\|role==='admin'/);
  assert.match(roleAware,/merge\.managerBoard/);
  assert.match(roleAware,/<PlanningCenter\/>/);
  assert.doesNotMatch(roleAware,/Classic Board/);
  assert.doesNotMatch(roleAware,/managerView/);
  assert.doesNotMatch(roleAware,/RepairBoardUnassign/);
});

test('new manager board visually reuses the old compact Repair Board header',()=>{
  assert.match(mergedCss,/content:"Repair Board"/);
  assert.match(mergedCss,/aria-label="Yard filter"/);
  assert.match(mergedCss,/grid-column:2/);
  assert.match(mergedCss,/header:first-child > div:last-child/);
  assert.match(mergedCss,/flex:1 1 auto/);
});

test('obsolete attention strip is hidden while board filters remain available below',()=>{
  assert.match(mergedCss,/aria-label="Work needing attention"/);
  assert.match(mergedCss,/display:none!important/);
});
