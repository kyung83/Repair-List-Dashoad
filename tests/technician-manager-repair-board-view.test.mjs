import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const roleAware=readFileSync(new URL('../app/repair-board/role-aware-content.tsx',import.meta.url),'utf8');
const planning=readFileSync(new URL('../app/repair-board/planning-center.tsx',import.meta.url),'utf8');

test('mechanics use the same Planning Center Repair Board composition as managers',()=>{
  assert.match(roleAware,/role==='manager'\|\|role==='admin'\|\|role==='mechanic'/);
  assert.match(roleAware,/className=\{merge\.managerBoard\}><PlanningCenter\/>/);
  assert.doesNotMatch(roleAware,/RepairBoardSelfAssignPanel/);
});

test('shared Planning Center keeps manager-only controls behind canManage',()=>{
  assert.match(planning,/data\?\.canManage/);
  assert.match(planning,/selected\.size>0/);
  assert.match(planning,/Set ETA \/ Depart/);
  assert.match(planning,/\+ Add Repair/);
  assert.match(planning,/Mark OOS/);
  assert.match(planning,/Check Geotab/);
});

test('technicians retain safe claim and My Work actions inside the shared board',()=>{
  assert.match(planning,/if\(!data\?\.canManage\)/);
  assert.match(planning,/action:'assignToMe'/);
  assert.match(planning,/>Assign to Me<\/button>/);
  assert.match(planning,/href="\/shop">Open My Work<\/a>/);
  assert.match(planning,/const mine=myTechId>0&&Number\(row\.technicianId\?\?0\)===myTechId/);
});
