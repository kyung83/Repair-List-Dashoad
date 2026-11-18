import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('migrations/0172_shop_labor_review_requests.sql');
const api=read('app/api/shop/labor-review/route.ts');
const shop=read('app/shop/page-v2.tsx');
const completed=read('app/shop/technician-completed-work.tsx');
const manager=read('app/labor-review/page.tsx');
const menu=read('app/navigation-config.ts');
const workOrders=read('app/work-orders/page.tsx');
const original=read('app/shop/current-work-home.tsx');
const worker=read('worker/index.ts');

test('Completed tab reaches every linked mechanic without changing existing repair and duty actions',()=>{
  assert.match(shop,/const technicianWorkspace=Boolean\(data\?\.user\.technicianId\)&&\(data\.user\.role==="mechanic"\|\|data\.user\.role==="manager"\)/);
  assert.match(shop,/if\(technicianWorkspace&&completedOpen\)/);
  assert.match(shop,/<TechnicianCompletedWork isWorking=\{Boolean\(data\?\.activeTimer\)\}/);
  assert.match(shop,/<>{workspaceTabs}<CurrentWorkHome/);
  assert.match(shop,/<>{workspaceTabs}<ShopDutyWorkHome/);
  assert.match(shop,/onRepaired=\{\(\)=>void repaired\(activeRepair\)\}/);
  assert.match(original,/data-shop-action="repaired"/);
});
test('migration stores original labor, requested amount, audit decision and idempotency',()=>{
  for(const field of ['request_key TEXT NOT NULL UNIQUE','source_labor_entry_id','source_repair_id','proposed_repair_id','original_hours','original_rate','original_notes','requested_hours','reviewed_by_user_id','reviewed_at','apply_token','created_at','updated_at'])assert.ok(migration.includes(field),field);
  assert.match(migration,/CHECK\(status IN \('pending','needs_info','processing','approved','rejected'\)\)/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_labor_review_one_pending_entry/);
});
test('technician can request correction or missed work but cannot mutate timer or labor directly',()=>{
  assert.match(api,/function isTechnician\(user:User\)\{return Boolean\(user\.technicianId\)&&\(user\.role==='mechanic'\|\|user\.role==='manager'\)\}/);
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error/);
  assert.match(api,/source_labor_entry_id/);
  assert.match(api,/entry\.technician_id!==techId/);
  assert.match(api,/request_type:'correction'\|'missed'/);
  assert.match(api,/INSERT INTO shop_labor_review_requests/);
  assert.match(api,/Only linked technicians can submit labor review requests/);
  assert.match(completed,/SUBMIT FOR MANAGER REVIEW/);
  assert.match(completed,/Your current labor timer continues running/);
  assert.match(completed,/does not change labor, inventory, repair completion/);
});
test('manager approval is the only labor mutation, auditable and protected from reviewed or invoiced work',()=>{
  assert.match(api,/if\(!isManager\(user\)\)throw new Error\('Managers only\.'\)/);
  assert.match(api,/if\(repair\.reviewed_at\)throw new Error/);
  assert.match(api,/FROM invoices i LEFT JOIN invoice_repair_links/);
  assert.match(api,/source\.technician_id!==techId/);
  assert.match(api,/source\.hours\)-Number\(request\.original_hours\)/);
  assert.match(api,/status='processing',apply_token=/);
  assert.match(api,/await env\.DB\.batch\(operations\)/);
  assert.match(api,/status='approved'/);
  assert.match(api,/INSERT INTO repair_job_events/);
  assert.match(api,/UPDATE repairs SET labor_hours=/);
  assert.match(api,/acknowledgeOtherWork/);
  assert.match(api,/otherWorkStillRequiresVerification/);
});
test('missed work must link to existing shop repair and cannot silently change inventory or PM/annual',()=>{
  assert.match(api,/This repair is already linked to an invoice/);
  assert.match(api,/Choose an existing shop work order/);
  assert.match(api,/if\(request\.request_type==='missed'&&!target\)/);
  assert.match(manager,/Parts, DVIR, and PM\/Annual inspection evidence must be verified/);
  assert.doesNotMatch(api,/UPDATE repair_parts|UPDATE maintenance_checklist|UPDATE roadside_breakdowns/);
});
test('manager Labor Corrections queue is visible from repairs and work-order review',()=>{
  assert.match(menu,/\{ href: "\/labor-review", label: "Labor Corrections", exact: true, roles: managerRoles \}/);
  assert.match(workOrders,/data\?\.canApprove&&<a href="\/labor-review"/);
  assert.match(manager,/APPROVE LABOR/);
  assert.match(manager,/ASK FOR DETAILS/);
  assert.match(manager,/REJECT/);
  assert.match(manager,/Current: \{hours\(item\.currentHours\)\}/);
});

test('outer Worker allows mechanic submissions while approval remains manager-only',()=>{
  const start=worker.indexOf('const TECHNICIAN_SHOP_WRITE_PATHS');
  const end=worker.indexOf('const DISPATCH_READ_PATHS',start);
  assert.ok(start>=0&&end>start);
  const allowlist=worker.slice(start,end);
  assert.match(allowlist,/'\/api\/shop\/labor-review'/);
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS\.has\(pathname\)/);
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error\('Only linked technicians can submit labor review requests\.'\)/);
  assert.match(api,/if\(!isManager\(user\)\)throw new Error\('Managers only\.'\)/);
  assert.match(api,/if\(action==='submit'\)/);
  assert.match(api,/if\(action==='approve'\)/);
  assert.doesNotMatch(allowlist,/'\/api\/labor-review'/);
});
