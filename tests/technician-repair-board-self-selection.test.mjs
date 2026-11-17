import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('mechanics can select unassigned units on the board without manager permissions',()=>{
 const ui=read('app/repair-board/planning-center.tsx');
 assert.match(ui,/function claimableRows\(group:Group\)/);
 assert.match(ui,/row\.technicianId===null&&!row\.activeTimer/);
 assert.match(ui,/ids=claimable\.map\(row=>row\.id\)/);
 assert.match(ui,/ids\.length>0\s*\? <input aria-label=/);
 assert.match(ui,/ASSIGN SELECTED TO ME/);
 assert.match(ui,/action:'assignToMe'/);
 assert.match(ui,/Open Shop Jobs to start work/);
});

test('self-assignment preserves the existing secure technician and yard checks',()=>{
 const api=read('app/api/repair-board/self-assign.ts');
 assert.match(api,/await enforceClaimYard\(user, repair\.equipment_id, repair\.location\)/);
 assert.match(api,/That repair is already assigned to another technician/);
 assert.match(api,/await enforceClaimYard\(user,maintenance\.equipmentId,dueItem\.location\)/);
 const proxy=read('worker/index.ts');
 assert.match(proxy,/'assignToMe'/);
});

test('manager bulk assignment remains available',()=>{
 const ui=read('app/repair-board/planning-center.tsx');
 assert.match(ui,/data\?\.canManage&&selected\.size>0/);
 assert.match(ui,/Bulk action for checked work/);
});
