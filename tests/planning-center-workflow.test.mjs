import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('manager Planning Center bulk-selects work and uses one shared action control',async()=>{
  const source=await read('app/repair-board/planning-center.tsx');
  assert.match(source,/type="checkbox"/);
  assert.match(source,/Action for checked work:/);
  assert.match(source,/aria-label="Bulk action for checked work"/);
  assert.match(source,/\/api\/repair-board\/bulk-assign/);
  assert.match(source,/busy==='bulk'\?'Working…':'Apply'/);
  assert.match(source,/Clear Selection/);
  assert.match(source,/Planning Center/);
});

test('Planning Center keeps detailed repair context in the expanded unit view without old duplicate sections',async()=>{
  const source=await read('app/repair-board/planning-center.tsx');
  assert.match(source,/RepairPhotoPreview/);
  assert.match(source,/\/api\/shop\/repair-review\?repairId=/);
  assert.match(source,/Parts needed/);
  assert.match(source,/Work recorded on this job/);
  assert.doesNotMatch(source,/Upcoming Work/);
  assert.doesNotMatch(source,/Recent Activity/);
  assert.match(source,/Set ETA \/ Depart/);
  assert.match(source,/Mark OOS/);
});

test('bulk assignment preserves DVIR PM annual and active-labor safety rules',async()=>{
  const source=await read('app/api/repair-board/bulk-assign/route.ts');
  assert.match(source,/user\.role!==\'manager\'&&user\.role!==\'admin\'/);
  assert.match(source,/repair_labor_timers/);
  assert.match(source,/active labor/i);
  assert.match(source,/dvir_defects/);
  assert.match(source,/getMaintenanceBoardItems/);
  assert.match(source,/scheduled-pm/);
  assert.match(source,/scheduled-annual/);
  assert.match(source,/repair_job_events/);
});

test('manager view defaults to Planning Center but keeps Classic Board rollback path',async()=>{
  const source=await read('app/repair-board/role-aware-content.tsx');
  assert.match(source,/useState<"planning"\|"classic">\("planning"\)/);
  assert.match(source,/role===\'manager\'\|\|role===\'admin\'/);
  assert.match(source,/<PlanningCenter\/>/);
  assert.match(source,/Classic Board/);
  assert.match(source,/<RepairBoardDashboard\/>/);
});