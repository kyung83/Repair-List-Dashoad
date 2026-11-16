import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(file)=>readFile(new URL(`../${file}`,import.meta.url),'utf8');

test('team member schema is additive and primary technician remains in repairs',async()=>{
  const migration=await read('migrations/0169_repair_team_members.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS repair_team_members/);
  assert.match(migration,/PRIMARY KEY \(repair_id, technician_id\)/);
  assert.doesNotMatch(migration,/ALTER TABLE repairs/);
});

test('team assignments are authorized, auditable, and cannot remove active timer',async()=>{
  const api=await read('app/api/shop/team/route.ts');
  assert.match(api,/getSessionUser/);
  assert.match(api,/Only the primary technician or management/);
  assert.match(api,/INSERT INTO repair_team_members/);
  assert.match(api,/repair_labor_timers WHERE repair_id=\? AND technician_id=\?/);
  assert.match(api,/helper_added/);
  assert.match(api,/helper_removed/);
});

test('helper starts labor without replacing the primary owner',async()=>{
  const service=await read('app/api/shop/route-legacy.ts');
  assert.match(service,/isRepairTeamMember/);
  assert.match(service,/SET technician_id = COALESCE\(technician_id, \?\)/);
  assert.match(service,/FROM repair_team_members team WHERE team.repair_id=r.id/);
  assert.match(service,/activeRepairTeammates/);
  assert.match(service,/only the primary technician can hand off the unit/);
  assert.match(service,/NOT EXISTS\(SELECT 1 FROM repair_labor_timers rt WHERE rt.repair_id=repairs.id\)/);
});

test('shared workflows accept helpers and shop exposes join control',async()=>{
  const paths=[
    'app/api/shop/route.ts',
    'app/api/shop/repair-photos/route.ts',
    'app/api/shop/repair-review/route.ts',
    'app/api/shop/repair-type/route.ts',
    'app/api/shop/remove-applied-part/route.ts',
    'app/api/maintenance-checklist/route.ts',
    'app/api/repair-type-checklist/route.ts',
    'app/api/pm-followups/route.ts',
    'app/api/maintenance-subrepairs/route.ts',
  ];
  for(const path of paths)assert.match(await read(path),/isRepairTeamMember/,path);
  const ui=await read('app/shop/current-work-home.tsx');
  assert.match(ui,/RepairTeamPanel/);
  assert.match(await read('app/shop/page-v2.tsx'),/teamIds/);
  assert.match(await read('app/api/shop/route-legacy.ts'),/teamByRepair/);
});

test('simultaneous PM and repair-type checklist edits reject stale answers',async()=>{
  const migration=await read('migrations/0170_team_checklist_revisions.sql');
  assert.match(migration,/ALTER TABLE maintenance_checklist_items ADD COLUMN revision/);
  assert.match(migration,/ALTER TABLE repair_type_checklist_items ADD COLUMN revision/);
  const pm=await read('app/api/maintenance-checklist/route.ts');
  const type=await read('app/api/repair-type-checklist/route.ts');
  assert.match(pm,/revision=revision\+1/);
  assert.match(type,/revision=revision\+1/);
  assert.match(pm,/expectedRevision/);
  assert.match(type,/expectedRevision/);
  assert.match(await read('app/shop/maintenance-checklist-panel-v2.tsx'),/expectedRevision:item.revision/);
  assert.match(await read('app/shop/repair-type-checklist-panel.tsx'),/expectedRevision:item.revision/);
});
