import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Dispatch is a first-class visible clearance with Repair Board and roadside breakdown navigation',async()=>{
  const[nav,users,adminRoute]=await Promise.all([
    read('app/navigation-config.ts'),
    read('app/admin/users/page.tsx'),
    read('app/api/admin/users/route.ts'),
  ]);
  assert.match(nav,/"dispatch"/);
  assert.match(nav,/repairBoardRoles: Role\[\] = \["mechanic", "dispatch", "manager", "admin"\]/);
  assert.match(nav,/breakdownOperatorRoles: Role\[\] = \["dispatch", "manager", "admin"\]/);
  assert.match(nav,/Active Breakdowns/);
  assert.match(users,/dispatch:"Dispatch: view the Repair Board, add unassigned repairs, and handle active roadside breakdowns"/);
  assert.match(adminRoute,/value === 'dispatch'.*storedRole:'manager'.*dispatchAccess:1/s);
  assert.match(adminRoute,/role:row\.dispatch_access \? 'dispatch' : row\.role/);
});

test('Dispatch is hard limited at the Worker boundary while retaining Unit Hub read access',async()=>{
  const worker=await read('worker/index.ts');
  assert.match(worker,/if \(user\.dispatchAccess\) return dispatchCanAccess\(request, url\)/);
  assert.match(worker,/String\(body\.action \?\? ''\) === 'createRepair'/);
  assert.match(worker,/Number\(body\.technicianId \?\? 0\) <= 0/);
  assert.match(worker,/pathname\.startsWith\('\/api\/breakdowns\/'\)/);
  assert.match(worker,/user\.dispatchAccess && url\.pathname === '\/'/);
  assert.match(worker,/Response\.redirect\(new URL\('\/repair-board', url\), 302\)/);
  const publicPaths=worker.match(/const PUBLIC_PATHS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(publicPaths);
  assert.match(publicPaths[1],/'\/report-breakdown'/);
  assert.match(publicPaths[1],/'\/api\/breakdowns'/);
  assert.doesNotMatch(worker,/cannot submit driver breakdown reports/);
  assert.doesNotMatch(worker,/const dispatchDriverRoute/);
  const dispatchReads=worker.match(/const DISPATCH_READ_PATHS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(dispatchReads);
  assert.match(dispatchReads[1],/'\/repair-board'/);
  assert.match(dispatchReads[1],/'\/breakdowns'/);
  assert.match(dispatchReads[1],/'\/unit'/);
  assert.doesNotMatch(dispatchReads[1],/'\/shop'/);
  assert.doesNotMatch(dispatchReads[1],/'\/reports'/);
});

test('Dispatch Repair Board can submit breakdowns and add only unassigned shop repairs',async()=>{
  const[roleAware,addForm]=await Promise.all([
    read('app/repair-board/role-aware-content.tsx'),
    read('app/repair-board/add-repair-form.tsx'),
  ]);
  assert.match(roleAware,/role==='dispatch'/);
  assert.match(roleAware,/RepairBoardDashboard/);
  assert.match(roleAware,/allowTechnicianAssignment=\{false\}/);
  assert.match(roleAware,/href="\/report-breakdown"/);
  assert.match(roleAware,/>Submit Breakdown<\/a>/);
  assert.match(roleAware,/Active Breakdowns/);
  assert.match(addForm,/allowTechnicianAssignment&&technicianId\?Number\(technicianId\):0/);
  assert.match(addForm,/\{allowTechnicianAssignment&&<label>Tech/);
});

test('Dispatch cannot use breakdown setup or shop yard assignments',async()=>{
  const[categories,yards,migration]=await Promise.all([
    read('app/api/breakdown-categories/route.ts'),
    read('app/api/admin/user-yards/route.ts'),
    read('migrations/0128_dispatch_clearance.sql'),
  ]);
  assert.match(categories,/user\.dispatchAccess \|\|/);
  assert.match(yards,/COALESCE\(dispatch_access,0\)=0/);
  assert.match(yards,/Dispatch users do not use shop yard assignments/);
  assert.match(migration,/dispatch_access INTEGER NOT NULL DEFAULT 0/);
});