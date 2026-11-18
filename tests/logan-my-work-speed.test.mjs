import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const page=read('app/shop/page-v2.tsx');
const work=read('app/shop/current-work-home.tsx');
const shopOriginal=read('app/api/shop/original.ts');
const shopLegacy=read('app/api/shop/route-legacy.ts');
const parts=read('app/shop/technician-repair-tools-v2.tsx');
const checklist=read('app/shop/maintenance-checklist-panel-v3.tsx');

test('shop queue refresh skips expensive full parts payload, while part lookups retain regular endpoint',()=>{
  assert.match(page,/fetch\("\/api\/shop\?view=queue",\{cache:"no-store"\}\)/);
  assert.match(shopOriginal,/const queueOnly = new URL\(request\.url\)\.searchParams\.get\('view'\) === 'queue'/);
  assert.match(shopOriginal,/FROM parts[\s\S]*?WHERE active = 1 AND deleted_at IS NULL\s+AND \? = 0/);
  assert.match(shopOriginal,/\.bind\(queueOnly \? 1 : 0\)\.all/);
  assert.match(shopLegacy,/const queueOnly = new URL\(request\.url\)\.searchParams\.get\('view'\) === 'queue'/);
  assert.match(shopLegacy,/const decoratedParts = queueOnly \? \[\] : await decorateShopParts\(env\.DB, payload\.parts \?\? \[\]\)/);
  assert.match(shopLegacy,/payload\.parts = shopWarehouse \? scopePartsToWarehouse\(decoratedParts,shopWarehouse\) : decoratedParts/);
  assert.match(parts,/fetch\("\/api\/shop",\{cache:"no-store"\}\)/);
  assert.match(shopLegacy,/payload\.partRequests = requests/);
  assert.match(shopLegacy,/payload\.repairs = repairs/);
});

test('live timer ticks in a tiny component, not on the entire shop dashboard',()=>{
  assert.match(work,/function ElapsedTime\(\{startedAt\}/);
  assert.match(work,/window\.setInterval\(\(\)=>setNow\(Date\.now\(\)\),1000\)/);
  assert.equal((work.match(/<ElapsedTime startedAt=\{timer\.startedAt\}\/\>/g)||[]).length,2);
  assert.doesNotMatch(page,/setNow\(Date\.now\(\)\)/);
  assert.doesNotMatch(page,/now=\{now\}/);
  assert.match(work,/data-shop-action="repaired"/);
  assert.match(work,/data-shop-action="done-working"/);
});

test('pilot tools load on first visit, remain mounted across tab changes, and do not fetch when hidden initially',()=>{
  assert.match(work,/visitedPilotTools.*useState/);
  assert.match(work,/\["notes"\]/);
  assert.match(work,/setPilotTool\(tool\);setVisitedPilotTools\(/);
  for(const t of ['parts','photos','checklist','history'])assert.match(work,new RegExp('visitedPilotTools\\.includes\\("'+t+'"\\)'));
  assert.match(work,/visitedPilotTools\.includes\("parts"\)&&partsAndLaborPanel/);
  assert.match(work,/visitedPilotTools\.includes\("photos"\)&&<RepairPhotoControl/);
  assert.match(work,/visitedPilotTools\.includes\("checklist"\)&&\(maintenanceBlock\?\?/);
  assert.match(work,/visitedPilotTools\.includes\("history"\)&&\(repairMine/);
  assert.match(work,/setPilotTool\("checklist"\);\s+setVisitedPilotTools\(current=>current\.includes\("checklist"\)/);
  assert.match(work,/setPilotTool\("notes"\);\s+setVisitedPilotTools\(\["notes"\]\)/);
  assert.match(work,/!pilot&&maintenanceBlock/);
});

test('hidden Logan checklist pauses polling, while classic PM and annual tabs still use original workflow',()=>{
  assert.match(work,/active=\{!pilot\|\|pilotTool==="checklist"\}/);
  assert.match(checklist,/active\?:boolean/);
  assert.match(checklist,/if\(props\.active===false\)return/);
  assert.match(checklist,/\[props\.repairId,props\.active\]/);
  assert.match(checklist,/window\.setInterval\(\(\)=>void load\(\),3000\)/);
  assert.match(checklist,/<MaintenanceChecklistPanelV2 \{\.\.\.props\}\/>/);
  assert.match(checklist,/<TechnicianRepairReview/);
});
