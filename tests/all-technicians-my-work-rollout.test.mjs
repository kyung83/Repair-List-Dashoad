import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shop=read('app/shop/page-v2.tsx');
const active=read('app/shop/current-work-home.tsx');
const banner=read('app/shop/yard-scope-banner.tsx');
const api=read('app/api/shop/labor-review/route.ts');
const gateway=read('worker/index.ts');
const manager=read('app/labor-review/page.tsx');
const tech=read('app/shop/technician-completed-work.tsx');

test('all linked mechanics share original Logan My Work interface, and office manager/admin UI remains original',()=>{
  assert.match(shop,/const technicianWorkspace=Boolean\(data\?\.user\.technicianId\)&&\(data\.user\.role==="mechanic"\|\|data\.user\.role==="manager"\)/);
  assert.match(shop,/pilot=\{technicianWorkspace\}/);
  assert.match(shop,/if\(technicianWorkspace&&completedOpen\)/);
  assert.match(shop,/<TechnicianCompletedWork isWorking=\{Boolean\(data\?\.activeTimer\)\} onReopened=\{load\} onGoToWorking=/);
  assert.match(shop,/\{technicianWorkspace&&<section/);
  assert.match(shop,/canAssignHandoff=data\?\.user\.role==="manager"\|\|data\?\.user\.role==="admin"/);
  assert.doesNotMatch(shop,/loganr|data\.user\.id===29/);
  assert.match(active,/id="pilot-required-repair-type"/);
  assert.match(active,/data-shop-action="done-working"/);
  assert.match(active,/data-shop-action="repaired"/);
  assert.match(active,/visitedPilotTools\.includes\("checklist"\)/);
});

test('every eligible technician can request corrections for OWN labor, not submit manager approvals',()=>{
  assert.match(api,/function isTechnician\(user:User\)\{return Boolean\(user\.technicianId\)&&\(user\.role==='mechanic'\|\|user\.role==='manager'\)\}/);
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error\('Only linked technicians can submit labor review requests\.'\)/);
  assert.match(api,/entry\.technician_id!==techId/);
  assert.match(api,/WHERE requester_user_id=\?/);
  assert.match(api,/if\(!isTechnician\(user\)\)throw new Error\('Only linked technicians can clarify their own requests\.'\)/);
  assert.match(api,/WHERE id=\? AND requester_user_id=\? AND status='needs_info'/);
  assert.match(api,/if\(!isManager\(user\)\)throw new Error\('Managers only\.'\)/);
  assert.match(api,/if\(action==='approve'\)/);
  assert.match(gateway,/'\/api\/shop\/labor-review'/);
  assert.match(tech,/SUBMIT FOR MANAGER REVIEW/);
  assert.match(manager,/APPROVE LABOR/);
  assert.match(api,/await env\.DB\.batch\(operations\)/);
});

test('informational yard card is removed but missing yard and assignment protections remain',()=>{
  assert.match(banner,/fetch\('\/api\/shop\?view=queue'/);
  const missing=banner.indexOf('if(!yard)return <section');
  const hidden=banner.indexOf('if(user.role==="mechanic")return null');
  const workingManagerHidden=banner.indexOf('if(user.role==="manager"&&Boolean(user.technicianId))return null');
  assert.ok(missing>0&&missing<hidden&&hidden<workingManagerHidden);
  assert.match(banner,/An administrator needs to assign a work yard/);
  assert.match(shop,/Your login is not linked to a technician record yet/);
});
