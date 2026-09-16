import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/shop/route.ts',import.meta.url),'utf8');

test('Done Working reconciles outstanding part requests back to Waiting for Parts',()=>{
  assert.match(route,/async function hasOpenPartNeed\(repairId:number\)/);
  assert.match(route,/repair_part_requests[\s\S]*requested_quantity\s*>\s*used_quantity\s*\+\s*0\.000001/);
  assert.match(route,/unmatched_part_requests[\s\S]*status='open'/);
  assert.match(route,/action === 'doneUnit'/);
  assert.match(route,/reconcileDoneUnitWaiting/);
  assert.match(route,/status='Waiting for Parts'/);
});

test('Waiting reconciliation preserves the assigned technician',()=>{
  const block=route.slice(route.indexOf('async function reconcileDoneUnitWaiting'),route.indexOf('async function restoreWorkingManagerAssignments'));
  assert.match(block,/UPDATE repairs/);
  assert.doesNotMatch(block,/SET[\s\S]*technician_id\s*=/);
});
