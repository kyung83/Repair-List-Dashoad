import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const crosswalk=load('lib/trailer-pm-annual-shared-items.ts');
const route=load('app/api/shop/trailer-annual-shortcut/route.ts');
const v3=load('app/shop/maintenance-checklist-panel-v3.tsx');
const v2=load('app/shop/maintenance-checklist-panel-v2.tsx');
const child=load('app/shop/trailer-annual-shortcut.tsx');
const worker=load('worker/index.ts');
const migration=load('migrations/0173_trailer_specific_pm_and_annual.sql');
const transpiled=ts.transpileModule(crosswalk,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const mod={};
new Function('exports',transpiled.outputText)(mod);

test('Annual reuse map references exact actual v1 questions, not vague category-level similarities',()=>{
 const links=mod.VERIFIED_TRAILER_PM_ANNUAL_V1;
 assert.equal(links.length,5);
 assert.equal(new Set(links.map(x=>x.annual)).size,links.length);
 assert.equal(new Set(links.map(x=>x.pm)).size,links.length);
 for(const link of links){
  assert.ok(migration.includes(link.pmText.replaceAll("'","''")),'PM text mismatch '+link.pm);
  assert.ok(migration.includes(link.annualText.replaceAll("'","''")),'Annual text mismatch '+link.annual);
 }
 assert.ok(!links.some(x=>[5,11,32,38].includes(x.annual)),'No automatic credit for brake readjustment limit, ABS startup, legal tire tread measurement or impact guard geometry');
});

test('only same-visit unsigned Annual and exact trailer v1 versions allow answer reuse',()=>{
 const now=new Date('2026-11-20T16:00:00Z');
 const pm={template_key:'trailer-service',template_version:1,event_type:'pm',status:'in_progress',started_at:'2026-11-20 10:00:00'};
 const annual={template_key:'trailer-annual-dot',template_version:1,event_type:'annual',status:'in_progress',started_at:'2026-11-20 10:15:00',signed_at:null};
 const good=mod.canReuseTrailerPmAnnual;
 assert.equal(good(pm,annual,now),true);
 assert.equal(good({...pm,template_key:'default'},annual,now),false);
 assert.equal(good({...pm,template_version:2},annual,now),false);
 assert.equal(good(pm,{...annual,template_version:2},now),false);
 assert.equal(good(pm,{...annual,status:'completed'},now),false);
 assert.equal(good(pm,{...annual,signed_at:'2026-11-20 13:00:00'},now),false);
 assert.equal(good({...pm,started_at:'2026-11-16 10:00:00'},annual,now),false);
 assert.equal(good(pm,{...annual,started_at:'2026-11-15 10:15:00'},now),false);
});

test('technician authorization and separate Annual proof/signature enforced on server',()=>{
 assert.match(route,/isRepairTeamMember\(env\.DB,id,Number\(user\.technicianId\)\)/);
 assert.match(route,/pm\.source!=='scheduled-pm'/);
 assert.match(route,/pm\.equipment_type\.toLowerCase\(\)!=='trailer'/);
 assert.match(route,/source='scheduled-annual'/);
 assert.match(route,/NOT EXISTS\(SELECT 1 FROM repairs previous/);
 assert.match(route,/if\(annual\.technician_id!==null/);
 assert.match(route,/if\(!pmRun\|\|!annualRun\|\|!canReuseTrailerPmAnnual/);
 assert.match(route,/answer\.result!=='pass'/);
 assert.match(route,/answer\.updated_by_user_id!==user\.id/);
 assert.match(route,/item_text=\? AND result='pending'/);
 assert.match(route,/require_photo=0 AND require_measurement=0 AND require_notes=0/);
 assert.match(route,/revision=revision\+1/);
 assert.match(route,/signed_by_user_id!==user\.id/);
 assert.match(route,/c\.status='ready' AND c\.signed_at IS NOT NULL AND c\.signature_strokes IS NOT NULL/);
 assert.match(route,/SET status='Completed',completed_at=CURRENT_TIMESTAMP/);
 assert.match(route,/annual_pm_answers_reused/);
 assert.doesNotMatch(route,/UPDATE equipment SET annual_date|UPDATE pm_status SET annual_date|INSERT INTO repair_labor_entries|INSERT INTO repair_labor_timers/);
 assert.match(worker,/'\/api\/shop\/trailer-annual-shortcut'/);
});

test('trailer PM shows Annual due date and optional button, with separate pending-only Annual workflow',()=>{
 assert.match(v3,/checklist\?\.eventType==='pm'&&checklist\.equipmentType==='trailer'&&<TrailerAnnualShortcut/);
 assert.match(child,/Last Annual:/);
 assert.match(child,/Next due:/);
 assert.match(child,/FINISH REMAINING ANNUAL QUESTIONS/);
 assert.match(child,/SEPARATE ANNUAL FORM/);
 assert.match(child,/action:"startChecklist"/);
 assert.match(child,/action:"reuse"/);
 assert.match(child,/MaintenanceChecklistPanelV2 repairId=\{annualId\} canWork=\{canWork\} pendingOnly/);
 assert.match(v2,/pendingOnly\?:boolean/);
 assert.match(v2,/const remainingItems=pendingOnly\?data\.items\.filter/);
 assert.match(v2,/const navItems=remainingItems\.length\?remainingItems:data\.items/);
 assert.match(v2,/Review all checklist answers/);
 assert.match(child,/FINISH SIGNED ANNUAL & UPDATE ANNUAL DATE/);
 assert.match(child,/window\.dispatchEvent\(new Event\("shop-jobs-refresh"\)\)/);
 assert.match(v3,/inspectionOpen&&<MaintenanceChecklistPanelV2/);
});
