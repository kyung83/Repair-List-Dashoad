import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const nav=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../app/app-nav.tsx',import.meta.url),'utf8');
const board=readFileSync(new URL('../app/repair-board/planning-center.tsx',import.meta.url),'utf8');
const roleAware=readFileSync(new URL('../app/repair-board/role-aware-content.tsx',import.meta.url),'utf8');
const workOrders=readFileSync(new URL('../app/work-orders/page.tsx',import.meta.url),'utf8');
const invoices=readFileSync(new URL('../app/invoices/page.tsx',import.meta.url),'utf8');
const invoiceRoute=readFileSync(new URL('../app/api/invoices/route.ts',import.meta.url),'utf8');
const eligibility=readFileSync(new URL('../lib/invoice-eligibility.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const build=readFileSync(new URL('../scripts/build-verified.sh',import.meta.url),'utf8');
const current=readFileSync(new URL('../docs/CURRENT.md',import.meta.url),'utf8');

test('Today is the first daily navigation destination and unit search is global',()=>{
  const todayIndex=nav.indexOf('key: "today"');
  const repairsIndex=nav.indexOf('key: "repairs"');
  assert.ok(todayIndex>=0&&repairsIndex>todayIndex,'Today should be defined before Repairs');
  assert.match(shell,/global-unit-search/);
  assert.match(shell,/\/unit\?unit=/);
  assert.match(nav,/"dispatch"/);
});

test('manager Planning Center uses explicit assignment actions',()=>{
  assert.match(board,/Needs Assignment/);
  assert.match(board,/Critical \/ OOS/);
  assert.match(board,/Waiting on Parts/);
  assert.match(board,/PM \/ Annual Due/);
  assert.match(board,/Outside Vendor…/);
  assert.match(board,/Unassign Selected/);
  assert.match(board,/Truck Repairs \/ DVIR/);
  assert.match(board,/Trailer Repairs \/ DVIR/);
  assert.doesNotMatch(board,/Recent Activity/);
  assert.doesNotMatch(board,/Upcoming Work/);
  assert.match(roleAware,/managerView==='planning'\s*\? <PlanningCenter\/>/);
  assert.doesNotMatch(roleAware,/managerView==='planning'&&<RepairBoardUnassign/);
});

test('approved work hands directly to reviewed-only billing',()=>{
  assert.match(workOrders,/Create Invoice/);
  assert.match(workOrders,/workOrderId=/);
  assert.match(invoices,/filter\(item=>item\.reviewed\)/);
  assert.match(invoices,/workOrderId/);
  assert.match(invoices,/If you came from Completed Work, the work order should already be selected/);
  assert.match(invoiceRoute,/ensureReviewedWorkOrderCanBeInvoiced/);
  assert.match(eligibility,/Manager review is required before this work order can be invoiced/);
  assert.match(invoiceRoute,/requireManager\(user\)/);
});

test('full regression suite and public lookup throttling are enforced',()=>{
  assert.equal(packageJson.scripts.test,'node --test tests/*.test.mjs');
  assert.match(build,/tests\/\*\.test\.mjs/);
  assert.match(worker,/PUBLIC_LOOKUP_LIMITS/);
  assert.match(worker,/\/api\/equipment\/search/);
  assert.match(worker,/\/api\/breakdowns\/driver-search/);
  assert.match(worker,/\/api\/breakdowns\/geotab-preview/);
  assert.match(worker,/status:429/);
});

test('current implementation map exists to prevent version sprawl',()=>{
  assert.match(current,/Manager Repair Board/);
  assert.match(current,/Current live implementation map/);
  assert.match(current,/Replace the current implementation in place/);
});
