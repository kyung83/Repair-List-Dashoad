import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shop=read('app/shop/page-v2.tsx');
const work=read('app/shop/current-work-home.tsx');
const completed=read('app/shop/technician-completed-work.tsx');
const api=read('app/api/shop/labor-review/route.ts');
const reviews=read('app/labor-review/page.tsx');
const banner=read('app/shop/yard-scope-banner.tsx');
const worker=read('worker/index.ts');

test('linked working managers get the same streamlined My Work view as mechanics, but office managers and admins do not',()=>{
  assert.match(shop,/const technicianWorkspace=Boolean\(data\?\.user\.technicianId\)&&\(data\.user\.role==="mechanic"\|\|data\.user\.role==="manager"\)/);
  assert.match(shop,/pilot=\{technicianWorkspace\}/);
  assert.match(shop,/if\(technicianWorkspace&&completedOpen\)/);
  assert.match(shop,/<TechnicianCompletedWork isWorking=\{Boolean\(data\?\.activeTimer\)\}/);
  assert.match(shop,/\{technicianWorkspace&&<section/);
  assert.match(work,/id="pilot-required-repair-type"/);
  assert.match(work,/data-shop-action="repaired"/);
  assert.match(work,/data-shop-action="done-working"/);
  assert.match(work,/visitedPilotTools\.includes\("parts"\)/);
  assert.match(work,/visitedPilotTools\.includes\("checklist"\)/);
});

test('working managers retain manager handoff / assignment authority and work-yard restrictions',()=>{
  assert.match(shop,/canAssignHandoff=data\?\.user\.role==="manager"\|\|data\?\.user\.role==="admin"/);
  assert.match(shop,/targetTechnicianId:data\?\.user\.role==="manager"\|\|data\?\.user\.role==="admin"/);
  assert.match(banner,/if\(!yard\)return <section/);
  assert.match(banner,/if\(user.role==="manager"&&Boolean\(user.technicianId\)\)return null/);
  assert.match(banner,/WORK YARD/);
  assert.match(worker,/if \(user.role === 'admin' \|\| user.role === 'manager'\) return true/);
});

test('Completed tab explicitly requests personal history for working managers, while management queue remains default',()=>{
  assert.equal((completed.match(/fetch\('\/api\/shop\/labor-review\?view=mine',\{cache:'no-store'\}\)/g)||[]).length,2);
  assert.match(api,/function isTechnician\(user:User\)\{return Boolean\(user.technicianId\)&&\(user.role==='mechanic'\|\|user.role==='manager'\)\}/);
  assert.match(api,/if\(isManager\(user\)&&!\(url\.searchParams\.get\('view'\)==='mine'&&isTechnician\(user\)\)\)/);
  assert.match(api,/return Response\.json\(\{ok:true,requests:rows\.results,manager:true,currentUserId:user\.id,currentTechnicianId:user\.technicianId\}/);
  assert.match(api,/WHERE l\.technician_id=\?/);
  assert.match(api,/WHERE requester_user_id=\?/);
  assert.match(reviews,/fetch\('\/api\/shop\/labor-review',\{cache:'no-store'\}\)/);
});

test('working managers can submit own time adjustments without bypassing owner verification or manager approval',()=>{
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error\('Only linked technicians can submit labor review requests\.'\)/);
  assert.match(api,/entry\.technician_id!==techId/);
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error\('Only linked technicians can clarify their own requests\.'\)/);
  assert.match(api,/WHERE id=\? AND requester_user_id=\? AND status='needs_info'/);
  assert.match(api,/if\(!isManager\(user\)\)throw new Error\('Managers only\.'\)/);
  assert.match(api,/ownRequest\.requester_user_id===user\.id\|\|\(Boolean\(user\.technicianId\)&&ownRequest\.technician_id===user\.technicianId\)/);
  assert.match(api,/request\.requester_user_id===user\.id\|\|\(Boolean\(user\.technicianId\)&&request\.technician_id===user\.technicianId\)/);
  assert.match(api,/Another manager must review your own labor request/);
  assert.match(reviews,/isOwnRequest\(item\)/);
  assert.match(reviews,/Another manager must approve, reject, or request clarification/);
  assert.match(api,/await env\.DB\.batch\(operations\)/);
  assert.match(api,/if\(repair\.reviewed_at\)throw new Error/);
  assert.match(api,/FROM invoices i LEFT JOIN invoice_repair_links/);
});
